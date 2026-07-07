// In-page pointer tracker for Canvas preload (runs from app/canvas/preload.js).
'use strict'

const {
  CANVAS_HIDDEN_LINK_ANCESTOR_SELECTORS,
  CANVAS_CHROME_PATH_PATTERN,
  isCanvasPreloadableUrl
} = require('./canvas-preload-dom')
const { rankLinksByPointer, DEFAULT_FALLOFF_PX } = require('./canvas-preload-pointer')
const { createPointerHintInput } = require('./canvas-preload-pointer-input')

const VISIBLE_LINK_SCAN_LIMIT = 20
const POINTER_HINT_LIMIT = 5

function isHiddenCanvasControlLink(node, hiddenSelector) {
  if (!node || !node.closest) return true
  if (node.closest(hiddenSelector)) return true
  let el = node
  while (el && el !== document.documentElement) {
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return true
    el = el.parentElement
  }
  return false
}

function isCanvasChromeHref(href) {
  try {
    const path = new URL(href).pathname.replace(/\/+$/, '') || '/'
    return CANVAS_CHROME_PATH_PATTERN.test(path)
  } catch (_error) {
    return false
  }
}

function rectIntersectsViewport(rect, margin = 4) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return (
    rect.bottom > margin &&
    rect.right > margin &&
    rect.top < vh - margin &&
    rect.left < vw - margin
  )
}

function collectVisiblePreloadLinks(limit = VISIBLE_LINK_SCAN_LIMIT) {
  const hiddenSelector = CANVAS_HIDDEN_LINK_ANCESTOR_SELECTORS
  const current = new URL(window.location.href)
  const seen = new Set()
  const links = []
  const nodes = Array.from(document.querySelectorAll('a[href]'))

  for (const node of nodes) {
    if (isHiddenCanvasControlLink(node, hiddenSelector)) continue

    let href = ''
    try {
      href = new URL(node.getAttribute('href'), current.href).href
    } catch (_error) {
      continue
    }

    if (!href || seen.has(href)) continue
    if (!/^https?:/i.test(href)) continue
    if (node.getAttribute('href') === '#') continue
    if (!isCanvasPreloadableUrl(href) || isCanvasChromeHref(href)) continue

    const rect = node.getBoundingClientRect()
    if (!rect.width && !rect.height) continue
    if (!rectIntersectsViewport(rect)) continue

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

function installCanvasPageTracker(ipcRenderer) {
  if (!ipcRenderer || typeof document === 'undefined') return
  if (window.__nucleusCanvasPointerInstalled) return
  window.__nucleusCanvasPointerInstalled = true

  const hiddenSelector = CANVAS_HIDDEN_LINK_ANCESTOR_SELECTORS
  const pointerInput = createPointerHintInput({
    minMovePx: 2,
    directionDotThreshold: 0.5,
    maxSamples: 4,
    hintSendMs: 50,
    heartbeatMs: 250,
    scoreDelta: 0.012
  })

  function resolveLinkHref(node) {
    if (!node) return ''
    try {
      return new URL(node.getAttribute('href'), window.location.href).href
    } catch (_error) {
      return ''
    }
  }

  function sendPointerHints(px, py, meta = {}) {
    const samples = meta.samples || pointerInput.getSamples()
    const visibleLinks = collectVisiblePreloadLinks(VISIBLE_LINK_SCAN_LIMIT)
    const ranked = rankLinksByPointer(visibleLinks, px, py, samples, {
      limit: POINTER_HINT_LIMIT,
      falloffPx: DEFAULT_FALLOFF_PX
    })
    const topUrl = ranked[0] ? ranked[0].url : ''
    const topCombined = ranked[0] ? Number(ranked[0].combined || 0) : 0
    const emitReason = String(meta.emitReason || '')
    const emitDecision = pointerInput.shouldEmitHints({
      topUrl,
      topCombined,
      force: Boolean(meta.force),
      directionChanged: Boolean(meta.directionChanged)
    })
    if (!emitDecision.emit) return

    ipcRenderer.send('canvas:pointer_hints', {
      source: 'canvas_webview',
      emitReason: emitReason || emitDecision.reason || '',
      links: ranked.map(entry => ({
        url: entry.url,
        proximityScore: entry.proximityScore,
        approachDot: entry.approachDot,
        approachRaw: entry.approachRaw,
        combined: entry.combined
      }))
    })
  }

  function onPointerMove(event) {
    const px = event.clientX
    const py = event.clientY
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
    if (!node || isHiddenCanvasControlLink(node, hiddenSelector)) return

    const href = resolveLinkHref(node)
    if (!href || !/^https?:/i.test(href)) return
    if (!isCanvasPreloadableUrl(href) || isCanvasChromeHref(href)) return

    ipcRenderer.send('canvas:link_mousedown', { url: href })
  }

  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('mousedown', onLinkPress, true)

  const seedX = Math.round(window.innerWidth * 0.5)
  const seedY = Math.round(window.innerHeight * 0.5)
  if (typeof pointerInput.seedPointer === 'function') {
    pointerInput.seedPointer(seedX, seedY)
  }
  sendPointerHints(seedX, seedY, { force: true, emitReason: 'force' })
}

module.exports = {
  installCanvasPageTracker,
  collectVisiblePreloadLinks,
  rectIntersectsViewport
}
