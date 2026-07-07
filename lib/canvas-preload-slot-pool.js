// Fixed-size Canvas preload slot pool (default 3 hidden views).
// On navigation hit, the main view is recycled into a vacated slot.

'use strict'

const { normalizeCanvasUrl } = require('./canvas-preload-planner')

const SLOT_STATES = {
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready'
}

function createCanvasPreloadSlotPool(options = {}) {
  const slotCount = Math.max(1, Number(options.slotCount) || 3)
  const slots = []

  function viewDestroyed(view) {
    return !view || view.webContents.isDestroyed()
  }

  function urlsMatch(left, right, urlsLikelyMatch) {
    if (!left || !right) return false
    if (typeof urlsLikelyMatch === 'function') {
      return urlsLikelyMatch(left, right)
    }
    return normalizeCanvasUrl(left) === normalizeCanvasUrl(right)
  }

  function slotMatchesUrl(slot, target, urlsLikelyMatch) {
    if (!slot || !target) return false
    if (urlsMatch(slot.url, target, urlsLikelyMatch)) return true
    if (!slot.view || viewDestroyed(slot.view)) return false
    try {
      const loaded = slot.view.webContents.getURL()
      return urlsMatch(loaded, target, urlsLikelyMatch)
    } catch (_error) {
      return false
    }
  }

  function slotIsProtected(slot, protectedUrls, urlsLikelyMatch) {
    if (!slot || !protectedUrls || !protectedUrls.length) return false
    return protectedUrls.some(url => slotMatchesUrl(slot, url, urlsLikelyMatch))
  }

  function initSlot(index, view) {
    slots[index] = {
      view,
      url: '',
      state: SLOT_STATES.IDLE,
      tabId: '',
      generation: 0,
      loadReason: '',
      role: '',
      loadingAt: 0,
      readyAt: 0,
      loadDurationMs: 0
    }
  }

  function getSlot(index) {
    return slots[index] || null
  }

  function findByUrl(url, urlsLikelyMatch, options = {}) {
    const includeLoading = options.includeLoading !== false
    const target = normalizeCanvasUrl(url) || String(url || '').trim()
    if (!target) return null

    const tryStates = includeLoading
      ? [SLOT_STATES.READY, SLOT_STATES.LOADING]
      : [SLOT_STATES.READY]

    for (const state of tryStates) {
      for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index]
        if (!slot || !slot.view || viewDestroyed(slot.view)) continue
        if (slot.state !== state) continue
        if (!slotMatchesUrl(slot, target, urlsLikelyMatch)) continue
        const resolvedUrl = slot.url || (() => {
          try {
            return slot.view.webContents.getURL()
          } catch (_error) {
            return target
          }
        })()
        return { index, ...slot, url: resolvedUrl }
      }
    }

    return null
  }

  function findByView(view) {
    if (!view) return null
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]
      if (slot && slot.view === view) {
        return { index, ...slot }
      }
    }
    return null
  }

  function viewInPool(view) {
    return Boolean(findByView(view))
  }

  function takeViewFromSlot(match) {
    const index = typeof match === 'number' ? match : match.index
    const slot = slots[index]
    if (!slot || !slot.view) return null

    const view = slot.view
    slot.view = null
    slot.url = ''
    slot.state = SLOT_STATES.IDLE
    slot.tabId = ''
    slot.generation = 0
    slot.loadReason = ''
    slot.role = ''
    slot.loadingAt = 0
    slot.readyAt = 0
    slot.loadDurationMs = 0
    return view
  }

  function pickSlotForLoad(planUrls = [], options = {}) {
    const urlsLikelyMatch = options.urlsLikelyMatch
    const protectedUrls = options.protectedUrls || []
    const keep = new Set(
      (planUrls || [])
        .map(url => normalizeCanvasUrl(url))
        .filter(Boolean)
    )

    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]
      if (!slot || !slot.view || viewDestroyed(slot.view)) continue
      if (slot.role === 'back_cache') continue
      if (slot.state === SLOT_STATES.IDLE) return index
    }

    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]
      if (!slot || !slot.view || viewDestroyed(slot.view)) continue
      if (slot.role === 'back_cache') continue
      if (slot.state === SLOT_STATES.LOADING) continue
      if (slotIsProtected(slot, protectedUrls, urlsLikelyMatch)) continue
      const normalized = normalizeCanvasUrl(slot.url)
      if (!normalized || !keep.has(normalized)) return index
    }

    return null
  }

  function recycleView(view, url, tabId = '', options = {}) {
    if (!view || viewDestroyed(view)) return null

    const normalized = normalizeCanvasUrl(url) || String(url || '').trim()
    const role = String(options.role || '')
    const existing = findByView(view)
    if (existing) {
      const slot = slots[existing.index]
      slot.url = normalized
      slot.state = normalized ? SLOT_STATES.READY : SLOT_STATES.IDLE
      slot.tabId = String(tabId || '')
      slot.generation = 0
      slot.loadReason = role === 'back_cache' ? 'back_cache' : ''
      if (role) slot.role = role
      return { index: existing.index, replacedView: null }
    }

    let targetIndex = -1
    if (role === 'back_cache') {
      targetIndex = Number.isInteger(options.backCacheIndex) ? options.backCacheIndex : 0
    } else {
      for (let index = 0; index < slots.length; index += 1) {
        if (slots[index].role === 'back_cache') continue
        if (slots[index].state === SLOT_STATES.IDLE) {
          targetIndex = index
          break
        }
      }

      if (targetIndex < 0) {
        for (let index = 0; index < slots.length; index += 1) {
          if (slots[index].role === 'back_cache') continue
          if (slots[index].state === SLOT_STATES.READY) {
            targetIndex = index
            break
          }
        }
      }
    }

    if (targetIndex < 0 || !slots[targetIndex]) return null

    const slot = slots[targetIndex]
    const replacedView = slot.view && slot.view !== view ? slot.view : null
    slot.view = view
    slot.url = normalized
    slot.state = normalized ? SLOT_STATES.READY : SLOT_STATES.IDLE
    slot.tabId = String(tabId || '')
    slot.generation = 0
    slot.loadReason = role === 'back_cache' ? 'back_cache' : ''
    slot.role = role || ''
    return { index: targetIndex, replacedView }
  }

  function assignLoading(index, url, tabId, generation, loadReason = '') {
    const slot = slots[index]
    if (!slot) return false
    slot.url = normalizeCanvasUrl(url) || String(url || '').trim()
    slot.state = SLOT_STATES.LOADING
    slot.tabId = String(tabId || '')
    slot.generation = generation
    slot.loadReason = String(loadReason || '')
    slot.loadingAt = Date.now()
    slot.readyAt = 0
    slot.loadDurationMs = 0
    return true
  }

  function markReady(index, url) {
    const slot = slots[index]
    if (!slot) return false
    slot.url = normalizeCanvasUrl(url) || slot.url
    slot.state = SLOT_STATES.READY
    slot.readyAt = Date.now()
    if (slot.loadingAt > 0) {
      slot.loadDurationMs = Math.max(0, slot.readyAt - slot.loadingAt)
    }
    return true
  }

  function resetSlot(index) {
    const slot = slots[index]
    if (!slot) return
    slot.url = ''
    slot.state = SLOT_STATES.IDLE
    slot.tabId = ''
    slot.generation = 0
    slot.loadReason = ''
    slot.role = ''
    slot.loadingAt = 0
    slot.readyAt = 0
    slot.loadDurationMs = 0
  }

  function cancelForTab(tabId, options = {}) {
    const key = String(tabId || '')
    const protectedUrls = options.protectedUrls || []
    const urlsLikelyMatch = options.urlsLikelyMatch
    for (const slot of slots) {
      if (!slot) continue
      if (slot.role === 'back_cache') continue
      if (slot.tabId !== key || slot.state !== SLOT_STATES.LOADING) continue
      if (slotIsProtected(slot, protectedUrls, urlsLikelyMatch)) continue
      slot.state = SLOT_STATES.IDLE
      slot.url = ''
      slot.tabId = ''
      slot.generation = 0
      slot.loadReason = ''
      slot.loadingAt = 0
      slot.readyAt = 0
      slot.loadDurationMs = 0
    }
  }

  function allViews() {
    return slots.map(slot => slot && slot.view).filter(view => view && !viewDestroyed(view))
  }

  function size() {
    return slots.filter(slot => (
      slot &&
      (slot.state === SLOT_STATES.READY || slot.state === SLOT_STATES.LOADING) &&
      slot.url
    )).length
  }

  function slotSnapshot() {
    return slots.map((slot, index) => ({
      index,
      url: slot.url,
      state: slot.state,
      tabId: slot.tabId,
      generation: slot.generation,
      loadReason: slot.loadReason || '',
      role: slot.role || '',
      loadingAt: slot.loadingAt || 0,
      readyAt: slot.readyAt || 0,
      loadDurationMs: slot.loadDurationMs || 0
    }))
  }

  return {
    slotCount,
    SLOT_STATES,
    initSlot,
    getSlot,
    findByUrl,
    findByView,
    viewInPool,
    takeViewFromSlot,
    pickSlotForLoad,
    recycleView,
    assignLoading,
    markReady,
    resetSlot,
    cancelForTab,
    allViews,
    size,
    slotSnapshot
  }
}

module.exports = {
  createCanvasPreloadSlotPool,
  SLOT_STATES
}
