// Renderer diagnostics bridge. Sends structured events to the main process.
(function initNucleusRendererDiagnostics(global) {
  const noop = () => {}
  const state = {
    ready: false,
    enabled: false,
    channels: new Set(),
    queue: []
  }

  function flushQueue() {
    if (!state.ready || !global.nucleus || typeof global.nucleus.debugLog !== 'function') return
    while (state.queue.length) {
      global.nucleus.debugLog(state.queue.shift())
    }
  }

  function applyConfig(config) {
    state.enabled = Boolean(config && config.enabled)
    state.channels = new Set((config && config.channels) || [])
    state.ready = true
    flushQueue()
  }

  function isEnabled(channel) {
    return state.enabled && state.channels.has(channel)
  }

  function emit(channel, event, data = {}, meta = {}) {
    if (!isEnabled(channel)) return
    const payload = { channel, event, data, meta }
    if (state.ready && global.nucleus && typeof global.nucleus.debugLog === 'function') {
      global.nucleus.debugLog(payload)
      return
    }
    state.queue.push(payload)
    if (state.queue.length > 200) state.queue.shift()
  }

  function logRender(event, data = {}) {
    emit('render', event, data)
  }

  function logTabs(event, data = {}) {
    emit('tabs', event, data)
  }

  function logIpc(direction, name, data = {}) {
    emit('ipc', `${direction}:${name}`, data)
  }

  function logError(event, error, data = {}) {
    emit('error', event, {
      message: error && error.message ? error.message : String(error || ''),
      stack: error && error.stack ? String(error.stack).slice(0, 1200) : '',
      ...data
    })
  }

  function summarizeUiState() {
    const ui = global.state || {}
    const tabs = Array.isArray(ui.tabs) ? ui.tabs : []
    const activeTab = tabs.find(tab => String(tab.id) === String(ui.activeTabId)) || null
    return {
      top: ui.top || '',
      activeSection: ui.activeSection || '',
      activeWorkspaceId: ui.activeWorkspaceId || '',
      activeTabId: ui.activeTabId || '',
      tabCount: tabs.length,
      activeTabType: activeTab ? activeTab.type : '',
      activeTabDiscarded: activeTab ? Boolean(activeTab.discarded) : false,
      activeTabViewTier: activeTab ? (activeTab.viewTier || '') : '',
      aiPanelMinimized: Boolean(ui.aiPanelMinimized),
      aiPanelWidth: Number(ui.aiPanelWidth) || 0
    }
  }

  global.__nucleusDiag = {
    applyConfig,
    isEnabled,
    logRender,
    logTabs,
    logIpc,
    logError,
    summarizeUiState,
    wrapAsync(name, fn) {
      return async function wrappedAsync(...args) {
        const started = performance.now()
        logIpc('renderer', name, { phase: 'start', argsCount: args.length })
        try {
          const result = await fn.apply(this, args)
          logIpc('renderer', name, {
            phase: 'ok',
            durationMs: Math.round(performance.now() - started)
          })
          return result
        } catch (error) {
          logError(`renderer:${name}`, error, {
            durationMs: Math.round(performance.now() - started)
          })
          throw error
        }
      }
    }
  }

  function bootstrap() {
    if (!global.nucleus) return
    if (typeof global.nucleus.getDiagnosticsConfig === 'function') {
      global.nucleus.getDiagnosticsConfig()
        .then(applyConfig)
        .catch(noop)
      return
    }
    applyConfig({ enabled: false, channels: [] })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap)
  } else {
    bootstrap()
  }
})(window)
