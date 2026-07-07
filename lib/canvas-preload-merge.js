// Merge ranked preload candidates with explicit / section URLs.

(function (root, factory) {
  const planner = typeof require !== 'undefined'
    ? require('./canvas-preload-planner')
    : (root.nucleusCanvasPreloadPlanner || {})
  const api = factory(planner)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  if (typeof root !== 'undefined') {
    root.nucleusCanvasPreloadMerge = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCanvasPreloadMerge(plannerApi) {
  const normalizeCanvasUrl = plannerApi.normalizeCanvasUrl || (url => String(url || '').trim())

  function mergePreloadUrls(candidates, extraUrls, options = {}) {
    const limit = Math.max(1, Number(options.limit) || 3)
    const activeUrl = normalizeCanvasUrl(options.activeUrl || '')
    const candidateUrls = (candidates || []).map(candidate => candidate && candidate.url)
    const extras = extraUrls || []
    const ordered = options.order === 'candidates-first'
      ? [...candidateUrls, ...extras]
      : [...extras, ...candidateUrls]
    const merged = []
    const seen = new Set()

    for (const raw of ordered) {
      const url = normalizeCanvasUrl(raw)
      if (!url || url === activeUrl || seen.has(url)) continue
      seen.add(url)
      merged.push(url)
      if (merged.length >= limit) break
    }

    return merged
  }

  return {
    mergePreloadUrls
  }
})
