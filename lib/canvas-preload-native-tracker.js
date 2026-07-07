// Pointer tracker for native Canvas course pages (renderer DOM).
// Scans .course-page links and ranks by proximity + approach velocity.
;(function () {
'use strict'

function loadSiblingPreloadApi(globalName, relativePath) {
  if (typeof globalThis !== 'undefined' && globalThis[globalName]) {
    return globalThis[globalName]
  }
  if (typeof window !== 'undefined' && window[globalName]) {
    return window[globalName]
  }
  try {
    if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
      return require(relativePath)
    }
  } catch (_error) {
    // Browser script tags resolve siblings via window/globalThis, not require().
  }
  return null
}

const pointerApi = loadSiblingPreloadApi('nucleusCanvasPreloadPointer', './canvas-preload-pointer')
const domApi = loadSiblingPreloadApi('nucleusCanvasPreloadDom', './canvas-preload-dom')
const pointerInputApi = loadSiblingPreloadApi('nucleusCanvasPreloadPointerInput', './canvas-preload-pointer-input')

const rankLinksByPointer = pointerApi && pointerApi.rankLinksByPointer
  ? pointerApi.rankLinksByPointer
  : () => []

const CANVAS_CHROME_PATH_PATTERN = domApi && domApi.CANVAS_CHROME_PATH_PATTERN
  ? domApi.CANVAS_CHROME_PATH_PATTERN
  : /^\/courses\/\d+(?:\/(?:assignments|modules|grades|users|discussion_topics|quizzes|settings|announcements|files|groups|outcomes|analytics|statistics|conferences|collaborations|external_tools|wiki|pages))?\/?$/

const VISIBLE_LINK_SCAN_LIMIT = 24
const POINTER_HINT_LIMIT = 5

function isNativePreloadableHref(href) {
  const text = String(href || '').trim()
  if (!text || !/^https?:/i.test(text)) return false
  if (text === '#') return false
  if (domApi && typeof domApi.isCanvasPreloadableUrl === 'function') {
    return domApi.isCanvasPreloadableUrl(text)
  }
  if (text.includes('/download') || text.includes('download_frd=1')) return false
  try {
    const parsed = new URL(text)
    if (parsed.searchParams.has('download') || parsed.searchParams.has('download_frd')) return false
    if (/\/download\/?$/i.test(parsed.pathname)) return false
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    if (CANVAS_CHROME_PATH_PATTERN.test(path)) return false
  } catch (_error) {
    return false
  }
  return true
}

function rectIntersectsViewport(rect, viewport, margin = 4) {
  const bounds = viewport || getLinkScanViewport()
  return (
    rect.bottom > bounds.top + margin &&
    rect.right > bounds.left + margin &&
    rect.top < bounds.bottom - margin &&
    rect.left < bounds.right - margin
  )
}

function getLinkScanViewport() {
  if (typeof window === 'undefined') {
    return { left: 0, top: 0, right: 0, bottom: 0 }
  }
  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight
  }
}

function collectVisibleCourseLinks(root, limit = VISIBLE_LINK_SCAN_LIMIT) {
  if (!root || typeof root.querySelectorAll !== 'function') return []

  const coursePage = root.querySelector('.course-page') || root
  const current = new URL(window.location.href)
  const seen = new Set()
  const links = []
  const viewport = getLinkScanViewport()

  for (const node of coursePage.querySelectorAll('a[href]')) {
    if (node.closest('.course-tabs, .course-back-button')) continue

    let href = ''
    try {
      href = new URL(node.getAttribute('href'), current.href).href
    } catch (_error) {
      continue
    }

    if (!href || seen.has(href)) continue
    if (!isNativePreloadableHref(href)) continue

    const rect = node.getBoundingClientRect()
    if (!rect.width && !rect.height) continue
    if (!rectIntersectsViewport(rect, viewport)) continue

    seen.add(href)
    links.push({
      url: href,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      }
    })
    if (links.length >= limit) break
  }

  return links
}

