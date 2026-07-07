// Reactive render-context store (main process).
// Functionality: holds live app state as independent slices (navigation, tabs,
// surface, native index). Each slice keeps a content hash + version so an update
// is a no-op when the value is unchanged. getSnapshot() assembles the versioned
// structured JSON shipped to the sidekick (index + UI slices + optional screen chunks).
// Dependencies: main.js pushes slice updates from renderer UI state, tab registry,
// and context-index rebuilds.

const SCHEMA_VERSION = 2

const SLICE_NAMES = ['app', 'layout', 'workspaces', 'tabs', 'activeTab', 'surface', 'index', 'screen', 'workspaceSession', 'workspaceContext']

function defaultSliceValue(name) {
  switch (name) {
    case 'app':
      return { top: 'section', activeSection: 'home', activeWorkspaceId: null }
    case 'layout':
      return { workspaceSidebarCollapsed: false, aiPanel: { width: 0, minimized: false } }
    case 'workspaces':
      return { active: null, open: [] }
    case 'tabs':
      return []
    case 'activeTab':
      return null
    case 'surface':
      return { kind: 'home', description: 'Home / launcher' }
    case 'index':
      return { courses: [], tasks: [], dueSoon: [], weekly: {}, focus: null, focusCourseIds: [] }
    case 'screen':
      return null
    case 'workspaceSession':
      return null
    case 'workspaceContext':
      return null
    default:
      return null
  }
}

// Stable stringify so key order does not produce spurious hash changes.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const keys = Object.keys(value).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function hashValue(value) {
  try {
    return stableStringify(value)
  } catch (_error) {
    return String(Math.random())
  }
}

class ContextStore {
  constructor() {
    this.slices = {}
    for (const name of SLICE_NAMES) {
      const value = defaultSliceValue(name)
      this.slices[name] = { value, hash: hashValue(value), version: 0 }
    }
    this.listeners = new Set()
  }

  // Returns true when the slice value actually changed.
  update(name, value) {
    const slice = this.slices[name]
    if (!slice) return false
    const nextValue = value === undefined ? null : value
    const hash = hashValue(nextValue)
    if (hash === slice.hash) return false
    slice.value = nextValue
    slice.hash = hash
    slice.version += 1
    this.emit(name)
    return true
  }

  get(name) {
    const slice = this.slices[name]
    return slice ? slice.value : null
  }

  version(name) {
    const slice = this.slices[name]
    return slice ? slice.version : 0
  }

  onChange(callback) {
    if (typeof callback !== 'function') return () => {}
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  emit(name) {
    for (const callback of this.listeners) {
      try {
        callback(name, this.slices[name] ? this.slices[name].value : null)
      } catch (_error) {
        // Listener errors must never break the update path.
      }
    }
  }

  getVersions() {
    const versions = {}
    for (const name of SLICE_NAMES) {
      versions[name] = this.slices[name].version
    }
    return versions
  }

  getSnapshot(options = {}) {
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      versions: this.getVersions(),
      app: this.slices.app.value,
      layout: this.slices.layout.value,
      workspaces: this.slices.workspaces.value,
      tabs: this.slices.tabs.value,
      activeTab: this.slices.activeTab.value,
      surface: this.slices.surface.value,
      index: this.slices.index.value,
      screen: this.slices.screen.value,
      workspaceSession: this.slices.workspaceSession.value,
      workspaceContext: this.slices.workspaceContext.value
    }
    return snapshot
  }
}

function createContextStore() {
  return new ContextStore()
}

module.exports = { ContextStore, createContextStore, SCHEMA_VERSION, SLICE_NAMES }
