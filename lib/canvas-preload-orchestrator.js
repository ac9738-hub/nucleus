// Canvas preload planning: merge explicit URLs, pointer hints, section URLs, and planner ranking.
'use strict'

const { mergePreloadUrls } = require('./canvas-preload-merge')
const { planPreloadUrls, normalizeCanvasUrl } = require('./canvas-preload-planner')
const {
  isCanvasPreloadableUrl,
  canvasPreloadUrlsMatch
} = require('./canvas-preload-dom')

const CANVAS_BACK_CACHE_SLOT_INDEX = 0
const CANVAS_PREDICTIVE_SLOT_COUNT = 2
const CANVAS_PRELOAD_SLOT_COUNT = CANVAS_PREDICTIVE_SLOT_COUNT + 1
const POINTER_HINT_TTL_MS = 30_000

function defaultUrlsMatch(left, right) {
  if (typeof canvasPreloadUrlsMatch === 'function') {
    return canvasPreloadUrlsMatch(left, right)
  }
  return normalizeCanvasUrl(left) === normalizeCanvasUrl(right)
}

function shouldPreloadCanvasUrl(url, options = {}) {
  const normalized = normalizeCanvasUrl(url)
  if (!normalized) return false
  if (!isCanvasPreloadableUrl(normalized, { allowedHosts: options.allowedHosts })) {
    return false
  }
  const activeUrl = normalizeCanvasUrl(options.activeUrl || '')
  const urlsMatch = options.urlsMatch || defaultUrlsMatch
  if (activeUrl && urlsMatch(normalized, activeUrl)) return false
  const cached = options.cachedSlotUrls || []
  for (const cachedUrl of cached) {
    if (cachedUrl && urlsMatch(normalized, cachedUrl)) return false
  }
  return true
}

function filterPreloadRankingUrls(urls, options = {}) {
  const out = []
  const seen = new Set()
  for (const raw of urls || []) {
    const normalized = normalizeCanvasUrl(raw)
    if (!normalized || seen.has(normalized)) continue
    if (!shouldPreloadCanvasUrl(normalized, options)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function normalizePointerHints(rawLinks, options = {}) {
  if (!Array.isArray(rawLinks)) return []
  const hints = []
  const seen = new Set()
  for (const entry of rawLinks) {
    if (!entry) continue
    const url = normalizeCanvasUrl(typeof entry === 'string' ? entry : entry.url)
    if (!url || seen.has(url)) continue
    if (!shouldPreloadCanvasUrl(url, options)) continue
    seen.add(url)
    const combined = Number(typeof entry === 'object' ? entry.combined : NaN)
    hints.push({
      url,
      combined: Number.isFinite(combined) ? combined : 0.5,
      proximityScore: Number(entry.proximityScore) || 0,
      approachScore: Number(entry.approachScore) || 0
    })
  }
  return hints
}

function normalizeDomLinks(rawLinks, options = {}) {
  if (!Array.isArray(rawLinks)) return []
  return rawLinks
    .map(entry => {
      if (!entry) return null
      if (typeof entry === 'string') {
        const url = normalizeCanvasUrl(entry)
        if (!url || !shouldPreloadCanvasUrl(url, options)) return null
        return { url }
      }
      const url = normalizeCanvasUrl(entry.url || entry.href || '')
      if (!url || !shouldPreloadCanvasUrl(url, options)) return null
      return { ...entry, url }
    })
    .filter(Boolean)
}

function buildPreloadFocusCourseIds(tab, tabs = []) {
  const ids = new Set()
  if (tab && tab.courseId) ids.add(String(tab.courseId))
  for (const localTab of tabs) {
    if (!localTab || localTab.type !== 'canvastab' || !localTab.courseId) continue
    ids.add(String(localTab.courseId))
  }
  return [...ids]
}

function buildSiblingCourseCounts(tabs = []) {
  const counts = Object.create(null)
  for (const localTab of tabs) {
    if (!localTab || localTab.type !== 'canvastab' || !localTab.courseId) continue
    const key = String(localTab.courseId)
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function collectProtectedPreloadUrls(tab, options = {}) {
  const normalize = options.normalizeUrl || normalizeCanvasUrl
  const urlsMatch = options.urlsMatch || ((left, right) => normalize(left) === normalize(right))
  const protectedUrls = []
  const seen = new Set()

  function add(raw) {
    const url = normalize(raw)
    if (!url || seen.has(url)) return
    seen.add(url)
    protectedUrls.push(url)
  }

  if (tab) {
    if (tab.url) add(tab.url)
    if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
      try {
        add(tab.view.webContents.getURL())
      } catch (_error) {
        // ignore
      }
    }
  }

  const parentEntry = options.parentEntry
  if (parentEntry && parentEntry.kind === 'web' && parentEntry.url) {
    add(parentEntry.url)
  }

  const backSlot = options.backSlot
  if (backSlot && backSlot.role === 'back_cache' && backSlot.url) {
    add(backSlot.url)
  }

  for (const extra of options.extraProtected || []) {
    add(extra)
  }

  return protectedUrls.filter(url => Boolean(url))
}

function buildPredictivePreloadUrls(canvasData, options = {}) {
  const limit = Math.max(1, Number(options.limit) || CANVAS_PREDICTIVE_SLOT_COUNT)
  const filterOptions = {
    activeUrl: options.activeUrl || '',
    allowedHosts: options.allowedHosts || [],
    cachedSlotUrls: options.cachedSlotUrls || [],
    urlsMatch: options.urlsMatch || defaultUrlsMatch
  }
  const activeUrl = normalizeCanvasUrl(filterOptions.activeUrl)
  const explicitUrls = filterPreloadRankingUrls(options.explicitUrls || [], filterOptions)
  const domLinks = normalizeDomLinks(options.domLinks || [], filterOptions)
  const pointerHints = normalizePointerHints(options.pointerHints || [], filterOptions)
  const sectionUrls = filterPreloadRankingUrls(options.sectionUrls || [], filterOptions)
  const extras = [...explicitUrls, ...sectionUrls]
  for (const link of domLinks) {
    if (link.url) extras.push(link.url)
  }

  const ranked = planPreloadUrls(canvasData, {
    limit: Math.max(limit, limit + extras.length),
    activeUrl,
    domLinks,
    pointerHints,
    focusCourseIds: options.focusCourseIds || [],
    siblingCourseCounts: options.siblingCourseCounts || null,
    tasks: options.tasks || [],
    graph: options.graph || null
  })

  return filterPreloadRankingUrls(
    mergePreloadUrls(ranked, extras, {
      limit,
      activeUrl,
      order: options.order || 'extras-first'
    }),
    filterOptions
  ).slice(0, limit)
}

function pointerHintsFresh(entry, nowMs = Date.now()) {
  if (!entry || !Array.isArray(entry.hints)) return false
  return nowMs - Number(entry.at || 0) <= POINTER_HINT_TTL_MS
}

module.exports = {
  CANVAS_BACK_CACHE_SLOT_INDEX,
  CANVAS_PREDICTIVE_SLOT_COUNT,
  CANVAS_PRELOAD_SLOT_COUNT,
  POINTER_HINT_TTL_MS,
  normalizePointerHints,
  normalizeDomLinks,
  buildPreloadFocusCourseIds,
  buildSiblingCourseCounts,
  collectProtectedPreloadUrls,
  buildPredictivePreloadUrls,
  shouldPreloadCanvasUrl,
  filterPreloadRankingUrls,
  pointerHintsFresh
}