function installNativeCoursePointerTracker(options = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {}
  }

  const root = options.root
  const getTabId = typeof options.getTabId === 'function' ? options.getTabId : () => ''
  const onPointerHints = typeof options.onPointerHints === 'function' ? options.onPointerHints : () => {}
  const onLinkMousedown = typeof options.onLinkMousedown === 'function' ? options.onLinkMousedown : () => {}

  if (!root) return () => {}

  const pointerInputApiLocal = loadSiblingPreloadApi(
    'nucleusCanvasPreloadPointerInput',
    './canvas-preload-pointer-input'
  )
  const pointerInput = pointerInputApiLocal && pointerInputApiLocal.createPointerHintInput
    ? pointerInputApiLocal.createPointerHintInput({
      minMovePx: 2,
      directionDotThreshold: 0.5,
      maxSamples: 4,
      hintSendMs: 50,
      heartbeatMs: 250,
      scoreDelta: 0.012
    })
    : null

  function sendPointerHints(px, py, meta = {}) {
    const samples = meta.samples || (pointerInput ? pointerInput.getSamples() : [])
    const visibleLinks = collectVisibleCourseLinks(root, VISIBLE_LINK_SCAN_LIMIT)
    const ranked = rankLinksByPointer(visibleLinks, px, py, samples, {
      limit: POINTER_HINT_LIMIT,
      falloffPx: pointerApi && pointerApi.DEFAULT_FALLOFF_PX
    })
    const topUrl = ranked[0] ? ranked[0].url : ''
    const topCombined = ranked[0] ? Number(ranked[0].combined || 0) : 0
    const emitReason = String(meta.emitReason || '')
    const emitDecision = pointerInput
      ? pointerInput.shouldEmitHints({
        topUrl,
        topCombined,
        force: Boolean(meta.force),
        directionChanged: Boolean(meta.directionChanged)
      })
      : { emit: Boolean(meta.force || meta.directionChanged), reason: emitReason || 'legacy' }
    if (!emitDecision.emit) return

    onPointerHints(ranked.map(entry => ({
      url: entry.url,
      proximityScore: entry.proximityScore,
      approachDot: entry.approachDot,
      approachRaw: entry.approachRaw,
      combined: entry.combined
    })), {
      tabId: getTabId(),
      linkCount: visibleLinks.length,
      emitReason: emitReason || emitDecision.reason
    })
  }

  function onPointerMove(event) {
    const px = event.clientX
    const py = event.clientY
    if (!pointerInput) return

    const move = pointerInput.recordPointerMove(px, py)
    if (!move.moved) return

    if (move.directionChanged) {
      sendPointerHints(px, py, {
        directionChanged: true,
        samples: move.samples,
        emitReason: 'direction'
      })
    }
  }

  function onLinkPress(event) {
    const node = event.target && event.target.closest
      ? event.target.closest('a[href]')
      : null
    if (!node || !root.contains(node)) return
    if (!node.closest('.course-page')) return

    let href = ''
    try {
      href = new URL(node.getAttribute('href'), window.location.href).href
    } catch (_error) {
      return
    }
    if (!isNativePreloadableHref(href)) return
    onLinkMousedown(href)
  }

  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('mousedown', onLinkPress, true)

  const seedX = Math.round(window.innerWidth * 0.5)
  const seedY = Math.round(window.innerHeight * 0.5)
  if (pointerInput && typeof pointerInput.seedPointer === 'function') {
    pointerInput.seedPointer(seedX, seedY)
  }
  sendPointerHints(seedX, seedY, { force: true, emitReason: 'force' })

  return () => {
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('mousedown', onLinkPress, true)
  }
}

const api = {
  installNativeCoursePointerTracker,
  collectVisibleCourseLinks,
  isNativePreloadableHref,
  getLinkScanViewport,
  rectIntersectsViewport
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api
}
if (typeof globalThis !== 'undefined') {
  globalThis.nucleusCanvasNativeTracker = api
}
if (typeof window !== 'undefined') {
  window.nucleusCanvasNativeTracker = api
}
})()
