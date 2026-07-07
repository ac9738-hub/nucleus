// Headless mock of main-process tab/pool/preload lifecycle (no Electron required).

const { performance } = require('node:perf_hooks')
const { createCanvasPreloadSlotPool } = require('../canvas-preload-slot-pool')
const { summarizeTab } = require('../diagnostics')

const POOL_LIMITS = {
  web: { activeMax: 4, backupCount: 3, maxSize: 8 },
  canvas: { activeMax: 4, backupCount: 3, maxSize: 8 }
}

let mockViewId = 0

function createMockWebContents(url = 'about:blank') {
  const id = ++mockViewId
  let currentUrl = url
  let destroyed = false
  const listeners = {
    'will-navigate': [],
    'did-navigate': [],
    'did-navigate-in-page': []
  }
  return {
    id,
    isDestroyed: () => destroyed,
    destroy: () => { destroyed = true },
    getURL: () => currentUrl,
    loadURL: async (nextUrl) => {
      currentUrl = nextUrl
      for (const fn of listeners['will-navigate']) fn({ preventDefault() {} }, nextUrl)
      for (const fn of listeners['did-navigate']) fn({}, nextUrl)
    },
    on: (event, fn) => {
      if (listeners[event]) listeners[event].push(fn)
    },
    session: { cookies: { get: async () => [] } }
  }
}

function createMockView(url = 'about:blank', poolType = 'web') {
  const webContents = createMockWebContents(url)
  return {
    webContents,
    _nucleusPoolType: poolType,
    _nucleusPredictive: false,
    _visible: false,
    setVisible(value) { this._visible = Boolean(value) },
    getVisible() { return this._visible },
    setBounds() {},
    webContentsId: webContents.id
  }
}

function createMockBrowserPool(trace) {
  const state = {
    web: { inUse: [], backup: [], available: [] },
    canvas: { inUse: [], backup: [], available: [] }
  }

  function bucket(type) {
    return state[type === 'canvas' ? 'canvas' : 'web']
  }

  function inUseLength(type) { return bucket(type).inUse.length }
  function backupLength(type) { return bucket(type).backup.length }
  function availableLength(type) { return bucket(type).available.length }
  function activeLength(type) { return inUseLength(type) + availableLength(type) }
  function totalLength(type) { return activeLength(type) + backupLength(type) }

  function canAcquireActive(type) {
    return inUseLength(type) < POOL_LIMITS[type].activeMax
      && totalLength(type) < POOL_LIMITS[type].maxSize
  }

  function acquirePredictiveView(type) {
    if (!canAcquireActive(type)) return null
    const view = createMockView('about:blank', type)
    view._nucleusPredictive = true
    bucket(type).inUse.push(view)
    trace.step('main:pool', `acquire predictive ${type} view`, null, { poolType: type })
    return view
  }

  function addInUse(type, view) {
    if (!view) return
    const b = bucket(type)
    if (!b.inUse.includes(view)) b.inUse.push(view)
  }

  function releaseView(type, view) {
    if (!view) return
    const b = bucket(type)
    b.inUse = b.inUse.filter(v => v !== view)
    if (!view.webContents.isDestroyed() && b.available.length < POOL_LIMITS[type].activeMax) {
      b.available.push(view)
    } else {
      view.webContents.destroy()
    }
    trace.step('main:pool', `release ${type} view`, null, { poolType: type })
  }

  function stashToBackup(type, view, meta = {}) {
    const b = bucket(type)
    b.inUse = b.inUse.filter(v => v !== view)
    b.backup.push({ view, cache: meta })
    if (b.backup.length > POOL_LIMITS[type].backupCount) {
      const dropped = b.backup.shift()
      if (dropped && dropped.view) dropped.view.webContents.destroy()
    }
    trace.step('main:pool', `stash ${type} backup`, null, meta)
  }

  function snapshot() {
    return {
      web: {
        inUse: inUseLength('web'),
        backup: backupLength('web'),
        available: availableLength('web'),
        active: activeLength('web'),
        total: totalLength('web')
      },
      canvas: {
        inUse: inUseLength('canvas'),
        backup: backupLength('canvas'),
        available: availableLength('canvas'),
        active: activeLength('canvas'),
        total: totalLength('canvas')
      }
    }
  }

  return {
    canAcquireActive,
    acquirePredictiveView,
    addInUse,
    releaseView,
    stashToBackup,
    inUseLength,
    backupLength,
    availableLength,
    activeLength,
    totalLength,
    snapshot,
    urlsLikelyMatch(left, right) {
      return String(left || '').trim() === String(right || '').trim()
    }
  }
}

