// Module-order preload candidates: next items after the active Canvas URL.

(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  if (typeof root !== 'undefined') {
    root.nucleusCanvasPreloadModules = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCanvasPreloadModules() {
  const MAX_NEXT_ITEMS = 4

  function normalizeCanvasUrl(url) {
    const text = String(url || '').trim()
    if (!text || !/^https?:/i.test(text)) return ''
    try {
      const parsed = new URL(text)
      if (parsed.pathname.includes('/download') || parsed.search.includes('download_frd=1')) {
        return ''
      }
      parsed.hash = ''
      return parsed.href
    } catch (_error) {
      return ''
    }
  }

  function normalizePath(url) {
    try {
      return new URL(url).pathname.replace(/\/+$/, '').toLowerCase()
    } catch (_error) {
      return ''
    }
  }

  function pathsLikelySame(left, right) {
    const a = normalizePath(left)
    const b = normalizePath(right)
    if (!a || !b) return false
    if (a === b) return true

    const patterns = [
      /\/assignments\/(\d+)/,
      /\/quizzes\/(\d+)/,
      /\/files\/(\d+)/,
      /\/pages\/([^/]+)/,
      /\/modules\/items\/(\d+)/
    ]
    for (const pattern of patterns) {
      const leftMatch = a.match(pattern)
      if (!leftMatch) continue
      if (b.includes(leftMatch[0])) return true
      const rightMatch = b.match(pattern)
      if (rightMatch && a.includes(rightMatch[0])) return true
    }
    return false
  }

  function itemUrls(item) {
    return [item && item.html_url, item && item.url].filter(Boolean)
  }

  function courseModules(canvasData, courseId) {
    const modules = canvasData && canvasData.modules ? canvasData.modules : {}
    const list = modules[courseId] || modules[String(courseId)] || []
    return Array.isArray(list)
      ? list.slice().sort((left, right) => (left.position || 0) - (right.position || 0))
      : []
  }

  function moduleItemsForCourse(canvasData, courseId) {
    const bucket = canvasData && canvasData.module_items ? canvasData.module_items : {}
    const value = bucket[courseId] || bucket[String(courseId)]
    return value && typeof value === 'object' ? value : {}
  }

  function flattenModuleItems(canvasData, courseId) {
    const flat = []
    for (const mod of courseModules(canvasData, courseId)) {
      const items = moduleItemsForCourse(canvasData, courseId)[mod.id]
        || moduleItemsForCourse(canvasData, courseId)[String(mod.id)]
        || []
      const sorted = items.slice().sort((left, right) => (left.position || 0) - (right.position || 0))
      for (const item of sorted) {
        flat.push({
          item,
          moduleId: String(mod.id || ''),
          moduleName: String(mod.name || '')
        })
      }
    }
    return flat
  }

  function findModuleAnchorIndex(flatItems, activeUrl) {
    if (!activeUrl) return -1
    for (let index = 0; index < flatItems.length; index += 1) {
      const urls = itemUrls(flatItems[index].item)
      if (urls.some(url => pathsLikelySame(activeUrl, url))) {
        return index
      }
    }
    return -1
  }

  function collectModuleSequenceCandidates(canvasData, focusCourseIds, activeUrl) {
    const normalizedActive = normalizeCanvasUrl(activeUrl)
    if (!normalizedActive) return []

    const focus = Array.isArray(focusCourseIds)
      ? focusCourseIds.map(String).filter(Boolean)
      : []
    const courseIds = focus.length
      ? focus
      : Object.keys((canvasData && canvasData.modules) || {})

    const out = []
    const seen = new Set()

    for (const courseId of courseIds) {
      const flat = flattenModuleItems(canvasData, courseId)
      const anchorIndex = findModuleAnchorIndex(flat, normalizedActive)
      if (anchorIndex < 0) continue

      for (let offset = 1; offset <= MAX_NEXT_ITEMS; offset += 1) {
        const entry = flat[anchorIndex + offset]
        if (!entry) break
        const url = normalizeCanvasUrl(itemUrls(entry.item)[0] || '')
        if (!url || seen.has(url) || url === normalizedActive) continue
        seen.add(url)
        out.push({
          url,
          courseId: String(courseId),
          kind: 'module_item',
          source: 'module_sequence',
          sequenceOffset: offset,
          moduleId: entry.moduleId,
          moduleName: entry.moduleName,
          reason: `module_next_${offset}`
        })
      }
    }

    return out
  }

  function moduleSequenceScore(candidate) {
    if (!candidate || candidate.source !== 'module_sequence') return 0
    const offset = Number(candidate.sequenceOffset) || 1
    return Math.max(0.35, 1 - (offset - 1) * 0.22)
  }

  return {
    MAX_NEXT_ITEMS,
    pathsLikelySame,
    collectModuleSequenceCandidates,
    moduleSequenceScore,
    flattenModuleItems
  }
})
