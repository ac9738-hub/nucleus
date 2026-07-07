// Shared Canvas preload view pool keyed by normalized URL with per-tab ref counts.
// Dependencies: lib/canvas-preload-planner.js normalizeCanvasUrl

const { normalizeCanvasUrl } = require('./canvas-preload-planner')

function createCanvasPreloadPool() {
  const byUrl = new Map()
  const byTab = new Map()

  function viewDestroyed(view) {
    return !view || view.webContents.isDestroyed()
  }

  function urlKey(url, urlsLikelyMatch) {
    const normalized = normalizeCanvasUrl(url)
    if (normalized) return normalized
    return String(url || '').trim()
  }

  function urlsMatch(left, right, urlsLikelyMatch) {
    if (!left || !right) return false
    if (typeof urlsLikelyMatch === 'function') {
      return urlsLikelyMatch(left, right)
    }
    return normalizeCanvasUrl(left) === normalizeCanvasUrl(right)
  }

  function findEntry(url, urlsLikelyMatch) {
    const normalized = normalizeCanvasUrl(url)
    if (normalized && byUrl.has(normalized)) {
      const entry = byUrl.get(normalized)
      if (entry && entry.view && !viewDestroyed(entry.view)) return entry
    }

    for (const entry of byUrl.values()) {
      if (!entry || !entry.view || viewDestroyed(entry.view)) continue
      if (urlsMatch(entry.url, url, urlsLikelyMatch)) return entry
      try {
        const loadedUrl = entry.view.webContents.getURL()
        if (urlsMatch(loadedUrl, url, urlsLikelyMatch)) return entry
      } catch (_error) {
        // ignore
      }
    }

    return null
  }

  function getForTab(tabId) {
    const keys = byTab.get(String(tabId || ''))
    if (!keys) return []
    const out = []
    for (const key of keys) {
      const entry = byUrl.get(key)
      if (entry && entry.view && !viewDestroyed(entry.view)) {
        out.push({ url: entry.url, view: entry.view })
      }
    }
    return out
  }

  function register(tabId, url, view) {
    const tabKey = String(tabId || '')
    const key = urlKey(url)
    if (!tabKey || !key || !view) return null

    let entry = byUrl.get(key)
    if (!entry || viewDestroyed(entry.view) || entry.view !== view) {
      entry = { url: normalizeCanvasUrl(url) || key, view, refs: new Set() }
      byUrl.set(key, entry)
    }

    entry.refs.add(tabKey)
    if (!byTab.has(tabKey)) byTab.set(tabKey, new Set())
    byTab.get(tabKey).add(key)
    return entry
  }

  function detachTab(tabId, url, view) {
    const tabKey = String(tabId || '')
    const key = urlKey(url)
    const entry = byUrl.get(key)
    if (!entry) return

    if (view && entry.view !== view) return
    entry.refs.delete(tabKey)
    const tabKeys = byTab.get(tabKey)
    if (tabKeys) {
      tabKeys.delete(key)
      if (!tabKeys.size) byTab.delete(tabKey)
    }
    if (!entry.refs.size) {
      byUrl.delete(key)
    }
  }

  function releaseTab(tabId, options = {}) {
    const tabKey = String(tabId || '')
    const keys = byTab.get(tabKey)
    if (!keys) return

    const releaseView = typeof options.releaseView === 'function' ? options.releaseView : () => {}
    const isViewInUse = typeof options.isViewInUse === 'function' ? options.isViewInUse : () => false

    for (const key of [...keys]) {
      const entry = byUrl.get(key)
      if (!entry) continue
      entry.refs.delete(tabKey)
      if (!entry.refs.size) {
        byUrl.delete(key)
        if (!isViewInUse(entry.view)) {
          releaseView(entry.view)
        }
      }
    }
    byTab.delete(tabKey)
  }

  function allViews() {
    const views = []
    for (const entry of byUrl.values()) {
      if (entry && entry.view && !viewDestroyed(entry.view)) {
        views.push(entry.view)
      }
    }
    return views
  }

  function clear(releaseView) {
    for (const entry of byUrl.values()) {
      if (entry && entry.view && typeof releaseView === 'function') {
        releaseView(entry.view)
      }
    }
    byUrl.clear()
    byTab.clear()
  }

  return {
    findEntry,
    getForTab,
    register,
    detachTab,
    releaseTab,
    allViews,
    clear,
    size: () => byUrl.size
  }
}

const defaultPool = createCanvasPreloadPool()

module.exports = {
  createCanvasPreloadPool,
  defaultPool
}