function createMockMainProcess(options = {}) {
  const trace = options.trace
  const tabs = (options.tabs || []).map(tab => ({ ...tab, view: tab.view || null }))
  let activetab = options.activeTabId
    ? tabs.find(tab => tab.id === options.activeTabId) || tabs[0] || null
    : tabs[0] || null
  let tabActivationGeneration = 0
  let canvasPreloadGeneration = 0
  let tabOperationChain = Promise.resolve()
  const browserpool = createMockBrowserPool(trace)
  const canvasPreloadSlots = options.preloadSlots || createCanvasPreloadSlotPool({ slotCount: 3 })
  const ipcLog = []

  function snapshot() {
    return {
      activeTabId: activetab ? activetab.id : '',
      activeTab: summarizeTab(activetab),
      tabCount: tabs.length,
      tabActivationGeneration,
      canvasPreloadGeneration,
      pool: browserpool.snapshot(),
      preload: {
        poolSize: canvasPreloadSlots.size(),
        stats: options.preloadStats || {}
      }
    }
  }

  function runSerializedTabOperation(task) {
    const started = performance.now()
    const run = async () => {
      trace.step('main:ipc', 'runSerializedTabOperation start', snapshot())
      const result = await task()
      trace.step('main:ipc', 'runSerializedTabOperation end', snapshot(), {
        durationMs: Number((performance.now() - started).toFixed(3))
      })
      return result
    }
    const next = tabOperationChain.then(run, run)
    tabOperationChain = next.catch(() => {})
    return next
  }

  function activateTab(tabId) {
    const generation = ++tabActivationGeneration
    const tab = tabs.find(entry => entry.id === tabId)
    if (!tab) return { ok: false, reason: 'not_found', generation }
    activetab = tab
    trace.step('main:tabs', `activate tab ${tabId}`, snapshot(), { generation })
    return { ok: true, generation, tab: summarizeTab(tab) }
  }

  function isStaleActivation(generation) {
    return generation !== tabActivationGeneration
  }

  function bumpPreloadGeneration() {
    canvasPreloadGeneration += 1
    trace.step('main:preload', 'bump canvasPreloadGeneration', snapshot(), {
      generation: canvasPreloadGeneration
    })
    return canvasPreloadGeneration
  }

  function recordIpc(channel, payload) {
    ipcLog.push({
      tMs: performance.now(),
      channel,
      payload
    })
    trace.step('main:ipc', channel, snapshot(), payload)
  }

  async function ensureMockPreloadSlots() {
    for (let index = 0; index < canvasPreloadSlots.slotCount; index += 1) {
      const slot = canvasPreloadSlots.getSlot(index)
      if (!slot || !slot.view || slot.view.webContents.isDestroyed()) {
        canvasPreloadSlots.initSlot(index, createMockView('about:blank', 'canvas'))
      }
    }
  }

  async function simulatePreloadLoad(tab, urls, loadOptions = {}) {
    await ensureMockPreloadSlots()
    const generation = loadOptions.generation == null
      ? bumpPreloadGeneration()
      : loadOptions.generation
    let loaded = 0
    for (const url of urls || []) {
      if (generation !== canvasPreloadGeneration) {
        trace.step('main:preload', 'stale preload generation abort', snapshot(), { generation })
        break
      }
      if (canvasPreloadSlots.findByUrl(url, browserpool.urlsLikelyMatch.bind(browserpool))) {
        loaded += 1
        continue
      }
      const slotIndex = canvasPreloadSlots.pickSlotForLoad(urls)
      if (slotIndex == null) break
      const slot = canvasPreloadSlots.getSlot(slotIndex)
      canvasPreloadSlots.assignLoading(slotIndex, url, tab.id, generation)
      await slot.view.webContents.loadURL(url)
      if (generation !== canvasPreloadGeneration) {
        canvasPreloadSlots.resetSlot(slotIndex)
        trace.step('main:preload', 'stale preload generation abort after load', snapshot(), { generation })
        continue
      }
      canvasPreloadSlots.markReady(slotIndex, url)
      loaded += 1
      trace.step('main:preload', `quiet load ${url}`, snapshot(), { generation, slotIndex })
    }
    return { loaded, generation }
  }

  return {
    tabs,
    get activetab() { return activetab },
    get tabActivationGeneration() { return tabActivationGeneration },
    get canvasPreloadGeneration() { return canvasPreloadGeneration },
    browserpool,
    canvasPreloadSlots,
    ipcLog,
    snapshot,
    runSerializedTabOperation,
    activateTab,
    isStaleActivation,
    bumpPreloadGeneration,
    recordIpc,
    simulatePreloadLoad
  }
}

module.exports = {
  POOL_LIMITS,
  createMockMainProcess,
  createMockView,
  createMockWebContents
}
