// Shared diagnostics helpers for main + renderer.
// Enable with NUCLEUS_DEBUG=all or NUCLEUS_DEBUG=render,pool,ipc,tabs,layout,lifecycle,error,resources

const CHANNELS = Object.freeze([
  'render',
  'pool',
  'ipc',
  'tabs',
  'layout',
  'lifecycle',
  'error',
  'resources'
])

const ALL_CHANNELS = new Set(CHANNELS)

function parseChannelList(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value || value === '0' || value === 'false' || value === 'off') {
    return new Set()
  }
  if (value === '1' || value === 'true' || value === 'on' || value === 'all' || value === '*') {
    return new Set(ALL_CHANNELS)
  }
  const selected = new Set()
  value.split(/[,;\s]+/).filter(Boolean).forEach(token => {
    if (token === 'all' || token === '*') {
      CHANNELS.forEach(channel => selected.add(channel))
      return
    }
    if (ALL_CHANNELS.has(token)) selected.add(token)
  })
  return selected
}

function parseDiagnosticsConfig(env = (typeof process !== 'undefined' && process.env) || {}) {
  const channels = parseChannelList(env.NUCLEUS_DEBUG)
  const enabled = channels.size > 0
  const consoleEnabled = enabled && env.NUCLEUS_DEBUG_CONSOLE !== '0'
  const fileEnabled = enabled && env.NUCLEUS_DEBUG_FILE !== '0'
  return {
    enabled,
    channels,
    consoleEnabled,
    fileEnabled,
    sessionId: env.NUCLEUS_DEBUG_SESSION || ''
  }
}

function isEnvTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes'
}

function truncateString(value, max = 240) {
  const text = String(value == null ? '' : value)
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function sanitizeValue(value, depth = 0) {
  if (value == null) return value
  if (depth > 4) return '[max-depth]'
  if (typeof value === 'string') return truncateString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message, 500),
      stack: truncateString(value.stack || '', 1200)
    }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map(item => sanitizeValue(item, depth + 1))
  }
  if (typeof value !== 'object') return truncateString(value)

  const output = {}
  Object.keys(value).slice(0, 40).forEach(key => {
    const lower = key.toLowerCase()
    if (/(cookie|token|secret|password|authorization|apikey|api_key)/.test(lower)) {
      output[key] = '[redacted]'
      return
    }
    output[key] = sanitizeValue(value[key], depth + 1)
  })
  return output
}

function summarizeTab(tab) {
  if (!tab || tab === 'None') return null
  return {
    id: String(tab.id || ''),
    type: String(tab.type || ''),
    workspaceId: String(tab.workspaceId || ''),
    url: truncateString(tab.url || '', 160),
    canvasMode: tab.canvasMode || '',
    discarded: Boolean(tab.discarded),
    loading: Boolean(tab.loading),
    viewTier: tab.viewTier || '',
    hasView: Boolean(tab.view),
    poolType: tab.poolType || '',
    yindex: Number(tab.yindex) || 0
  }
}

function summarizeView(view) {
  if (!view) return null
  let destroyed = true
  let url = ''
  let visible = null
  let webContentsId = ''
  try {
    destroyed = view.webContents.isDestroyed()
    if (!destroyed) {
      url = truncateString(view.webContents.getURL() || '', 160)
      visible = typeof view.getVisible === 'function' ? Boolean(view.getVisible()) : null
      webContentsId = String(view.webContents.id || '')
    }
  } catch (_error) {}
  return {
    webContentsId,
    destroyed,
    url,
    visible,
    poolType: view._nucleusPoolType || '',
    restorePending: Boolean(view._nucleusRestorePending),
    slateNavigation: Boolean(view._nucleusSlateNavigationInProgress)
  }
}

function summarizePool(browserpool) {
  if (!browserpool) return null
  const summarizeBackup = type => browserpool.backupDeque(type).toArray().map(entry => ({
    role: entry.cache.role || '',
    tabId: entry.cache.tabId || '',
    url: truncateString(entry.cache.url || '', 120),
    workspaceId: entry.cache.workspaceId || '',
    tier: entry.cache.tier || ''
  }))
  return {
    web: {
      inUse: browserpool.inUseLength('web'),
      backup: browserpool.backupLength('web'),
      available: browserpool.availableLength('web'),
      active: browserpool.activeLength('web'),
      total: browserpool.totalLength('web'),
      backupEntries: summarizeBackup('web')
    },
    canvas: {
      inUse: browserpool.inUseLength('canvas'),
      backup: browserpool.backupLength('canvas'),
      available: browserpool.availableLength('canvas'),
      active: browserpool.activeLength('canvas'),
      total: browserpool.totalLength('canvas'),
      backupEntries: summarizeBackup('canvas')
    }
  }
}

function summarizeLayout(window, bounds = null, overlayDepth = null) {
  if (!window || window.isDestroyed()) return null
  const [width, height] = window.getContentSize()
  return {
    contentWidth: width,
    contentHeight: height,
    browserBounds: bounds,
    overlayDepth: overlayDepth == null ? undefined : overlayDepth
  }
}

module.exports = {
  CHANNELS,
  parseDiagnosticsConfig,
  parseChannelList,
  isEnvTruthy,
  sanitizeValue,
  summarizeTab,
  summarizeView,
  summarizePool,
  summarizeLayout
}
