// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

// Main Electron process.
// Functionality: owns BrowserWindow/WebContentsView lifecycle, IPC handlers,
// Canvas authentication, Canvas/browser tab navigation, agent tools, and search.
// Dependencies: renderer/preload.js IPC contract, app/canvas/api.js data sync,
// app/canvas/auth.js auth capture view, engine.js search renderer, sidekick.py
// and vector_retreival.py child processes.
const { app, BrowserWindow, ipcMain, WebContentsView, session, webFrameMain, globalShortcut, protocol } = require('electron');
const path = require('path');
const fs = require('fs')
const { spawn } = require('child_process')
const {open_canvas_auth_window, get_auth_token, get_auth_csrf, get_base_url} = require('./app/canvas/auth')
const { createAgentProcess } = require('./agent-process')
const { createDataStore } = require('./data-store')
const { createContextStore } = require('./context-store')
const {
  MAX_VISIBLE_TEXT_BLOCKS,
  MAX_VISIBLE_TEXT_CHARS,
  compactText,
  sliceVisiblePageTextBlocks
} = require('./context-pipeline')
const { renderwebsearchresult, searchweb } = require('./engine')
const { getAuthBounds, getBrowserBounds, setRightPanelWidth, setWorkspaceSidebarCollapsed } = require('./view-layout')
const {
  getFrameSnapshotName,
  isCanvasBrowserTab,
  isCanvasNativeTab,
  isLikelyDownloadUrl,
  isWebContentTab,
  normalizeBrowserUrl,
  normalizeFrameUrl,
  sameTabId
} = require('./tab-utils')
const { createCanvasApi } = require('./app/canvas/api')
const { createSynapseClient } = require('./app/synapse/client')
const {
  getThemeSelection,
  getRendererStylesheets,
  getCanvasThemeConfig,
  getThemeRuntime,
  buildThemeVarsCss,
  getThemePalette,
  readThemeCss,
  setStoredTheme,
  listThemes
} = require('./theme-manager')
const {
  creategmailauthview,
  get_token,
  getmail,
  getmailmeta,
  buildHtml,
  ensureMailAuth,
  getInboxHtml,
  getMailViewData,
  getMailMessage,
  getMailThread,
  sendMailMessage,
  modifyMailMessage,
  trashMailMessage,
  untrashMailMessage,
  deleteMailMessage,
  startMailWatcher,
  stopMailWatcher
} = require('./app/mail/api')
const {
  getMailContactsState,
  addMailContact,
  addOutgoingMailToContactChatAsync,
  startMailContactsSync
} = require('./app/mail/contacts')

function mailError(error) {
  return error && error.message ? error.message : String(error)
}


// ─────────────────────────────────────────────────────────────────────────────
// AGENT PROCESS (Python sidekick)
// ─────────────────────────────────────────────────────────────────────────────

let canvas_auth_cookie = null
let canvas_auth_csrf = null
let canvas_base_url = null
let authview = null
let canvasAuthWaiters = []
let canvasAuthValidated = false

class LinkedDeque {
  constructor() {
    this.head = null
    this.tail = null
    this.size = 0
  }

  get length() {
    return this.size
  }

  makeNode(value) {
    return { value, prev: null, next: null }
  }

  push(value) {
    return this.pushBack(value)
  }

  pop() {
    return this.popBack()
  }

  unshift(value) {
    return this.pushFront(value)
  }

  shift() {
    return this.popFront()
  }

  pushBack(value) {
    const node = this.makeNode(value)
    if (!this.tail) {
      this.head = node
      this.tail = node
    } else {
      node.prev = this.tail
      this.tail.next = node
      this.tail = node
    }
    this.size += 1
    return this.size
  }

  pushFront(value) {
    const node = this.makeNode(value)
    if (!this.head) {
      this.head = node
      this.tail = node
    } else {
      node.next = this.head
      this.head.prev = node
      this.head = node
    }
    this.size += 1
    return this.size
  }

  popBack() {
    if (!this.tail) return undefined
    const value = this.tail.value
    this.tail = this.tail.prev
    if (this.tail) {
      this.tail.next = null
    } else {
      this.head = null
    }
    this.size -= 1
    return value
  }

  popFront() {
    if (!this.head) return undefined
    const value = this.head.value
    this.head = this.head.next
    if (this.head) {
      this.head.prev = null
    } else {
      this.tail = null
    }
    this.size -= 1
    return value
  }

  peekFront() {
    return this.head ? this.head.value : undefined
  }

  peekBack() {
    return this.tail ? this.tail.value : undefined
  }

  clear() {
    this.head = null
    this.tail = null
    this.size = 0
  }

  toArray() {
    const values = []
    for (let node = this.head; node; node = node.next) {
      values.push(node.value)
    }
    return values
  }

  [Symbol.iterator]() {
    let node = this.head
    return {
      next() {
        if (!node) return { done: true }
        const value = node.value
        node = node.next
        return { value, done: false }
      }
    }
  }
}

const BROWSER_POOL_LIMITS = {
  web: { activeMax: 4, backupCount: 2, maxSize: 6 },
  canvas: { activeMax: 4, backupCount: 2, maxSize: 6 }
}
const BROWSER_POOL_PROTECTED_RECENT = 2
const CANVAS_PREDICTIVE_LINK_COUNT = 2
const canvasPredictiveByTab = new Map()

class BrowserPool {
  limits(type) {
    return BROWSER_POOL_LIMITS[type === "canvas" ? "canvas" : "web"]
  }

  maxSize(type) {
    return this.limits(type).maxSize
  }

  activeMax(type) {
    return this.limits(type).activeMax
  }

  backupCount(type) {
    return this.limits(type).backupCount
  }

  constructor() {
    this.availableweb = new LinkedDeque()
    this.availablecanvas = new LinkedDeque()
    this.backupweb = new LinkedDeque()
    this.backupcanvas = new LinkedDeque()
    this.preloadedcanvas = new LinkedDeque()
    this.inuseweb = new LinkedDeque()
    this.inusecanvas = new LinkedDeque()
  }

  inUseDeque(type) {
    return type === "web" ? this.inuseweb : this.inusecanvas
  }

  availableDeque(type) {
    return type === "web" ? this.availableweb : this.availablecanvas
  }

  backupDeque(type) {
    return type === "web" ? this.backupweb : this.backupcanvas
  }

  inUseLength(type) {
    return this.inUseDeque(type).length
  }

  backupLength(type) {
    return this.backupDeque(type).length
  }

  activeLength(type) {
    return this.availableLength(type) + this.inUseLength(type)
  }

  totalLength(type) {
    return this.activeLength(type) + this.backupLength(type)
  }

  normalizeBackupUrl(url) {
    return String(url || "").trim()
  }

  urlsLikelyMatch(left, right) {
    const a = this.normalizeBackupUrl(left)
    const b = this.normalizeBackupUrl(right)
    if (!a || !b) return false
    return a === b
  }

  makeBackupEntry(view, cache = {}) {
    return {
      view,
      cache: {
        role: cache.role || "predicted",
        tabId: cache.tabId ? String(cache.tabId) : "",
        url: this.normalizeBackupUrl(cache.url),
        label: cache.label || "",
        workspaceId: cache.workspaceId ? String(cache.workspaceId) : "",
        lastAccessedAt: Number(cache.lastAccessedAt) || Date.now(),
        tier: cache.tier || (cache.role === "stashed" ? "stashed" : "predicted")
      }
    }
  }

  touchBackupEntry(entry) {
    if (entry && entry.cache) {
      entry.cache.lastAccessedAt = Date.now()
    }
  }

  selectBackupEvictionEntry(type, activeWorkspaceId = "") {
    const entries = this.backupDeque(type).toArray()
    const stashed = entries.filter(entry => entry.cache.role === "stashed")
    if (!stashed.length) {
      return entries.find(entry => entry.cache.role === "predicted") || null
    }

    const normalizedWorkspaceId = String(activeWorkspaceId || "")
    const activeWorkspaceEntries = stashed
      .filter(entry => normalizedWorkspaceId && entry.cache.workspaceId === normalizedWorkspaceId)
      .sort((left, right) => (Number(right.cache.lastAccessedAt) || 0) - (Number(left.cache.lastAccessedAt) || 0))
    const protectedTabIds = new Set(
      activeWorkspaceEntries
        .slice(0, BROWSER_POOL_PROTECTED_RECENT)
        .map(entry => entry.cache.tabId)
        .filter(Boolean)
    )

    const candidates = stashed
      .filter(entry => !protectedTabIds.has(entry.cache.tabId))
      .sort((left, right) => {
        const leftActive = normalizedWorkspaceId && left.cache.workspaceId === normalizedWorkspaceId ? 1 : 0
        const rightActive = normalizedWorkspaceId && right.cache.workspaceId === normalizedWorkspaceId ? 1 : 0
        if (leftActive !== rightActive) return leftActive - rightActive
        return (Number(left.cache.lastAccessedAt) || 0) - (Number(right.cache.lastAccessedAt) || 0)
      })

    return candidates[0] || null
  }

  removeBackupEntry(type, entry) {
    const deque = this.backupDeque(type)
    const kept = deque.toArray().filter(item => item !== entry)
    deque.clear()
    kept.forEach(item => deque.pushBack(item))
  }

  findBackupEntry(type, tabId, url = "") {
    const entries = this.backupDeque(type).toArray()
    const normalizedTabId = String(tabId || "")
    const normalizedUrl = this.normalizeBackupUrl(url)

    let match = entries.find(entry => (
      entry.cache.role === "stashed" &&
      entry.cache.tabId &&
      entry.cache.tabId === normalizedTabId
    ))
    if (match) {
      this.touchBackupEntry(match)
      return match
    }

    if (normalizedUrl) {
      match = entries.find(entry => (
        entry.cache.role === "stashed" &&
        (!normalizedTabId || entry.cache.tabId === normalizedTabId) &&
        this.urlsLikelyMatch(entry.cache.url, normalizedUrl)
      ))
      if (match) {
        this.touchBackupEntry(match)
        return match
      }
    }

    if (type === "web") {
      return entries.find(entry => entry.cache.role === "predicted") || null
    }

    return null
  }

  takeBackup(type, tabId, url = "") {
    const entry = this.findBackupEntry(type, tabId, url)
    if (!entry) return null
    this.removeBackupEntry(type, entry)
    return entry.view
  }

  async ensureBackupSlots(window, type, predicted = null) {
    while (
      this.backupLength(type) < this.backupCount(type) &&
      this.totalLength(type) < this.maxSize(type)
    ) {
      const view = this.createView(type)
      view.setVisible(false)
      view.setBounds(getBrowserBounds(window))
      try {
        window.contentView.addChildView(view)
      } catch (_error) {
        // View may already be attached.
      }
      const warmUrl = predicted && predicted.url
        ? predicted.url
        : this.getWarmUrl(type)
      try {
        await view.webContents.loadURL(warmUrl)
      } catch (error) {
        console.error(`Unable to warm ${type} backup view:`, error)
      }
      this.backupDeque(type).pushBack(this.makeBackupEntry(view, {
        role: "predicted",
        tabId: predicted && predicted.tabId ? String(predicted.tabId) : "",
        url: warmUrl,
        label: predicted && predicted.label ? predicted.label : ""
      }))
    }
  }

  async syncPredictedBackups(window, tab) {
    if (!tab || !isWebContentTab(tab)) return

    const type = tab.type === "canvastab" ? "canvas" : "web"
    if (type === "canvas") {
      return
    }
    const predictedUrl = this.normalizeBackupUrl(
      tab.url ||
      (tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents.getURL() : "")
    )
    if (!predictedUrl || predictedUrl === canvasBlankWarmUrl) {
      await this.ensureBackupSlots(window, type)
      return
    }

    await this.ensureBackupSlots(window, type, {
      tabId: tab.id,
      url: predictedUrl,
      label: tab.label
    })

    for (const entry of this.backupDeque(type).toArray()) {
      if (entry.cache.role === "stashed") continue
      if (entry.view.webContents.isDestroyed()) continue
      if (this.urlsLikelyMatch(entry.cache.url, predictedUrl)) continue

      entry.cache = {
        role: "predicted",
        tabId: String(tab.id || ""),
        url: predictedUrl,
        label: tab.label || ""
      }
      entry.view.setVisible(false)
      try {
        await entry.view.webContents.loadURL(predictedUrl)
      } catch (error) {
        console.error(`Unable to refresh predicted ${type} backup:`, error)
      }
    }
  }

  async stashToBackup(window, type, view, cache = {}) {
    if (!view || view.webContents.isDestroyed()) {
      this.removeInUse(type, view)
      return "closed"
    }

    this.removeInUse(type, view)
    clearViewTabWireState(view)
    if (view._nucleusRevealTimer) {
      clearTimeout(view._nucleusRevealTimer)
      view._nucleusRevealTimer = null
    }

    const liveUrl = view.webContents.getURL()
    const entry = this.makeBackupEntry(view, {
      role: "stashed",
      tabId: cache.tabId,
      url: liveUrl && liveUrl !== canvasBlankWarmUrl && !isInternalEngineUrl(liveUrl)
        ? liveUrl
        : cache.url,
      label: cache.label,
      workspaceId: cache.workspaceId,
      lastAccessedAt: Date.now(),
      tier: "stashed"
    })

    const deque = this.backupDeque(type)
    while (deque.length >= this.backupCount(type)) {
      const evicted = this.selectBackupEvictionEntry(type, cache.activeWorkspaceId)
      if (!evicted) break
      this.removeBackupEntry(type, evicted)
      await discardBackupEntry(window, type, evicted)
    }

    if (window && !window.isDestroyed()) {
      detachWebContentView(window, view)
    } else {
      view.setVisible(false)
    }

    deque.pushBack(entry)
    await this.ensureBackupSlots(window, type)
    return "stashed"
  }

  async clearBackupForTab(window, type, tabId) {
    const normalizedTabId = String(tabId || "")
    if (!normalizedTabId) return

    for (const entry of this.backupDeque(type).toArray()) {
      if (entry.cache.tabId !== normalizedTabId) continue
      this.removeBackupEntry(type, entry)
      await this.releaseView(window, type, entry.view, false)
    }
    await this.ensureBackupSlots(window, type)
  }

  acquireForTab(type, tabId, url = "") {
    let view = this.takeBackup(type, tabId, url)
    const fromBackup = Boolean(view)
    let viewCameFromPool = false

    if (!view) {
      view = this.takeAvailable(type)
      viewCameFromPool = Boolean(view)
    }

    if (!view && this.totalLength(type) < this.maxSize(type)) {
      view = this.createView(type)
    }

    if (view) {
      view._nucleusPoolType = type
      this.addInUse(type, view)
    }

    return { view, fromBackup, viewCameFromPool }
  }

  acquirePredictiveView(type) {
    let view = this.takeAvailable(type)

    if (!view && this.totalLength(type) < this.maxSize(type)) {
      view = this.createView(type)
      if (view) {
        view._nucleusPoolType = type
        this.addInUse(type, view)
      }
    }

    if (view) {
      view._nucleusPoolType = type
    }

    return view
  }

  canAcquireActive(type) {
    return this.activeLength(type) < this.activeMax(type) && this.totalLength(type) < this.maxSize(type)
  }

  available(type) {
    if (type === "web") {
      if (this.availableweb.length > 0) {
        return this.availableweb.popFront()
      }
      return null
    }
    if (this.availablecanvas.length > 0) {
      return this.availablecanvas.popFront()
    }
    return null
  }

  addAvailable(type, view) {
    const entry = { type, view }
    if (type === "web") {
      return this.availableweb.pushBack(entry)
    }
    return this.availablecanvas.pushBack(entry)
  }

  takeAvailable(type) {
    const entry = this.available(type)
    if (!entry) {
      return null
    }
    this.addInUse(type, entry.view)
    return entry.view
  }

  addInUse(type, view) {
    const entry = { type, view }
    if (type === "web") {
      return this.inuseweb.pushBack(entry)
    }
    return this.inusecanvas.pushBack(entry)
  }

  removeInUse(type, view) {
    const deque = this.inUseDeque(type)
    const kept = deque.toArray().filter(entry => entry.view !== view)
    deque.clear()
    kept.forEach(entry => deque.pushBack(entry))
  }

  async releaseView(window, type, view, refill = true) {
    if (!view || view.webContents.isDestroyed()) {
      this.removeInUse(type, view)
      return "closed"
    }

    this.removeInUse(type, view)
    clearViewTabWireState(view)
    if (view._nucleusRevealTimer) {
      clearTimeout(view._nucleusRevealTimer)
      view._nucleusRevealTimer = null
    }

    if (
      this.activeLength(type) < this.activeMax(type) &&
      this.totalLength(type) < this.maxSize(type)
    ) {
      view.setVisible(false)
      if (window && !window.isDestroyed()) {
        view.setBounds(getBrowserBounds(window))
        try {
          window.contentView.addChildView(view)
        } catch (_error) {
          // View may already be attached to the content view.
        }
        try {
          await view.webContents.loadURL(this.getWarmUrl(type))
        } catch (error) {
          console.error(`Unable to warm released ${type} view:`, error)
        }
      }
      this.addAvailable(type, view)
      if (refill) await this.ensureBackupSlots(window, type)
      return "hidden"
    }

    try {
      if (window && !window.isDestroyed()) {
        window.contentView.removeChildView(view)
      }
    } catch (_error) {
      // View may already be detached.
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.close()
    }
    if (refill) await this.ensureBackupSlots(window, type)
    return "closed"
  }

  inUse(type) {
    if (type === "web") {
      return this.inuseweb.toArray()
    }
    return this.inusecanvas.toArray()
  }

  // Every live view across both pools and ALL states (in-use, available warm,
  // and backup/predicted/stashed warm), normalized to { type, view }. Used by
  // the theme system to re-skin open WebContentsViews on a runtime switch.
  // Backup/available views are warm engine.html pages themed at warm time, so
  // they must be re-injected too — otherwise a tab opened (or revealed) after a
  // switch shows the previous theme. Note: in-use/available entries are
  // { type, view } while backup entries are { view, cache }, so we tag the type
  // explicitly here rather than reading entry.type.
  allViews() {
    const tag = (type, entries) => entries.map(entry => ({ type, view: entry.view }))
    return [
      ...tag("web", this.inuseweb.toArray()),
      ...tag("web", this.availableweb.toArray()),
      ...tag("web", this.backupweb.toArray()),
      ...tag("canvas", this.inusecanvas.toArray()),
      ...tag("canvas", this.availablecanvas.toArray()),
      ...tag("canvas", this.backupcanvas.toArray())
    ]
  }

  availableLength(type) {
    if (type === "web") {
      return this.availableweb.length
    }
    return this.availablecanvas.length
  }

  totalAvailableLength() {
    return this.availableweb.length + this.availablecanvas.length
  }

  createView(type) {
    if (type === "canvas") {
      const canvasView = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, "app", "canvas", "preload.js"),
          sandbox: false
        }
      })
      wireKeyboardRoutingToWebContents(canvasView.webContents)
      return canvasView
    }
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "web-preload.js"),
        contextIsolation: true,
        sandbox: false
      }
    })
    wireKeyboardRoutingToWebContents(view.webContents)
    // Web views inject the active theme's engine.css on every load so engine.html
    // and search-result pages match the theme. (External sites are skipped inside
    // applyEngineTheme.) The preload only emits 'surface:scrolled' for the
    // render-context pipeline; it does not expose any bridge to external pages.
    view.webContents.on('dom-ready', () => {
      applyEngineTheme(view.webContents)
    })
    view.webContents.on('did-finish-load', () => {
      installEngineAppShortcutLaunchers(view.webContents).catch(() => {})
    })
    return view
  }

  getWarmUrl(type) {
    if (type === "canvas") {
      return canvasBlankWarmUrl
    }
    return getEngineUrl()
  }

  async warm(window, type, count) {
    for (let i = 0; i < count; i++) {
      const view = this.createView(type)
      view.setBounds(getBrowserBounds(window))
      view.setVisible(false)
      window.contentView.addChildView(view)
      await view.webContents.loadURL(this.getWarmUrl(type))
      this.addAvailable(type, view)
    }
  }

  async newTab(window, type) {
    await this.ensureBackupSlots(window, type)
    if (this.activeLength(type) >= this.activeMax(type) || this.totalLength(type) >= this.maxSize(type)) {
      return false
    }
    await this.warm(window, type, 1)
    return true
  }

  async load(window) {
    await this.ensureBackupSlots(window, "web")
    await this.ensureBackupSlots(window, "canvas")
    await this.warm(window, "web", 2)
    await this.warm(window, "canvas", 2)
  }

  hideAllViews(window = mainwindow) {
    for (const type of ["web", "canvas"]) {
      for (const entry of this.inUse(type)) {
        if (entry && entry.view && !entry.view.webContents.isDestroyed()) {
          detachWebContentView(window, entry.view)
        }
      }
      for (const entry of this.availableDeque(type).toArray()) {
        if (entry && entry.view && !entry.view.webContents.isDestroyed()) {
          detachWebContentView(window, entry.view)
        }
      }
      for (const entry of this.backupDeque(type).toArray()) {
        if (entry && entry.view && !entry.view.webContents.isDestroyed()) {
          detachWebContentView(window, entry.view)
        }
      }
    }
  }
}

const browserpool = new BrowserPool()
const envPath = path.join(__dirname, '.env')
const synapseClient = createSynapseClient({ getApiKey: () => getEnvValue('ANTHROPIC_API_KEY') })
let themeSelection = getThemeSelection(__dirname)
let activeThemeManifest = themeSelection.manifest
let activeThemeName = themeSelection.activeTheme
let canvasThemeConfig = getCanvasThemeConfig(__dirname)
let iframeInjectionFilesById = canvasThemeConfig.iframeInjectionPathsById
let activeThemeVarsCss = buildThemeVarsCss(getThemePalette(__dirname), themeSelection.manifest.colorScheme || 'dark')

// Re-reads theme config after a runtime theme switch so newly created Canvas
// tabs and injection lookups use the new theme. The renderer stylesheets are
// hot-swapped separately by the renderer; the warm-blank data URL keeps its
// original identity (used in equality checks) and refreshes on next restart.
function refreshThemeRuntime() {
  themeSelection = getThemeSelection(__dirname)
  activeThemeManifest = themeSelection.manifest
  activeThemeName = themeSelection.activeTheme
  canvasThemeConfig = getCanvasThemeConfig(__dirname)
  iframeInjectionFilesById = canvasThemeConfig.iframeInjectionPathsById
  activeThemeVarsCss = buildThemeVarsCss(getThemePalette(__dirname), themeSelection.manifest.colorScheme || 'dark')
}

// The active app-wide `:root` token block. Injected (harmlessly) into engine /
// web WebContentsViews and the slate overlay so they consume the same palette
// as the renderer shell. Custom properties don't affect arbitrary websites.
function getActiveThemeVarsCss() {
  return activeThemeVarsCss
}

// True for our own engine surfaces (home + file-backed search result pages).
function isInternalEngineUrl(value) {
  if (!value) return false
  return value.includes('engine.html')
    || value.includes('engine-search-cache')
    || value.startsWith('nucleus:')
}

// Injects CSS as an AUTHOR-origin <style> appended to <head>, not via
// webContents.insertCSS. insertCSS is user-origin and loses the cascade to a
// page's own inline <style>/<link> :root (which is exactly why engine/slate
// theming silently failed). Appending a <style> last in <head> guarantees our
// theme tokens win over the page's inline fallback :root. Re-uses a fixed id so
// repeated calls (dom-ready, theme switch) replace rather than stack.
async function injectAuthorThemeCss(webContents, id, css) {
  if (!webContents || webContents.isDestroyed() || !css) return
  const js = `(() => {
    try {
      let s = document.getElementById(${JSON.stringify(id)});
      if (!s) { s = document.createElement('style'); s.id = ${JSON.stringify(id)}; }
      s.textContent = ${JSON.stringify(css)};
      document.head.appendChild(s);
    } catch (_e) {}
  })();`
  try {
    await webContents.executeJavaScript(js, true)
  } catch (_error) {
    // View may be tearing down or showing a privileged page.
  }
}

// Injects the active theme's engine stylesheet (themes/<theme>/engine.css) into
// our own engine surfaces (home + file-backed search pages). That file is the
// authoritative, editable theme layer for the engine. We never touch arbitrary
// websites. Safe to call on every dom-ready.
async function applyEngineTheme(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  if (!isInternalEngineUrl(webContents.getURL())) return
  const css = readThemeCss(__dirname, `themes/${activeThemeName}/engine.css`, '')
  await injectAuthorThemeCss(webContents, 'nucleus-engine-theme', css)
}

async function installEngineAppShortcutLaunchers(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  const url = String(webContents.getURL() || '')
  if (!url.includes('engine.html')) return

  try {
    await webContents.executeJavaScript(`
      (() => {
        if (window.__nucleusEngineAppLaunchersInstalled) return;
        window.__nucleusEngineAppLaunchersInstalled = true;
        document.querySelectorAll('a[href^="nucleus://app/"]').forEach(link => {
          if (link.dataset.nucleusAppBound) return;
          link.dataset.nucleusAppBound = '1';
          link.addEventListener('click', event => {
            const href = link.getAttribute('href') || link.href || '';
            let app = '';
            try { app = new URL(href).pathname.replace(/^\\/+/, '').split('/')[0]; } catch (_error) {}
            if (window.__nucleusEngine && typeof window.__nucleusEngine.openApp === 'function' && app) {
              event.preventDefault();
              event.stopImmediatePropagation();
              window.__nucleusEngine.openApp(app);
            }
          }, true);
        });
      })();
    `, true)
  } catch (error) {
    console.error('Unable to bind engine app shortcut launchers:', error)
  }
}

function registerEngineIpcHandlers() {
  ipcMain.on('engine:internal-navigate', (event, url) => {
    const tab = resolveTabForSender(event.sender)
    if (!tab) return
    handleEngineInternalNavigation(tab, url)
  })

  ipcMain.on('engine:open-app', (event, appName) => {
    const tab = resolveTabForSender(event.sender)
    if (!tab || !appName) return
    openEngineAppInTab(tab, String(appName).trim())
  })

  ipcMain.on('engine:preload-ready', (event) => {
    installEngineAppShortcutLaunchers(event.sender).catch(() => {})
  })
}

registerEngineIpcHandlers()

// Re-injects the Canvas critical background + main injection stylesheet into a
// live Canvas view. Mirrors app/canvas/preload.js so the currently displayed
// Canvas page reskins immediately (later navigations reskin via the preload).
async function applyCanvasTheme(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  const gradient = canvasThemeConfig.criticalGradient
  const critical = `
    html, body, #application, .ic-app, .ic-Layout-wrapper,
    .ic-app-main-content, .ic-Layout-contentWrapper {
      background: ${gradient} !important;
      background-attachment: fixed !important;
    }
  `
  try {
    await webContents.insertCSS(getActiveThemeVarsCss())
    await webContents.insertCSS(critical)
    const injection = readInjectionCssFile(canvasThemeConfig.mainInjectionPath)
    if (injection) await webContents.insertCSS(injection)
  } catch (_error) {
    // Ignore views that are navigating or destroyed mid-injection.
  }
}

// Injects the active theme's slate stylesheet (themes/<theme>/slate.css) over
// the base slate.css, so the navigation cover matches the active theme. That
// file is the authoritative, editable theme layer for the slate overlay.
async function applySlateTheme() {
  if (!slate || !slate.webContents || slate.webContents.isDestroyed()) return
  const css = readThemeCss(__dirname, `themes/${activeThemeName}/slate.css`, '')
  await injectAuthorThemeCss(slate.webContents, 'nucleus-slate-theme', css)
}

// Updates the OS title-bar overlay (Windows) to the active palette.
function applyTitleBarTheme(window) {
  const win = window || BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed() || typeof win.setTitleBarOverlay !== 'function') return
  const palette = getThemePalette(__dirname)
  try {
    win.setTitleBarOverlay({
      color: palette['title-bar'],
      symbolColor: palette['title-bar-symbol'],
      height: 56
    })
  } catch (_error) {
    // setTitleBarOverlay is only available with a titleBarOverlay window.
  }
}

// Re-skins every live non-renderer surface after a runtime theme switch.
function reapplyThemeToOpenSurfaces() {
  applyTitleBarTheme()
  applySlateTheme()
  try {
    const entries = browserpool.allViews()
    console.log(`[theme-debug] reapply: ${entries.length} views (web inuse=${browserpool.inuseweb.length} avail=${browserpool.availableweb.length} backup=${browserpool.backupweb.length}; canvas inuse=${browserpool.inusecanvas.length} avail=${browserpool.availablecanvas.length} backup=${browserpool.backupcanvas.length})`)
    entries.forEach((entry, idx) => {
      if (!entry || !entry.view || entry.view.webContents.isDestroyed()) {
        console.log(`[theme-debug]   #${idx} ${entry && entry.type} <destroyed/empty>`)
        return
      }
      const wc = entry.view.webContents
      let url = ''
      try { url = wc.getURL() } catch (_e) { url = '<no-url>' }
      console.log(`[theme-debug]   #${idx} ${entry.type} url=${String(url).slice(0, 90)}`)
      // TEMP DIAGNOSTIC: flag any view that navigates within 4s of a theme
      // switch — that would be the source of a "tab reset". Auto-removed.
      const onNav = (_event, navUrl) => {
        console.log(`[theme-debug] !! NAVIGATION after theme switch on ${entry.type} -> ${String(navUrl).slice(0, 120)}`)
        console.log(new Error('[theme-debug] navigation stack').stack)
      }
      wc.on('did-start-navigation', onNav)
      setTimeout(() => { try { wc.removeListener('did-start-navigation', onNav) } catch (_e) {} }, 4000)
      if (entry.type === 'canvas') {
        applyCanvasTheme(wc)
      } else {
        applyEngineTheme(wc)
      }
    })
  } catch (error) {
    console.error('Unable to reapply theme to open views:', error)
  }
}
const canvasBlankWarmUrl = "data:text/html;charset=utf-8," + encodeURIComponent(`
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <style>
        html,
        body {
          background: ${canvasThemeConfig.criticalGradient};
          background-attachment: fixed;
          margin: 0;
          min-height: 100%;
        }
      </style>
    </head>
    <body></body>
  </html>
`)

const agent = createAgentProcess({
  scriptPath: path.join(__dirname, 'sidekick.py'),
  onText: text => {
    BrowserWindow.getAllWindows()[0].webContents.send('prompt:response-chunk', text)
  },
  onDone: () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window && !window.webContents.isDestroyed()) {
      window.webContents.send('prompt:response-done')
    }
  },
  onToolCall: data => runfunction(data)
})

const vectorRetrieval = (() => {
  let proc = null
  let stdoutBuffer = ''
  let pendingQueries = []
  let restartTimer = null

  function formatRetrievalContext(startpoints = []) {
    if (!Array.isArray(startpoints) || startpoints.length === 0) {
      return ''
    }
    const entries = startpoints.map((item, index) => {
      const name = item.name || item.id || 'Untitled'
      const type = item.type || 'item'
      const id = item.id ? ` (${item.id})` : ''
      const description = String(item.description || '').replace(/\s+/g, ' ').trim()
      const urlLines = [
        item.url ? `URL: ${item.url}` : '',
        item.canvaspreviewurl && item.canvaspreviewurl !== item.url ? `Canvas preview URL: ${item.canvaspreviewurl}` : '',
        item.downloadurl && item.downloadurl !== item.url ? `Download URL: ${item.downloadurl}` : ''
      ].filter(Boolean)
      const metadataLines = [
        item.coursename || item.courseName
          ? `Course: ${item.coursename || item.courseName}${item.courseid ? ` (${item.courseid})` : ''}`
          : item.courseid ? `Course ID: ${item.courseid}` : '',
        item.duedate ? `Due date: ${item.duedate}` : '',
        item.unlockdate ? `Unlock date: ${item.unlockdate}` : '',
        item.gradepercentage !== '' && item.gradepercentage !== null && item.gradepercentage !== undefined
          ? `Grade percentage: ${item.gradepercentage}`
          : ''
      ].filter(Boolean)
      return [
        `${index + 1}. [${type}] ${name}${id}`,
        description,
        ...urlLines,
        ...metadataLines
      ].filter(Boolean).join('\n')
    })
    return `\n\nRetrieved Canvas context:\n${entries.join('\n\n')}\n\nUse this retrieved context when it is relevant to the user's question.`
  }

  function rejectPendingQueries(error) {
    pendingQueries.forEach(item => item.reject(error))
    pendingQueries = []
  }

  function start() {
    if (proc && proc.exitCode === null && !proc.killed && !proc.stdin.destroyed) return
    proc = null
    stdoutBuffer = ''
    const newProc = spawn('python', [path.join(__dirname, 'vector_retreival.py')])
    proc = newProc
    console.log('vector retrieval process started', newProc.pid)

    newProc.stdout.on('data', chunk => {
      if (proc !== newProc) return
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''

      lines.forEach(line => {
        if (!line.trim()) return
        try {
          const result = JSON.parse(line)
          if (result.error) {
            console.error('vector retrieval error:', result)
            const pending = pendingQueries.shift()
            if (pending) pending.resolve([])
            return
          }
          const pending = pendingQueries.shift()
          if (pending) pending.resolve(result.startpoints || [])
        } catch (error) {
          console.error('vector retrieval invalid JSON:', line, error)
        }
      })
    })

    newProc.stderr.on('data', chunk => {
      if (proc !== newProc) return
      console.error('vector retrieval:', chunk.toString())
    })

    newProc.on('error', error => {
      if (proc !== newProc) return
      console.error('Vector retrieval process error', error)
      rejectPendingQueries(error)
      proc = null
    })

    newProc.on('close', code => {
      console.log('Vector retrieval process closed', code)
      if (proc !== newProc) return
      rejectPendingQueries(new Error(`Vector retrieval process closed with code ${code}`))
      proc = null
    })
  }

  start()

  return {
    restart() {
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      if (proc && !proc.killed) {
        proc.kill()
        proc = null
      }
      start()
    },
    restartSoon(delayMs = 1500) {
      if (restartTimer) {
        clearTimeout(restartTimer)
      }
      restartTimer = setTimeout(() => {
        restartTimer = null
        this.restart()
      }, delayMs)
    },
    sendQuery(query, options = {}) {
      if (!query) {
        return Promise.resolve([])
      }
      if (!proc || proc.killed || proc.stdin.destroyed) {
        start()
      }
      if (!proc || proc.killed || proc.stdin.destroyed) {
        console.error('vector retrieval unavailable after restart')
        return Promise.resolve([])
      }
      const line = JSON.stringify(['query', query, options]) + '\n'
      return new Promise(resolve => {
        let pendingItem = null
        const timeout = setTimeout(() => {
          const index = pendingQueries.indexOf(pendingItem)
          if (index !== -1) pendingQueries.splice(index, 1)
          console.error('vector retrieval timed out for query:', query)
          resolve([])
        }, 45000)

        pendingItem = {
          resolve: startpoints => {
            clearTimeout(timeout)
            resolve(startpoints)
          },
          reject: error => {
            clearTimeout(timeout)
            console.error('vector retrieval failed for query:', query, error)
            resolve([])
          }
        }
        pendingQueries.push(pendingItem)

        proc.stdin.write(line, error => {
          if (error) {
            const index = pendingQueries.indexOf(pendingItem)
            if (index !== -1) pendingQueries.splice(index, 1)
            pendingItem.reject(error)
            console.error('vector retrieval stdin write failed:', error)
          } else {
          }
        })
      })
    },
    contextFor(startpoints) {
      return formatRetrievalContext(startpoints)
    }
  }
})()

/**
 * Sends a user prompt payload to the Python agent over stdin.
 *
 * @param {Array|Object} payload - Message payload to forward to the agent
 *                                 (typically ["message", <string>]).
 * @returns {void}
 */
async function senduserprompt(payload) {
  if (Array.isArray(payload) && payload[0] === 'message') {
    const messagePayload = payload[1]
    const messageText = typeof messagePayload === 'object' && messagePayload !== null
      ? String(messagePayload.text || '')
      : String(messagePayload || '')
    const startpoints = messageText
      ? await vectorRetrieval.sendQuery(messageText, { mode: 'agent' })
      : []
    const retrievalContext = vectorRetrieval.contextFor(startpoints)
    const payloadObject = typeof messagePayload === 'object' && messagePayload !== null
      ? { ...messagePayload }
      : { text: String(messagePayload || '') }
    const existingSystemContext = String(payloadObject.systemContext || '').trim()
    const regionContext = String(payloadObject.regionContext || '').trim()
    // Live app/render state now travels as a structured, versioned snapshot the
    // sidekick formats itself; systemContext carries only ad-hoc text (region
    // capture + any caller-provided extra context).
    payloadObject.systemContext = [existingSystemContext, regionContext].filter(Boolean).join('\n\n')
    payloadObject.contextSnapshot = contextStore.getSnapshot()
    payloadObject.callContext = retrievalContext
    delete payloadObject.regionContext
    payloadObject.text = messageText
    logAppState('prompt-send')
    agent.send(['message', payloadObject])
    return
  }
  agent.send(payload)
}


// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────

let currtabs = []
let tabids = new Set()
let activetab = 'None'
// Reactive render-context store: single source of truth for the structured
// snapshot shipped to the sidekick. Slices are updated by event-driven
// contributors (renderer UI state, tab registry, per-surface screen providers).
const contextStore = createContextStore()
// Last UI-state payload pushed by the renderer (sections, layout, workspaces, full
// tab list incl. center/task tabs the main process does not track in currtabs).
let rendererUiState = null
// Tracks which side currently owns the screen slice so main-process pulls and
// renderer pushes never clobber each other for the active surface.
let screenSliceOwner = 'none'
let screenSliceSurfaceKey = ''
let tabOperationChain = Promise.resolve()

function runSerializedTabOperation(task) {
  const run = tabOperationChain.then(task, task)
  tabOperationChain = run.catch(() => {})
  return run
}
let rendererOverlayDepth = 0
let slate = null
let canvasSetupPromise = null
let mainwindow = null
let currentCanvasPageContext = null
let currentHtmlPageContext = null
let lastCanvasVisibleContextKey = ''
let lastHtmlVisibleContextKey = ''
let canvasVisibleContextPollInFlight = false
let htmlVisibleContextPollInFlight = false
let canvasVisibleContextUpdateQueued = false
let visibleContextUpdateQueued = false
let lastAppStateLogKey = ''
const MAX_REGION_TEXT_BLOCKS = 40
const MAX_REGION_TEXT_CHARS = 6000
// Cached lightweight Canvas graph index. The on-disk canvas_graph.json can be
// hundreds of MB, so we parse it at most once per file change and keep only the
// fields the visible-context feature needs (plus precomputed lookup maps).
let canvasGraphIndex = null
let canvasGraphVisibleIndexes = null
let canvasGraphCacheKey = ''

function isRegionCaptureShortcutInput(input) {
  if (!input || input.type !== 'keyDown') return false
  const key = String(input.key || '').toLowerCase()
  const code = String(input.code || '').toLowerCase()
  const modifier = Boolean(input.control || input.meta)
  return modifier && Boolean(input.shift) && !input.alt && (key === 'c' || code === 'keyc')
}

function logRegionCaptureDebug(stage, payload = {}) {
  // TODO(remove): temporary region-capture shortcut diagnostics
  console.log('[DEBUG][TODO_REMOVE] region_capture', { stage, ...payload })
}

function getActiveWebLikeMainTab() {
  const tab = activetab !== 'None' ? activetab : null
  if (!tab || !isWebContentTab(tab)) return null
  if (tab.type === 'browsertab') return tab
  if (tab.type === 'canvastab' && isCanvasBrowserTab(tab)) return tab
  return null
}

let lastRegionCaptureShortcutAt = 0

function dispatchRegionCaptureShortcut(source) {
  const now = Date.now()
  if (now - lastRegionCaptureShortcutAt < 500) {
    logRegionCaptureDebug('shortcut_dispatch_debounced', { source })
    return
  }
  lastRegionCaptureShortcutAt = now

  const focused = BrowserWindow.getFocusedWindow()
  if (!focused || focused.isDestroyed()) {
    logRegionCaptureDebug('shortcut_no_focused_window', { source })
    return
  }

  const activeWebTab = getActiveWebLikeMainTab()
  logRegionCaptureDebug('shortcut_dispatch', {
    source,
    focusedWindowId: focused.id,
    activeTabId: activeWebTab && activeWebTab.id ? activeWebTab.id : '',
    activeTabType: activeWebTab && activeWebTab.type ? activeWebTab.type : '',
    activeTabUrl: activeWebTab && activeWebTab.url ? activeWebTab.url : ''
  })

  if (!activeWebTab) {
    focused.webContents.send('shortcut:region_capture_failed', {
      reason: 'no_active_web_tab',
      message: 'Open a browser or Canvas web tab first, then press Ctrl+Shift+C.'
    })
    return
  }

  focused.webContents.send('shortcut:region_capture', { tabId: activeWebTab.id })
}

function wireKeyboardRoutingToWebContents(contents) {
  if (!contents || contents.isDestroyed() || contents._nucleusKeyboardRouted) return
  contents._nucleusKeyboardRouted = true
  try {
    contents.setIgnoreMenuShortcuts(true)
  } catch (_error) {}
  logRegionCaptureDebug('keyboard_routing_wired', {
    webContentsId: contents.id,
    url: typeof contents.getURL === 'function' ? contents.getURL() : ''
  })
  contents.on('before-input-event', (event, input) => {
    if (!isRegionCaptureShortcutInput(input)) return
    event.preventDefault()
    logRegionCaptureDebug('shortcut_before_input_event', {
      webContentsId: contents.id,
      url: typeof contents.getURL === 'function' ? contents.getURL() : '',
      key: input && input.key,
      code: input && input.code,
      type: input && input.type,
      control: Boolean(input && input.control),
      shift: Boolean(input && input.shift)
    })
    dispatchRegionCaptureShortcut('before_input_event')
  })
}

async function runInPageRegionOverlay(tab) {
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) {
    logRegionCaptureDebug('overlay_skip_no_tab_view', {
      tabId: tab && tab.id ? tab.id : '',
      tabType: tab && tab.type ? tab.type : ''
    })
    return null
  }
  logRegionCaptureDebug('overlay_start', {
    tabId: tab.id,
    tabType: tab.type,
    url: tab.url || ''
  })
  const localRegion = await tab.view.webContents.executeJavaScript(`
    (() => new Promise(resolve => {
      if (window.__nucleusRegionOverlayActive) {
        resolve(null);
        return;
      }
      window.__nucleusRegionOverlayActive = true;
      const doc = document;
      const overlay = doc.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "2147483647";
      overlay.style.cursor = "crosshair";
      overlay.style.background = "rgba(8, 16, 28, 0.12)";
      overlay.style.userSelect = "none";
      const box = doc.createElement("div");
      box.style.position = "fixed";
      box.style.border = "2px solid #55b89f";
      box.style.background = "rgba(85, 184, 159, 0.14)";
      box.style.display = "none";
      box.style.pointerEvents = "none";
      const hint = doc.createElement("div");
      hint.textContent = "Drag to capture region · Esc to cancel";
      hint.style.position = "fixed";
      hint.style.left = "12px";
      hint.style.top = "12px";
      hint.style.padding = "6px 10px";
      hint.style.borderRadius = "8px";
      hint.style.font = "600 12px -apple-system, Segoe UI, sans-serif";
      hint.style.color = "#ecf3ff";
      hint.style.background = "rgba(5, 9, 22, 0.86)";
      hint.style.border = "1px solid rgba(117, 103, 216, 0.48)";
      overlay.appendChild(box);
      overlay.appendChild(hint);
      doc.documentElement.appendChild(overlay);

      let start = null;
      let active = false;
      const cleanup = value => {
        window.__nucleusRegionOverlayActive = false;
        doc.removeEventListener("keydown", onKeyDown, true);
        overlay.removeEventListener("pointerdown", onPointerDown, true);
        overlay.removeEventListener("pointermove", onPointerMove, true);
        overlay.removeEventListener("pointerup", onPointerUp, true);
        overlay.removeEventListener("pointercancel", onPointerCancel, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(value);
      };
      const clampPoint = event => ({
        x: Math.max(0, Math.min(window.innerWidth, Number(event.clientX) || 0)),
        y: Math.max(0, Math.min(window.innerHeight, Number(event.clientY) || 0))
      });
      const paint = point => {
        if (!start || !point) return;
        const left = Math.min(start.x, point.x);
        const top = Math.min(start.y, point.y);
        const width = Math.max(0, Math.abs(point.x - start.x));
        const height = Math.max(0, Math.abs(point.y - start.y));
        box.style.display = width > 0 && height > 0 ? "block" : "none";
        box.style.left = left + "px";
        box.style.top = top + "px";
        box.style.width = width + "px";
        box.style.height = height + "px";
      };
      const onPointerDown = event => {
        event.preventDefault();
        active = true;
        start = clampPoint(event);
        paint(start);
        try { overlay.setPointerCapture(event.pointerId); } catch (_error) {}
      };
      const onPointerMove = event => {
        if (!active || !start) return;
        event.preventDefault();
        paint(clampPoint(event));
      };
      const onPointerUp = event => {
        if (!active || !start) return;
        event.preventDefault();
        const point = clampPoint(event);
        const left = Math.min(start.x, point.x);
        const top = Math.min(start.y, point.y);
        const width = Math.max(0, Math.abs(point.x - start.x));
        const height = Math.max(0, Math.abs(point.y - start.y));
        if (overlay.hasPointerCapture && overlay.hasPointerCapture(event.pointerId)) {
          try { overlay.releasePointerCapture(event.pointerId); } catch (_error) {}
        }
        cleanup(width >= 8 && height >= 8 ? { x: Math.round(left), y: Math.round(top), width: Math.round(width), height: Math.round(height) } : null);
      };
      const onPointerCancel = () => cleanup(null);
      const onKeyDown = event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cleanup(null);
      };
      doc.addEventListener("keydown", onKeyDown, true);
      overlay.addEventListener("pointerdown", onPointerDown, true);
      overlay.addEventListener("pointermove", onPointerMove, true);
      overlay.addEventListener("pointerup", onPointerUp, true);
      overlay.addEventListener("pointercancel", onPointerCancel, true);
    }))()
  `, true)
  logRegionCaptureDebug('overlay_finished', {
    tabId: tab.id,
    localRegion: localRegion || null
  })
  return localRegion
}

async function captureRegionContextForTab(tab, region = {}) {
  const browserBounds = getBrowserBounds(mainwindow, tab)
  const boundedSelection = clampRectToBounds({
    x: Number(region.x) || 0,
    y: Number(region.y) || 0,
    width: Number(region.width) || 0,
    height: Number(region.height) || 0
  }, browserBounds)
  if (boundedSelection.width <= 4 || boundedSelection.height <= 4) {
    return { ok: false, error: 'Selected region is too small.' }
  }
  const localRegion = {
    x: boundedSelection.x - browserBounds.x,
    y: boundedSelection.y - browserBounds.y,
    width: boundedSelection.width,
    height: boundedSelection.height
  }
  const result = await readHtmlVisibleTextState(tab, {
    region: localRegion,
    maxBlocks: MAX_REGION_TEXT_BLOCKS,
    maxChars: MAX_REGION_TEXT_CHARS
  })
  // Extracted DOM text for the selected region (previously discarded). Returned on
  // every mode so the LLM gets the actual on-screen text, not just a screenshot.
  const regionTextBlocks = trimVisibleTextBlocks(
    result && result.blocks,
    MAX_REGION_TEXT_BLOCKS,
    MAX_REGION_TEXT_CHARS
  )

  if (tab.type === 'canvastab') {
    const graph = getCanvasVisibleGraph()
    const activeUrl = String((result && result.url) || tab.url || '')
    const fileMatch = findCanvasFileForVisibleUrl(graph, activeUrl)
    if (graph && fileMatch && fileMatch.file && Array.isArray(fileMatch.file.pages) && fileMatch.file.pages.length) {
      const scrollState = await readCanvasVisibleScrollState(tab)
      const rangeStart = Math.max(0, (Number(scrollState && scrollState.scrollY) || 0) + (Number(localRegion.y) || 0))
      const rangeEnd = Math.max(rangeStart + 1, rangeStart + (Number(localRegion.height) || 0))
      const indexedContext = buildCanvasPageContextForRange(
        graph,
        fileMatch,
        activeUrl,
        rangeStart,
        rangeEnd,
        Number(scrollState && scrollState.scrollHeight) || 0,
        canvasGraphVisibleIndexes
      )
      if (indexedContext && Array.isArray(indexedContext.pages) && indexedContext.pages.length) {
        return {
          ok: true,
          mode: 'indexed',
          tabId: tab.id,
          type: 'canvas-indexed',
          url: activeUrl,
          title: String((result && result.title) || tab.label || ''),
          region: {
            x: Math.round(boundedSelection.x),
            y: Math.round(boundedSelection.y),
            width: Math.round(boundedSelection.width),
            height: Math.round(boundedSelection.height)
          },
          localRegion: result && result.region ? result.region : localRegion,
          visibleText: regionTextBlocks,
          indexedContext
        }
      }
    }
  }

  const image = await tab.view.webContents.capturePage({
    x: Math.round(localRegion.x),
    y: Math.round(localRegion.y),
    width: Math.max(1, Math.round(localRegion.width)),
    height: Math.max(1, Math.round(localRegion.height))
  })
  const imageData = image.toPNG().toString('base64')
  return {
    ok: true,
    mode: 'screenshot',
    tabId: tab.id,
    type: tab.type === 'canvastab' ? 'canvas-screenshot' : 'web-screenshot',
    url: String((result && result.url) || tab.url || ''),
    title: String((result && result.title) || tab.label || ''),
    region: {
      x: Math.round(boundedSelection.x),
      y: Math.round(boundedSelection.y),
      width: Math.round(boundedSelection.width),
      height: Math.round(boundedSelection.height)
    },
    localRegion: result && result.region ? result.region : localRegion,
    visibleText: regionTextBlocks,
    image: {
      mimeType: 'image/png',
      data: imageData,
      name: `region-${Date.now()}.png`
    }
  }
}

let canvasApi
const dataStore = createDataStore({
  sendToRenderer: (channel, payload) => {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send(channel, payload)
    })
  },
  getCanvasProjectGroups: () => canvasApi.getCanvasProjectGroups(),
  readCanvasData: () => canvasApi.readCanvasData()
})

function addCanvasTasks(tasks, options = {}) {
  const shouldRestartVector = options.restartVector !== false
  ;(tasks || []).forEach(task => {
    const metadata = {
      source: task.source,
      type: task.type,
      courseId: task.courseId,
      assignmentId: task.assignmentId,
      eventType: task.eventType,
      parentEventId: task.parentEventId,
      parentEventName: task.parentEventName,
      parentEventType: task.parentEventType,
      gradepercentage: task.gradepercentage,
      coveredConcepts: task.coveredConcepts,
      studyFiles: task.studyFiles,
      assignmentFiles: task.assignmentFiles,
      filechildren: task.filechildren,
      problems: task.problems,
      unlockdate: task.unlockdate,
      downloadurl: task.downloadurl,
      canvaspreviewurl: task.canvaspreviewurl,
      assignmenturl: task.assignmenturl
    }
    dataStore.newTask(
      task.title,
      task.priority_weight || 0,
      task.id,
      task.workspaceId || '',
      task.course || 'Canvas',
      task.details || '',
      task.due || 'No due date',
      task.estimate || '',
      task.color || '#7f77dd',
      task.urls || [],
      metadata
    )
  })
  if (shouldRestartVector) {
    vectorRetrieval.restartSoon()
  }
}

canvasApi = createCanvasApi({
  canvasDataPath: path.join(__dirname, 'canvas_data.json'),
  rootDir: __dirname,
  getAuthState: () => ({
    canvasAuthCookie: canvas_auth_cookie,
    canvasAuthCsrf: canvas_auth_csrf,
    canvasBaseUrl: canvas_base_url
  }),
  sendCanvasDataUpdate: () => dataStore.sendCanvasDataUpdate(),
  onCanvasTasks: (tasks, options) => addCanvasTasks(tasks, options)
})

addCanvasTasks(canvasApi.getCanvasTasksFromDisk(), { restartVector: false })

// return the contents of a file
function readInjectionCssFile(filename) {
  return readThemeCss(__dirname, filename, '')
}

function getEngineUrl() {
  return new URL('file://' + path.join(__dirname, 'engine.html').replace(/\\/g, '/')).href
}

function isEngineHomeUrl(value) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'nucleus:' && url.hostname === 'engine'
  } catch (_error) {
    return false
  }
}

function getEngineAppRoute(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'nucleus:' && url.hostname === 'app') {
      return url.pathname.replace(/^\/+/, '')
    }
  } catch (_error) {
    return null
  }
  return null
}

function getEngineSearchQuery(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'nucleus:' && url.hostname === 'search') {
      return {
        query: url.searchParams.get('q') || '',
        type: url.searchParams.get('type') || 'all'
      }
    }
  } catch (_error) {
    return null
  }
  return null
}

function getEngineCanvasRoute(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'nucleus:' && url.hostname === 'canvas') {
      return {
        url: url.searchParams.get('url') || '',
        courseId: url.searchParams.get('courseId') || '',
        type: url.searchParams.get('type') || '',
        id: url.searchParams.get('id') || ''
      }
    }
  } catch (_error) {
    return null
  }
  return null
}

function isCanvasBrowserUrl(value) {
  if (!value) return false
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return host.includes('instructure.com') || host.includes('canvas')
  } catch (_error) {
    return false
  }
}

function openEngineAppInTab(tab, appName) {
  if (!tab || !appName) return false
  hideAllWebContentViews(mainwindow)
  mainwindow.webContents.send('engine:open-app-in-tab', {
    tabId: tab.id,
    workspaceId: tab.workspaceId || null,
    app: appName
  })
  return true
}

function findTabForWebContents(webContents) {
  if (!webContents || webContents.isDestroyed()) return null
  return currtabs.find(tab => tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === webContents.id) || null
}

function resolveTabForWebContents(webContents) {
  const direct = findTabForWebContents(webContents)
  if (direct) return direct

  const activeWeb = getActiveWebLikeMainTab()
  if (activeWeb && activeWeb.view && activeWeb.view.webContents === webContents) {
    return activeWeb
  }

  if (activetab !== "None" && activetab.view && activetab.view.webContents === webContents) {
    return activetab
  }

  return null
}

function resolveTabForSender(webContents) {
  return resolveTabForWebContents(webContents) || getActiveWebLikeMainTab()
}

function handleEngineInternalNavigation(tab, url) {
  if (!tab || !url) return false

  if (isEngineHomeUrl(url)) {
    tab.url = 'nucleus://engine'
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.loadURL(getEngineUrl())
    }
    mainwindow.webContents.send('tabs:url_update', { id: tab.id, url: tab.url })
    return true
  }

  const searchQuery = getEngineSearchQuery(url)
  if (searchQuery !== null) {
    openEngineSearchInTab(tab, searchQuery.query, searchQuery.type).catch(error => {
      console.error('Unable to load engine search navigation:', error)
    })
    return true
  }

  const canvasRoute = getEngineCanvasRoute(url)
  if (canvasRoute !== null) {
    openEngineCanvasRoute(tab, canvasRoute)
    return true
  }

  const appRoute = getEngineAppRoute(url)
  if (appRoute) {
    openEngineAppInTab(tab, appRoute)
    return true
  }

  return false
}

async function reloadWebTabContent(tab, url) {
  if (!tab || !tab.view || tab.view.webContents.isDestroyed() || !url) return false

  const searchQuery = getEngineSearchQuery(url)
  if (searchQuery !== null) {
    return openEngineSearchInTab(tab, searchQuery.query, searchQuery.type)
  }
  if (handleEngineInternalNavigation(tab, url)) {
    return true
  }

  const normalizedUrl = normalizeBrowserUrl(url)
  await tab.view.webContents.loadURL(normalizedUrl || url)
  tab.url = normalizedUrl || url
  return true
}

function shouldKeepStashedWebContent(tab, loadedUrl) {
  if (!loadedUrl || loadedUrl === 'about:blank' || loadedUrl === canvasBlankWarmUrl) {
    return false
  }
  if (tab && tab.type === "canvastab") {
    return true
  }
  return isInternalEngineUrl(loadedUrl)
}

function openEngineCanvasRoute(tab, canvasRoute) {
  if (!tab || !canvasRoute || !canvasRoute.url) return false
  mainwindow.webContents.send('tabs:open_canvas_window', {
    workspaceId: tab.workspaceId,
    url: canvasRoute.url,
    courseId: canvasRoute.courseId,
    type: canvasRoute.type,
    id: canvasRoute.id
  })
  return true
}

function getEngineSearchPageUrl(tab, html, cacheKey = '') {
  const outputDir = path.join(__dirname, 'engine-search-cache')
  const safeId = String(tab && tab.id ? tab.id : 'search').replace(/[^a-zA-Z0-9_-]/g, '_')
  const filepath = path.join(outputDir, `${safeId}.html`)

  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(filepath, html, 'utf-8')
  const url = new URL('file://' + filepath.replace(/\\/g, '/'))
  if (cacheKey) url.searchParams.set('v', String(cacheKey))
  return url.href
}

async function getEngineSearchScrollY(tab) {
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return 0
  try {
    const scrollY = await tab.view.webContents.executeJavaScript(
      'Math.max(window.scrollY || 0, document.documentElement ? document.documentElement.scrollTop || 0 : 0, document.body ? document.body.scrollTop || 0 : 0)',
      true
    )
    return Number.isFinite(scrollY) ? Math.max(0, Math.round(scrollY)) : 0
  } catch {
    return 0
  }
}

async function renderEngineSearchPage(tab, result, query, searchType, options = {}) {
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return false
  const html = renderwebsearchresult({
    ...result,
    restoreScrollY: Number.isFinite(options.restoreScrollY) ? options.restoreScrollY : 0
  }, query, searchType)
  const url = getEngineSearchPageUrl(tab, html, options.cacheKey || Date.now())
  await tab.view.webContents.loadURL(url)
  return true
}

async function openEngineSearchInTab(tab, query, type = 'all') {
  if (!tab || !tab.view || !query) return false
  const searchType = ['all', 'images', 'news', 'videos'].includes(type) ? type : 'all'
  const searchToken = `${query}:${searchType}:${Date.now()}`
  tab.engineSearchToken = searchToken
  const internalPromise = vectorRetrieval.sendQuery(query, { mode: 'browser' })

  const finishInternalRender = async (baseResult, internalResults, internalError = '') => {
    if (!tab || tab.engineSearchToken !== searchToken || !tab.view || tab.view.webContents.isDestroyed()) return
    const scrollY = await getEngineSearchScrollY(tab)
    if (tab.engineSearchToken !== searchToken || !tab.view || tab.view.webContents.isDestroyed()) return
    await renderEngineSearchPage(tab, {
      ...baseResult,
      internalPending: false,
      internalResults: Array.isArray(internalResults) ? internalResults : [],
      internalError
    }, query, searchType, { restoreScrollY: scrollY })
  }

  try {
    const result = await searchweb(query)
    tab.url = `nucleus://search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(searchType)}`
    await renderEngineSearchPage(tab, { ...result, internalPending: true }, query, searchType)
    mainwindow.webContents.send('tabs:url_update', { id: tab.id, url: tab.url })
    internalPromise
      .then(internalResults => finishInternalRender(result, internalResults))
      .catch(error => finishInternalRender(result, [], error && error.message ? error.message : String(error)))
    return true
  } catch (error) {
    const result = {
      error: error && error.message ? error.message : String(error),
      web: { results: [] },
      internalPending: true
    }
    console.error("Unable to load Nucleus search:", error)
    tab.url = `nucleus://search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(searchType)}`
    await renderEngineSearchPage(tab, result, query, searchType)
    mainwindow.webContents.send('tabs:url_update', { id: tab.id, url: tab.url })
    internalPromise
      .then(internalResults => finishInternalRender(result, internalResults))
      .catch(internalError => finishInternalRender(result, [], internalError && internalError.message ? internalError.message : String(internalError)))
    return false
  }
}

function parseEnvValue(value) {
  const text = String(value || '').trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return text
}

function getEnvValue(name) {
  if (process.env[name]) return process.env[name]
  if (!fs.existsSync(envPath)) return ''
  const pattern = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*)\\s*$`)
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(pattern)
    if (match) return parseEnvValue(match[1])
  }
  return ''
}

function loadCanvasAuthFromEnv() {
  if (!fs.existsSync(envPath)) return false

  const values = {}
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  lines.forEach(line => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) return
    values[match[1]] = parseEnvValue(match[2])
  })

  canvas_auth_cookie = canvas_auth_cookie || values.CANVAS_AUTH_COOKIE || null
  canvas_auth_csrf = canvas_auth_csrf || values.CANVAS_AUTH_CSRF || null
  canvas_base_url = canvas_base_url || values.CANVAS_BASE_URL || null
  return Boolean(canvas_auth_cookie && canvas_base_url)
}

function clearCanvasAuthState() {
  canvas_auth_cookie = null
  canvas_auth_csrf = null
  canvasAuthValidated = false
}

const CANVAS_SYNC_RELATIVE_PATHS = [
  'canvas_data.json',
  'canvas_graph.json',
  'canvas_embedding_cache.json',
  'assignmenthtml.json',
  path.join('app', 'canvas', 'canvas_homepages'),
  'canvasfiles',
  'outside_sources',
  'engine-search-cache',
  'frame-html'
]

function clearCanvasSyncData() {
  const removed = []

  CANVAS_SYNC_RELATIVE_PATHS.forEach(relativePath => {
    const fullPath = path.join(__dirname, relativePath)
    try {
      if (!fs.existsSync(fullPath)) return
      if (fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true })
        removed.push(`${relativePath}/`)
      } else {
        fs.unlinkSync(fullPath)
        removed.push(relativePath)
      }
    } catch (error) {
      console.warn(`Unable to remove Canvas sync path ${relativePath}:`, error.message || error)
    }
  })

  canvasGraphIndex = null
  canvasGraphVisibleIndexes = null
  canvasGraphCacheKey = ''
  canvasInitialSetupDone = false
  const removedTasks = dataStore.removeCanvasTasks()
  dataStore.sendCanvasDataUpdate()
  vectorRetrieval.restartSoon()

  return { ok: true, removed, removedTasks }
}

async function validateCanvasAuthState() {
  if (!canvas_auth_cookie || !canvas_base_url) return false

  try {
    const response = await fetch(`${canvas_base_url}/api/v1/users/self`, {
      headers: {
        Cookie: canvas_auth_cookie,
        ...(canvas_auth_csrf ? { 'x-csrf-token': canvas_auth_csrf } : {})
      }
    })
    if (!response.ok) {
      console.warn(`Saved Canvas auth validation failed: ${response.status} ${response.statusText}`)
      return false
    }
    return true
  } catch (error) {
    console.warn("Saved Canvas auth validation failed:", error && error.message ? error.message : error)
    return false
  }
}

function parseCookieHeader(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const equalIndex = item.indexOf('=')
      if (equalIndex === -1) return null
      return {
        name: item.slice(0, equalIndex).trim(),
        value: item.slice(equalIndex + 1).trim()
      }
    })
    .filter(cookie => cookie && cookie.name)
}

async function installCanvasSessionCookies(targetSession = session.defaultSession) {
  if (!canvas_auth_cookie || !canvas_base_url) return
  const url = new URL(canvas_base_url)
  const cookieUrl = url.origin
  const secure = url.protocol === 'https:'
  const cookies = parseCookieHeader(canvas_auth_cookie)

  await Promise.all(cookies.map(cookie => {
    return targetSession.cookies.set({
      url: cookieUrl,
      name: cookie.name,
      value: cookie.value,
      secure,
      httpOnly: true,
      sameSite: 'no_restriction'
    })
  }))
}

async function hasCanvasSessionCookie(targetSession = session.defaultSession) {
  if (!canvas_base_url) return false
  try {
    const url = new URL(canvas_base_url)
    const cookies = await targetSession.cookies.get({
      url: url.origin,
      name: 'canvas_session'
    })
    return cookies.length > 0 && Boolean(cookies[0].value)
  } catch (_error) {
    return false
  }
}

function settleCanvasAuthWaiters(error = null) {
  const waiters = canvasAuthWaiters
  canvasAuthWaiters = []
  waiters.forEach(waiter => {
    if (error) {
      waiter.reject(error)
    } else {
      waiter.resolve(true)
    }
  })
}

function waitForCanvasAuth() {
  return new Promise((resolve, reject) => {
    canvasAuthWaiters.push({ resolve, reject })
  })
}


// ─────────────────────────────────────────────────────────────────────────────
// DATA MUTATIONS — Workspaces
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// DATA MUTATIONS — Tasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new task, appends it to the tasks list, and notifies the renderer.
 *
 * @param {string} title                  - Task title (required).
 * @param {number} priority_weight        - Priority weight used by the agent.
 * @param {string} [id="no task id"]      - Ignored; id is auto-generated from title.
 * @param {string} [workspaceId="no workspace id"] - Owning workspace id.
 * @param {string} [course="no course"]   - Course/project label.
 * @param {string} [details="unspecified task"] - Free-form description.
 * @param {string} [due="monday"]         - Due-date label.
 * @param {string} [estimate=""]          - Estimated time string.
 * @param {string} [color="no color"]     - Hex color used for UI accents.
 * @returns {string}                      - Human-readable confirmation message
 *                                          to send back to the agent as a tool
 *                                          response.
 */
function newTask(title, priority_weight, id = "no task id", workspaceId = "", course = "no course", details ="unspecified task", due = "monday", estimate = "", color = "no color", urls = [], metadata = {}) {
  return dataStore.newTask(title, priority_weight, id, workspaceId, course, details, due, estimate, color, urls, metadata)
}

/**
 * Removes a task from the tasks list by id.
 *
 * @param {string} id - The task id to remove.
 * @returns {string}  - Success message, or an error string if not found.
 *                      (Note: error branch currently does not return.)
 */
function deleteTask(id){
  return dataStore.deleteTask(id)
}


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Looks up the color associated with a project id across all project groups.
 *
 * @param {string} projectid - The project id to search for.
 * @returns {string}         - Hex color string, or "#000000" if not found.
 *                             (Note: returns group.color, not item.color.)
 */
function getprojectcolor(projectid) {
  return dataStore.getProjectColor(projectid)
}


// ─────────────────────────────────────────────────────────────────────────────
// AGENT TOOL DISPATCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatches a tool-call from the agent to the matching local function and
 * builds a tool_response array to send back over stdin.
 *
 * @param {Object} data         - Tool call payload from the agent.
 * @param {string} data.id      - Tool call id used to correlate the response.
 * @param {string} data.name    - Tool name (e.g. "add_task").
 * @param {Object} data.input   - Tool-specific input arguments.
 * @returns {Array}             - ["tool_response", <id>, <result>] tuple.
 */
async function openCanvasTabFromTool(input = {}) {
  const workspaceId = input.workspaceid
  const rawUrl = String(input.url || '').trim()
  const courseId = input.courseId || input.courseid || ''

  if (!dataStore.hasWorkspaceId(workspaceId)) {
    return "ERROR opening Canvas tab: workspace not found: " + workspaceId
  }

  if (!loadCanvasAuthFromEnv()) {
    return "ERROR opening Canvas tab: no saved Canvas authentication found. Open Canvas manually once to sign in."
  }

  try {
    await installCanvasSessionCookies()
    await setup()
  } catch (error) {
    return "ERROR opening Canvas tab: saved Canvas authentication failed: "
      + (error && error.message ? error.message : String(error))
  }

  const url = rawUrl || ''

  BrowserWindow.getAllWindows()[0].webContents.send('tabs:open_canvas_window', {
    url,
    workspaceId,
    courseId
  })

  if (url) {
    return `Opened Canvas tab in workspace ${workspaceId} at ${url} using saved Canvas auth.`
  }
  return `Opened Canvas app in workspace ${workspaceId} using saved Canvas auth.`
}

function formatCanvasContextForLumi(context) {
  if (!context || typeof context !== 'object') return ''

  const pages = Array.isArray(context.pages) ? context.pages : []
  const pageSummary = pages.length
    ? pages.map(page => {
      const num = page && page.pageNumber != null ? `p${page.pageNumber}` : 'p?'
      const y = Math.round(Number(page && page.yScroll) || 0)
      const ratio = Number(page && page.yScrollRatio)
      const ratioText = Number.isFinite(ratio) && ratio > 0 ? ` (${(ratio * 100).toFixed(1)}%)` : ''
      return `${num}@y=${y}${ratioText}`
    }).join(', ')
    : 'none'

  const concepts = Array.isArray(context.concepts) ? context.concepts : []
  const details = Array.isArray(context.details) ? context.details : []
  const examples = Array.isArray(context.examples) ? context.examples : []
  const problems = Array.isArray(context.problems) ? context.problems : []
  const conceptNames = concepts
    .map(item => String(item && item.name || '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(', ')

  const lines = [
    'Canvas visible context (live):',
    `URL: ${String(context.url || '')}`,
    `File: ${String(context.filename || '')}${context.fileid ? ` (${context.fileid})` : ''}`,
    `Course: ${String(context.courseid || '')}`,
    `Viewport: scrollY=${Math.round(Number(context.scrollY) || 0)}, viewportHeight=${Math.round(Number(context.viewportHeight) || 0)}, scrollHeight=${Math.round(Number(context.scrollHeight) || 0)}`,
    `Visible pages: ${pageSummary}`,
    `Visible nodes: concepts=${concepts.length}, details=${details.length}, examples=${examples.length}, problems=${problems.length}`,
    conceptNames ? `Top concepts: ${conceptNames}` : ''
  ].filter(Boolean)

  return lines.join('\n')
}

function pruneCanvasSourcePages(node) {
  return Array.isArray(node && node.sourcePages)
    ? node.sourcePages.map(page => ({ pageid: page && page.pageid }))
    : []
}

function pruneCanvasGraphChild(node) {
  return {
    id: node.id,
    conceptid: node.conceptid,
    problemid: node.problemid,
    name: node.name,
    courseid: node.courseid,
    description: node.description,
    answer: node.answer,
    sourcePages: pruneCanvasSourcePages(node)
  }
}

// Builds a compact, in-memory index from the full (possibly huge) canvas graph,
// keeping only the fields consumed by the visible-context pipeline. The full
// parsed graph is discarded afterwards so we never hold its full weight resident.
function buildLightweightCanvasIndex(graph) {
  if (!graph || typeof graph !== 'object') return null

  const files = {}
  for (const [courseId, courseFiles] of Object.entries(graph.files || {})) {
    if (!courseFiles || typeof courseFiles !== 'object') continue
    const outCourse = {}
    for (const [fileId, file] of Object.entries(courseFiles)) {
      if (!file) continue
      outCourse[fileId] = {
        courseid: file.courseid,
        fileid: file.fileid,
        name: file.name,
        canvaspreviewurl: file.canvaspreviewurl,
        downloadurl: file.downloadurl,
        pages: (Array.isArray(file.pages) ? file.pages : []).map(page => ({
          pageid: page.pageid,
          pageNumber: page.pageNumber,
          yScroll: page.yScroll,
          yScrollRatio: page.yScrollRatio,
          height: page.height,
          // Keep the actual page text + block-level positional text so the
          // render-context pipeline can surface what the user is reading (not just
          // concept names). `blocks` is present only for newly re-parsed graphs;
          // older graphs fall back to the page-level `text`.
          text: typeof page.text === 'string' ? page.text : '',
          blocks: (Array.isArray(page.blocks) ? page.blocks : []).map(block => ({
            text: String(block.text || ''),
            y0: Number(block.y0) || 0,
            y1: Number(block.y1) || 0,
            yRatio0: Number(block.yRatio0) || 0,
            yRatio1: Number(block.yRatio1) || 0
          })),
          nodes: (Array.isArray(page.nodes) ? page.nodes : []).map(ref => ({
            type: ref.type,
            id: ref.id,
            name: ref.name
          }))
        }))
      }
    }
    files[courseId] = outCourse
  }

  const concepts = (graph.concepts || []).map(concept => {
    const out = pruneCanvasGraphChild(concept)
    out.details = (concept.details || []).map(pruneCanvasGraphChild)
    out.examples = (concept.examples || []).map(pruneCanvasGraphChild)
    return out
  })

  const problems = (graph.problems || []).map(pruneCanvasGraphChild)

  const learningBlocks = {}
  Object.entries(graph.learningBlocks || {}).forEach(([courseId, blocks]) => {
    learningBlocks[courseId] = (Array.isArray(blocks) ? blocks : []).map(block => ({
      blockId: block.blockId,
      courseid: block.courseid || courseId,
      order: block.order,
      conceptId: block.conceptId,
      explanation: compactText(block.explanation || '', 320),
      detailRefs: block.detailRefs || [],
      examples: block.examples || [],
      practiceProblems: block.practiceProblems || [],
      orderSource: block.orderSource || 'merged'
    }))
  })

  const assignments = []
  Object.entries(graph.syllabi || {}).forEach(([courseId, syllabus]) => {
    ;(syllabus.assignments || []).forEach(assignment => {
      assignments.push({
        courseid: syllabus.courseid || courseId,
        assignmentid: assignment.assignmentid,
        name: assignment.name,
        submissionTypes: assignment.submissionTypes || [],
        submissionLinks: assignment.submissionLinks || [],
        submissionDependencies: assignment.submissionDependencies || [],
        conceptRequirements: assignment.conceptRequirements || [],
        lookingfor: assignment.lookingfor || []
      })
    })
  })

  return {
    files,
    concepts,
    problems,
    edges: graph.edges || [],
    learningBlocks,
    assignments,
    externalPlatforms: graph.external_platforms || {}
  }
}

function sleepSync(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {}
}

function readJsonFileWithRetry(filePath, attempts = 3, delayMs = 100) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      return raw.trim() ? JSON.parse(raw) : null
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) {
        sleepSync(delayMs)
      }
    }
  }
  throw lastError
}

// Returns the cached lightweight graph index, re-parsing canvas_graph.json only
// when its size/mtime changes. statSync is microseconds; the heavy parse only
// runs on an actual file change instead of on every visible-context update.
function getCanvasVisibleGraph() {
  const graphPath = path.join(__dirname, 'canvas_graph.json')
  let stat
  try {
    stat = fs.statSync(graphPath)
  } catch (_error) {
    canvasGraphIndex = null
    canvasGraphVisibleIndexes = null
    canvasGraphCacheKey = ''
    return null
  }

  const key = `${stat.mtimeMs}:${stat.size}`
  if (canvasGraphIndex && canvasGraphCacheKey === key) {
    return canvasGraphIndex
  }

  try {
    const parsed = readJsonFileWithRetry(graphPath)
    canvasGraphIndex = buildLightweightCanvasIndex(parsed)
    canvasGraphVisibleIndexes = canvasGraphIndex
      ? buildVisibleGraphIndexes(canvasGraphIndex)
      : null
    canvasGraphCacheKey = key
  } catch (error) {
    console.error("Unable to read canvas graph for visible context:", error)
    canvasGraphIndex = null
    canvasGraphVisibleIndexes = null
    canvasGraphCacheKey = ''
  }
  return canvasGraphIndex
}

function getCanvasCourseIdFromUrl(value) {
  try {
    const match = new URL(value).pathname.match(/\/courses\/([^/]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  } catch (_error) {
    return ''
  }
}

function getCanvasFileIdFromUrl(value) {
  try {
    const url = new URL(value)
    const pathMatch = url.pathname.match(/\/files\/([^/?#]+)/)
    if (pathMatch) return decodeURIComponent(pathMatch[1])

    const preview = url.searchParams.get('preview')
    if (preview && preview !== '1' && preview !== 'true') {
      return preview
    }
  } catch (_error) {
  }
  return ''
}

function normalizeUrlForContext(value) {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch (_error) {
    return String(value || '').replace(/#.*$/, '').replace(/\/$/, '')
  }
}

function logTabNavigationState(tab, url, eventType) {
  try {
    const isCanvas = tab && tab.type === "canvastab";
    const contextWindow = isCanvas ? currentCanvasPageContext : currentHtmlPageContext;
    const contextSummary = contextWindow
      ? {
          url: contextWindow.url || "",
          fileid: contextWindow.fileid || "",
          pageCount: Array.isArray(contextWindow.pages) ? contextWindow.pages.length : 0,
          conceptCount: Array.isArray(contextWindow.concepts) ? contextWindow.concepts.length : 0,
          detailCount: Array.isArray(contextWindow.details) ? contextWindow.details.length : 0,
          exampleCount: Array.isArray(contextWindow.examples) ? contextWindow.examples.length : 0,
          problemCount: Array.isArray(contextWindow.problems) ? contextWindow.problems.length : 0
        }
      : null;
    // TODO(remove): temporary navigation state diagnostics
    console.log("[DEBUG][TODO_REMOVE] nav_state", {
      eventType,
      tabId: tab && tab.id ? tab.id : "",
      tabType: tab && tab.type ? tab.type : "",
      workspaceId: tab && tab.workspaceId ? tab.workspaceId : "",
      canvasMode: tab && tab.canvasMode ? tab.canvasMode : "",
      yindex: Number(tab && tab.yindex || 0),
      url: String(url || ""),
      activeTabId: activetab && activetab.id ? activetab.id : (activetab || ""),
      currentTop: slate ? "workspace" : "",
      contextWindow: contextSummary
    })
  } catch (_error) {}
}

function findCanvasFileForVisibleUrl(graph, rawUrl) {
  if (!graph || !graph.files || !rawUrl) return null
  const fileId = getCanvasFileIdFromUrl(rawUrl)
  const courseId = getCanvasCourseIdFromUrl(rawUrl)

  if (fileId && courseId && graph.files[courseId] && graph.files[courseId][fileId]) {
    return { courseId, fileId, file: graph.files[courseId][fileId] }
  }

  for (const [candidateCourseId, courseFiles] of Object.entries(graph.files || {})) {
    if (!courseFiles || typeof courseFiles !== 'object') continue
    if (fileId && courseFiles[fileId]) {
      return { courseId: candidateCourseId, fileId, file: courseFiles[fileId] }
    }

    for (const [candidateFileId, file] of Object.entries(courseFiles)) {
      if (!file) continue
      if (fileId && String(file.fileid || '') === String(fileId)) {
        return { courseId: candidateCourseId, fileId: candidateFileId, file }
      }
    }
  }

  const normalizedCurrent = normalizeUrlForContext(rawUrl)
  for (const [candidateCourseId, courseFiles] of Object.entries(graph.files || {})) {
    for (const [candidateFileId, file] of Object.entries(courseFiles || {})) {
      const urls = [file.canvaspreviewurl, file.downloadurl].filter(Boolean).map(normalizeUrlForContext)
      if (urls.some(url => url && (url === normalizedCurrent || normalizedCurrent.startsWith(url) || url.startsWith(normalizedCurrent)))) {
        return { courseId: candidateCourseId, fileId: candidateFileId, file }
      }
    }
  }

  return null
}

function getNodeId(node) {
  return String(node && (node.conceptid || node.problemid || node.id || node.name) || '')
}

function summarizeGraphNode(type, node, fallback = {}) {
  if (!node) return null
  return {
    type,
    id: getNodeId(node) || getNodeId(fallback),
    name: String(node.name || fallback.name || ''),
    description: compactText(node.description || node.answer || fallback.description || '', 260),
    courseid: String(node.courseid || fallback.courseid || '')
  }
}

function collectNodeSourcePageIds(node) {
  return new Set((node && Array.isArray(node.sourcePages) ? node.sourcePages : [])
    .map(page => String(page && page.pageid || ''))
    .filter(Boolean))
}

function buildVisibleGraphIndexes(graph) {
  const concepts = new Map()
  const details = new Map()
  const examples = new Map()
  const problems = new Map()
  const learningBlocks = new Map()
  const assignments = new Map()

  ;(graph.learningBlocks ? Object.entries(graph.learningBlocks) : []).forEach(([courseId, blocks]) => {
    ;(blocks || []).forEach(block => {
      const blockId = String(block.blockId || '')
      if (blockId) learningBlocks.set(blockId, { ...block, courseid: block.courseid || courseId })
    })
  })

  ;(graph.assignments || []).forEach(assignment => {
    const assignmentId = String(assignment.assignmentid || '')
    if (assignmentId) assignments.set(assignmentId, assignment)
    if (assignment.name) assignments.set(String(assignment.name), assignment)
  })

  ;(graph.concepts || []).forEach(concept => {
    const conceptKey = getNodeId(concept)
    if (conceptKey) concepts.set(conceptKey, concept)
    if (concept.name) concepts.set(String(concept.name), concept)

    ;(concept.details || []).forEach(detail => {
      const id = getNodeId(detail) || `detail:${conceptKey}:${detail.name || ''}`
      const item = { ...detail, courseid: concept.courseid, parentConceptId: conceptKey, parentConceptName: concept.name }
      details.set(id, item)
      if (detail.name) details.set(String(detail.name), item)
    })

    ;(concept.examples || []).forEach(example => {
      const id = getNodeId(example) || `example:${conceptKey}:${example.name || ''}`
      const item = { ...example, courseid: concept.courseid, parentConceptId: conceptKey, parentConceptName: concept.name }
      examples.set(id, item)
      if (example.name) examples.set(String(example.name), item)
    })
  })

  ;(graph.problems || []).forEach(problem => {
    const problemKey = getNodeId(problem)
    if (problemKey) problems.set(problemKey, problem)
    if (problem.name) problems.set(String(problem.name), problem)
  })

  return { concepts, details, examples, problems, learningBlocks, assignments }
}

function addVisibleNode(target, type, node, fallback = {}) {
  const summary = summarizeGraphNode(type, node, fallback)
  if (!summary || !summary.name) return
  const key = `${type}:${summary.id || summary.name}`
  if (target.keys.has(key)) return
  target.keys.add(key)
  target[type === 'problem' ? 'problems' : `${type}s`].push(summary)
}

function resolvePageNode(indexes, ref) {
  if (!ref || !ref.type) return null
  const id = String(ref.id || ref.name || '')
  if (ref.type === 'concept') return { type: 'concept', node: indexes.concepts.get(id) || indexes.concepts.get(String(ref.name || '')) }
  if (ref.type === 'detail') return { type: 'detail', node: indexes.details.get(id) || indexes.details.get(String(ref.name || '')) }
  if (ref.type === 'example') return { type: 'example', node: indexes.examples.get(id) || indexes.examples.get(String(ref.name || '')) }
  if (ref.type === 'problem') return { type: 'problem', node: indexes.problems.get(id) || indexes.problems.get(String(ref.name || '')) }
  return null
}

function getVisiblePagesForScroll(file, scrollY, viewportHeight, scrollHeight = 0) {
  const pages = Array.isArray(file && file.pages) ? file.pages : []
  if (!pages.length) return []
  const start = Math.max(0, Number(scrollY) || 0)
  const end = start + Math.max(1, Number(viewportHeight) || 1)
  const sorted = [...pages].sort((a, b) => (Number(a.yScroll) || 0) - (Number(b.yScroll) || 0))
  const browserScrollHeight = Number(scrollHeight) || 0
  const canUseRatios = browserScrollHeight > 0 && sorted.some(page => Number(page.yScrollRatio) > 0)
  const visible = sorted.filter((page, index) => {
    const nextPage = sorted[index + 1]
    const pageStart = canUseRatios
      ? Math.max(0, (Number(page.yScrollRatio) || 0) * browserScrollHeight)
      : Number(page.yScroll) || 0
    const inferredHeight = nextPage
      ? Math.max(1, (canUseRatios ? (Number(nextPage.yScrollRatio) || 0) * browserScrollHeight : Number(nextPage.yScroll) || 0) - pageStart)
      : Number(page.height) || Math.max(1, browserScrollHeight - pageStart)
    const pageEnd = pageStart + Math.max(1, Number(page.height) && !canUseRatios ? Number(page.height) : inferredHeight)
    return pageEnd >= start && pageStart <= end
  })

  if (visible.length) return visible
  let closest = sorted[0]
  sorted.forEach(page => {
    const pageStart = canUseRatios
      ? Math.max(0, (Number(page.yScrollRatio) || 0) * browserScrollHeight)
      : Number(page.yScroll) || 0
    if (pageStart <= start) closest = page
  })
  return closest ? [closest] : []
}

function getVisiblePagesForRange(file, rangeStart, rangeEnd, scrollHeight = 0) {
  const pages = Array.isArray(file && file.pages) ? file.pages : []
  if (!pages.length) return []
  const start = Math.max(0, Number(rangeStart) || 0)
  const end = Math.max(start + 1, Number(rangeEnd) || 0)
  const sorted = [...pages].sort((a, b) => (Number(a.yScroll) || 0) - (Number(b.yScroll) || 0))
  const browserScrollHeight = Number(scrollHeight) || 0
  const canUseRatios = browserScrollHeight > 0 && sorted.some(page => Number(page.yScrollRatio) > 0)
  const visible = sorted.filter((page, index) => {
    const nextPage = sorted[index + 1]
    const pageStart = canUseRatios
      ? Math.max(0, (Number(page.yScrollRatio) || 0) * browserScrollHeight)
      : Number(page.yScroll) || 0
    const inferredHeight = nextPage
      ? Math.max(1, (canUseRatios ? (Number(nextPage.yScrollRatio) || 0) * browserScrollHeight : Number(nextPage.yScroll) || 0) - pageStart)
      : Number(page.height) || Math.max(1, browserScrollHeight - pageStart)
    const pageEnd = pageStart + Math.max(1, Number(page.height) && !canUseRatios ? Number(page.height) : inferredHeight)
    return pageEnd >= start && pageStart <= end
  })
  return visible
}

function buildCanvasPageContextForRange(graph, fileMatch, url, rangeStart, rangeEnd, scrollHeight, precomputedIndexes = null) {
  const file = fileMatch.file
  const visiblePages = getVisiblePagesForRange(file, rangeStart, rangeEnd, scrollHeight)
  const visiblePageIds = new Set(visiblePages.map(page => String(page.pageid || '')).filter(Boolean))
  const indexes = precomputedIndexes || buildVisibleGraphIndexes(graph)
  const result = {
    url,
    courseid: String(file.courseid || fileMatch.courseId || ''),
    fileid: String(file.fileid || fileMatch.fileId || ''),
    filename: String(file.name || ''),
    rangeStart: Math.round(Number(rangeStart) || 0),
    rangeEnd: Math.round(Number(rangeEnd) || 0),
    pages: visiblePages.map(page => ({
      pageid: String(page.pageid || ''),
      pageNumber: page.pageNumber || null,
      yScroll: Number(page.yScroll) || 0,
      yScrollRatio: Number(page.yScrollRatio) || 0
    })),
    concepts: [],
    details: [],
    examples: [],
    problems: []
  }
  const target = { ...result, keys: new Set() }

  visiblePages.forEach(page => {
    ;(page.nodes || []).forEach(ref => {
      const resolved = resolvePageNode(indexes, ref)
      if (!resolved) return
      addVisibleNode(target, resolved.type, resolved.node, ref)
    })
  })

  ;(graph.concepts || []).forEach(concept => {
    if ([...collectNodeSourcePageIds(concept)].some(pageid => visiblePageIds.has(pageid))) {
      addVisibleNode(target, 'concept', concept)
    }
    ;(concept.details || []).forEach(detail => {
      if ([...collectNodeSourcePageIds(detail)].some(pageid => visiblePageIds.has(pageid))) {
        addVisibleNode(target, 'detail', { ...detail, courseid: concept.courseid, parentConceptId: concept.conceptid, parentConceptName: concept.name })
      }
    })
    ;(concept.examples || []).forEach(example => {
      if ([...collectNodeSourcePageIds(example)].some(pageid => visiblePageIds.has(pageid))) {
        addVisibleNode(target, 'example', { ...example, courseid: concept.courseid, parentConceptId: concept.conceptid, parentConceptName: concept.name })
      }
    })
  })

  ;(graph.problems || []).forEach(problem => {
    if ([...collectNodeSourcePageIds(problem)].some(pageid => visiblePageIds.has(pageid))) {
      addVisibleNode(target, 'problem', problem)
    }
  })

  delete target.keys
  return target
}

function buildCanvasPageContext(graph, fileMatch, url, scrollState, precomputedIndexes = null) {
  const file = fileMatch.file
  const visiblePages = getVisiblePagesForScroll(file, scrollState.scrollY, scrollState.viewportHeight, scrollState.scrollHeight)
  const visiblePageIds = new Set(visiblePages.map(page => String(page.pageid || '')).filter(Boolean))
  const indexes = precomputedIndexes || buildVisibleGraphIndexes(graph)
  const result = {
    url,
    courseid: String(file.courseid || fileMatch.courseId || ''),
    fileid: String(file.fileid || fileMatch.fileId || ''),
    filename: String(file.name || ''),
    scrollY: Math.round(Number(scrollState.scrollY) || 0),
    scrollHeight: Math.round(Number(scrollState.scrollHeight) || 0),
    viewportHeight: Math.round(Number(scrollState.viewportHeight) || 0),
    pages: visiblePages.map(page => ({
      pageid: String(page.pageid || ''),
      pageNumber: page.pageNumber || null,
      yScroll: Number(page.yScroll) || 0,
      yScrollRatio: Number(page.yScrollRatio) || 0
    })),
    visibleTextBlocks: sliceVisiblePageTextBlocks(visiblePages, scrollState),
    concepts: [],
    details: [],
    examples: [],
    problems: []
  }
  const target = { ...result, keys: new Set() }

  visiblePages.forEach(page => {
    ;(page.nodes || []).forEach(ref => {
      const resolved = resolvePageNode(indexes, ref)
      if (!resolved) return
      addVisibleNode(target, resolved.type, resolved.node, ref)
    })
  })

  ;(graph.concepts || []).forEach(concept => {
    if ([...collectNodeSourcePageIds(concept)].some(pageid => visiblePageIds.has(pageid))) {
      addVisibleNode(target, 'concept', concept)
    }
    ;(concept.details || []).forEach(detail => {
      if ([...collectNodeSourcePageIds(detail)].some(pageid => visiblePageIds.has(pageid))) {
        addVisibleNode(target, 'detail', { ...detail, courseid: concept.courseid, parentConceptId: concept.conceptid, parentConceptName: concept.name })
      }
    })
    ;(concept.examples || []).forEach(example => {
      if ([...collectNodeSourcePageIds(example)].some(pageid => visiblePageIds.has(pageid))) {
        addVisibleNode(target, 'example', { ...example, courseid: concept.courseid, parentConceptId: concept.conceptid, parentConceptName: concept.name })
      }
    })
  })

  ;(graph.problems || []).forEach(problem => {
    if ([...collectNodeSourcePageIds(problem)].some(pageid => visiblePageIds.has(pageid))) {
      addVisibleNode(target, 'problem', problem)
    }
  })

  delete target.keys
  return target
}

function setCurrentCanvasPageContext(context) {
  currentCanvasPageContext = context || null
  logAppState('canvas-context')
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('canvas:visible_context', currentCanvasPageContext)
    }
  })
}

function trimVisibleTextBlocks(blocks, maxBlocks = MAX_VISIBLE_TEXT_BLOCKS, maxChars = MAX_VISIBLE_TEXT_CHARS) {
  const source = Array.isArray(blocks) ? blocks : []
  const trimmed = []
  let usedChars = 0

  for (const block of source) {
    if (!block || !block.text) continue
    if (trimmed.length >= maxBlocks) break
    const remaining = Math.max(maxChars - usedChars, 0)
    if (!remaining) break
    const text = compactText(block.text, Math.min(remaining, 320))
    if (!text) continue
    trimmed.push({
      tag: String(block.tag || ''),
      y: Math.round(Number(block.y) || 0),
      x: Math.round(Number(block.x) || 0),
      text
    })
    usedChars += text.length
  }

  return trimmed
}

function formatHtmlContextForLumi(context, title = 'HTML visible context (live):') {
  if (!context || typeof context !== 'object') return ''
  const blocks = Array.isArray(context.blocks) ? context.blocks : []
  const lines = [
    title,
    `URL: ${String(context.url || '')}`,
    `Viewport: scrollY=${Math.round(Number(context.scrollY) || 0)}, viewportHeight=${Math.round(Number(context.viewportHeight) || 0)}, scrollHeight=${Math.round(Number(context.scrollHeight) || 0)}`,
    `Visible text blocks: ${blocks.length}`
  ]

  if (blocks.length) {
    lines.push('Visible text sample:')
    blocks.slice(0, 10).forEach((block, index) => {
      lines.push(`${index + 1}. [${block.tag || 'text'} @ y=${Math.round(Number(block.y) || 0)}] ${block.text}`)
    })
  }

  return lines.join('\n')
}

function setCurrentHtmlPageContext(context) {
  currentHtmlPageContext = context || null
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('html:visible_context', currentHtmlPageContext)
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT STORE INTEGRATION
// Event-driven contributors that keep the reactive context slices current. Each
// helper recomputes a single slice; the store no-ops when the value is unchanged
// so only the part that actually changed is re-versioned.
// ─────────────────────────────────────────────────────────────────────────────

// Tab list slice: main-tracked web/native tabs (enriched) merged with renderer-only
// tabs (center/task) the main process does not hold in currtabs.
function recomputeTabsSlice() {
  const mainTabs = currtabs.filter(Boolean).map(compactTabForState).filter(Boolean)
  const seen = new Set(mainTabs.map(tab => String(tab.id)))
  const extra = []
  const rendererTabs = rendererUiState && Array.isArray(rendererUiState.tabs) ? rendererUiState.tabs : []
  for (const tab of rendererTabs) {
    if (!tab || seen.has(String(tab.id))) continue
    seen.add(String(tab.id))
    extra.push({
      id: tab.id,
      type: tab.type,
      label: tab.label || '',
      url: tab.url || '',
      workspaceId: tab.workspaceId || '',
      active: Boolean(activetab === 'None' && rendererUiState && sameTabId(rendererUiState.activeTabId, tab.id))
    })
  }
  contextStore.update('tabs', [...mainTabs, ...extra])
}

function recomputeActiveTabSlice() {
  if (activetab !== 'None') {
    contextStore.update('activeTab', compactTabForState(activetab))
    return
  }
  const ui = rendererUiState
  if (ui && ui.activeTabId) {
    const tab = (Array.isArray(ui.tabs) ? ui.tabs : []).find(item => sameTabId(item.id, ui.activeTabId))
    contextStore.update('activeTab', tab
      ? {
        id: tab.id,
        type: tab.type,
        label: tab.label || '',
        url: tab.url || '',
        workspaceId: tab.workspaceId || '',
        active: true
      }
      : null)
    return
  }
  contextStore.update('activeTab', null)
}

function updateSurfaceSlice() {
  const tab = activetab !== 'None' ? activetab : null
  const surface = describeRenderedSurface(tab)
  if (tab) {
    surface.url = tab.url || ''
  } else {
    const ui = rendererUiState
    if (ui && ui.top === 'section' && ui.activeSection) {
      surface.kind = `section-${ui.activeSection}`
      surface.description = `${ui.activeSection} section`
    } else if (ui && ui.top === 'workspace') {
      surface.kind = 'project-center'
      surface.description = 'Workspace Project Center'
    }
  }
  contextStore.update('surface', surface)
}

// Determines whether the main process (WebContentsView scrape) or the renderer
// (#view DOM push) owns the screen slice for the current surface. On a surface
// change the stale screen text is cleared so the new owner repopulates it.
function updateScreenOwnership() {
  const tab = activetab !== 'None' ? activetab : null
  const owner = isHtmlVisibleContextTab(tab) ? 'main' : 'renderer'
  const surfaceKey = tab
    ? `${tab.id}:${tab.type}:${tab.canvasMode || ''}`
    : `home:${(rendererUiState && rendererUiState.activeSection) || ''}:${(rendererUiState && rendererUiState.activeTabId) || ''}`
  if (owner !== screenSliceOwner || surfaceKey !== screenSliceSurfaceKey) {
    screenSliceOwner = owner
    screenSliceSurfaceKey = surfaceKey
    contextStore.update('screen', null)
  }
}

// Builds the screen slice for WebContentsView surfaces (websites + Canvas web /
// PDF previews) from the live HTML scrape and Canvas graph indexing. No-ops when
// the renderer owns the active surface (native apps / home / sections).
function composeScreenSliceFromMain() {
  if (screenSliceOwner !== 'main') return
  const tab = activetab !== 'None' ? activetab : null
  if (!isHtmlVisibleContextTab(tab)) return
  const canvas = currentCanvasPageContext
  const html = currentHtmlPageContext
  let screen = null

  if (canvas && Array.isArray(canvas.pages) && canvas.pages.length) {
    const textBlocks = Array.isArray(canvas.visibleTextBlocks) ? canvas.visibleTextBlocks : []
    const fallbackBlocks = html && Array.isArray(html.blocks) ? html.blocks : []
    const text = textBlocks.length ? textBlocks : fallbackBlocks
    const charCount = text.reduce((sum, block) => sum + (block && block.text ? block.text.length : 0), 0)
    screen = {
      source: textBlocks.length ? 'pdf' : 'canvas-graph',
      surfaceKind: 'canvas-web',
      url: String(canvas.url || ''),
      title: String((html && html.title) || tab.label || ''),
      scroll: {
        y: Math.round(Number(canvas.scrollY) || 0),
        ratio: Number(canvas.scrollHeight) ? (Number(canvas.scrollY) || 0) / Number(canvas.scrollHeight) : 0,
        viewportHeight: Math.round(Number(canvas.viewportHeight) || 0),
        contentHeight: Math.round(Number(canvas.scrollHeight) || 0)
      },
      text,
      canvas: {
        fileid: String(canvas.fileid || ''),
        filename: String(canvas.filename || ''),
        courseid: String(canvas.courseid || ''),
        pages: canvas.pages,
        concepts: canvas.concepts || [],
        details: canvas.details || [],
        examples: canvas.examples || [],
        problems: canvas.problems || []
      },
      truncated: false,
      charCount
    }
  } else if (html) {
    const blocks = Array.isArray(html.blocks) ? html.blocks : []
    const charCount = blocks.reduce((sum, block) => sum + (block && block.text ? block.text.length : 0), 0)
    screen = {
      source: 'webcontents',
      surfaceKind: tab.type === 'canvastab' ? 'canvas-web' : 'web',
      url: String(html.url || ''),
      title: String(html.title || tab.label || ''),
      scroll: {
        y: Math.round(Number(html.scrollY) || 0),
        ratio: Number(html.scrollHeight) ? (Number(html.scrollY) || 0) / Number(html.scrollHeight) : 0,
        viewportHeight: Math.round(Number(html.viewportHeight) || 0),
        contentHeight: Math.round(Number(html.scrollHeight) || 0)
      },
      text: blocks,
      canvas: null,
      truncated: false,
      charCount
    }
  }

  contextStore.update('screen', screen)
}

// Applies the renderer UI-state push (sections, layout, workspace catalog, full
// tab list) into the app/layout/workspaces slices and refreshes derived slices.
function applyRendererUiState(ui) {
  rendererUiState = ui && typeof ui === 'object' ? ui : null
  if (rendererUiState) {
    contextStore.update('app', {
      top: String(rendererUiState.top || 'section'),
      activeSection: String(rendererUiState.activeSection || ''),
      activeWorkspaceId: rendererUiState.activeWorkspaceId || null
    })
    contextStore.update('layout', {
      workspaceSidebarCollapsed: Boolean(rendererUiState.workspaceSidebarCollapsed),
      aiPanel: {
        width: Math.round(Number(rendererUiState.aiPanelWidth) || 0),
        minimized: Boolean(rendererUiState.aiPanelMinimized)
      }
    })
    const tabsList = Array.isArray(rendererUiState.tabs) ? rendererUiState.tabs : []
    const open = Array.isArray(rendererUiState.workspaces)
      ? rendererUiState.workspaces.map(workspace => ({
        id: workspace.id,
        name: workspace.name || '',
        description: workspace.description || '',
        openTabIds: tabsList.filter(tab => tab && tab.workspaceId === workspace.id).map(tab => tab.id)
      }))
      : []
    contextStore.update('workspaces', { active: rendererUiState.activeWorkspaceId || null, open })
  }
  recomputeTabsSlice()
  recomputeActiveTabSlice()
  updateSurfaceSlice()
  updateScreenOwnership()
}

// Refreshes the slices that depend on which surface is active. Called whenever the
// active tab / rendered surface changes.
function refreshContextForActiveSurface() {
  recomputeTabsSlice()
  recomputeActiveTabSlice()
  updateSurfaceSlice()
  updateScreenOwnership()
}

// Per-tab fields the LLM state cares about (every open tab, active or not).
function compactTabForState(tab) {
  if (!tab) return null
  const active = activetab !== 'None' && sameTabId(activetab.id, tab.id)
  const entry = {
    id: tab.id,
    type: tab.type,
    label: tab.label || '',
    url: tab.url || '',
    workspaceId: tab.workspaceId || '',
    active
  }
  if (tab.courseId) entry.courseId = tab.courseId
  if (tab.type === 'canvastab') entry.canvasMode = tab.canvasMode || 'native'
  if (tab.courseSection) entry.courseSection = tab.courseSection
  if (tab.canvasNativePage) entry.canvasNativePage = tab.canvasNativePage
  if (tab.loading) entry.loading = true
  return entry
}

// Describes the surface actually painted in the main content area right now.
function describeRenderedSurface(activeTab) {
  if (!activeTab) {
    return { kind: 'home', description: 'Home / launcher (no tab surface active)' }
  }
  if (isCanvasBrowserTab(activeTab)) {
    return {
      kind: 'canvas-web',
      description: `Canvas web page${activeTab.url ? ` — ${activeTab.url}` : ''}`
    }
  }
  if (isCanvasNativeTab(activeTab)) {
    const parts = []
    if (activeTab.courseId) parts.push(`course ${activeTab.courseId}`)
    if (activeTab.courseSection) parts.push(`section: ${activeTab.courseSection}`)
    if (activeTab.canvasNativePage) parts.push(`page: ${activeTab.canvasNativePage}`)
    return {
      kind: 'canvas-native',
      description: `Canvas native view${parts.length ? ` — ${parts.join(', ')}` : ''}`
    }
  }
  if (activeTab.type === 'mailtab') {
    return { kind: 'mail', description: 'Mail app' }
  }
  if (activeTab.type === 'synapsetab') {
    return { kind: 'synapse', description: 'Synapse AI chat app' }
  }
  if (activeTab.type === 'browsertab') {
    return { kind: 'web', description: `Web page${activeTab.url ? ` — ${activeTab.url}` : ''}` }
  }
  return { kind: activeTab.type || 'unknown', description: activeTab.type || 'unknown surface' }
}

// Aggregates the full user-facing state: what is rendered now, the active tab,
// every other open tab, and the live Canvas visible-context when present.
function buildAppStateSnapshot() {
  const active = activetab !== 'None' ? activetab : null
  const tabs = currtabs.filter(Boolean).map(compactTabForState).filter(Boolean)
  return {
    rendered: describeRenderedSurface(active),
    activeTab: active ? compactTabForState(active) : null,
    openTabs: tabs,
    canvas: currentCanvasPageContext || null,
    visibleText: currentHtmlPageContext || null
  }
}

// Renders the snapshot into the plain-text block injected into the LLM system
// prompt (senduserprompt) and mirrored into llm_context_log.jsonl.
function buildLiveAppStateText() {
  const snapshot = buildAppStateSnapshot()
  const describeTabLine = tab => {
    const meta = []
    if (tab.workspaceId) meta.push(`ws: ${tab.workspaceId}`)
    if (tab.courseId) meta.push(`course: ${tab.courseId}`)
    if (tab.canvasMode) meta.push(`mode: ${tab.canvasMode}`)
    if (tab.courseSection) meta.push(`section: ${tab.courseSection}`)
    if (tab.canvasNativePage) meta.push(`page: ${tab.canvasNativePage}`)
    if (tab.loading) meta.push('loading')
    const flag = tab.active ? '* ' : '  '
    const url = tab.url ? ` — ${tab.url}` : ''
    const metaText = meta.length ? ` (${meta.join(', ')})` : ''
    return `${flag}[${tab.type}] "${tab.label || 'Untitled'}"${url}${metaText}`
  }

  const lines = ['Live app state:']
  lines.push(`Currently rendered: ${snapshot.rendered.description}`)
  lines.push(snapshot.activeTab
    ? `Active tab: ${describeTabLine(snapshot.activeTab).trim()}`
    : 'Active tab: none (home / launcher)')
  lines.push('')
  lines.push(`Open tabs (${snapshot.openTabs.length}):`)
  if (snapshot.openTabs.length) {
    snapshot.openTabs.forEach(tab => lines.push(describeTabLine(tab)))
  } else {
    lines.push('  (none)')
  }

  const canvasBlock = formatCanvasContextForLumi(snapshot.canvas)
  if (canvasBlock) {
    lines.push('')
    lines.push(canvasBlock)
  }

  const htmlTitle = snapshot.visibleText && snapshot.visibleText.type === 'canvas-html'
    ? 'Canvas HTML visible context (live):'
    : 'HTML visible context (live):'
  const htmlBlock = formatHtmlContextForLumi(snapshot.visibleText, htmlTitle)
  if (htmlBlock) {
    lines.push('')
    lines.push(htmlBlock)
  }

  return lines.join('\n')
}

// Appends one JSONL record of the full app state handed to the LLM whenever it
// changes (tab open/close/switch, page change, y-scroll). `systemContext` is
// byte-identical to what senduserprompt() injects. De-duplicated so identical
// consecutive snapshots are not re-logged. Async write keeps the main thread free.
function logAppState(reason = '') {
  try {
    const snapshot = buildAppStateSnapshot()
    const contextSnapshot = contextStore.getSnapshot()
    const key = JSON.stringify(contextSnapshot.versions)
    if (key === lastAppStateLogKey) return
    lastAppStateLogKey = key

    const entry = {
      ts: new Date().toISOString(),
      reason,
      rendered: snapshot.rendered,
      activeTab: snapshot.activeTab,
      openTabs: snapshot.openTabs,
      canvas: snapshot.canvas
        ? {
          url: String(snapshot.canvas.url || ''),
          fileid: String(snapshot.canvas.fileid || ''),
          courseid: String(snapshot.canvas.courseid || ''),
          scrollY: Math.round(Number(snapshot.canvas.scrollY) || 0),
          viewportHeight: Math.round(Number(snapshot.canvas.viewportHeight) || 0),
          scrollHeight: Math.round(Number(snapshot.canvas.scrollHeight) || 0),
          visiblePages: Array.isArray(snapshot.canvas.pages)
            ? snapshot.canvas.pages.map(page => page && page.pageNumber)
            : []
        }
        : null,
      visibleText: snapshot.visibleText
        ? {
          url: String(snapshot.visibleText.url || ''),
          scrollY: Math.round(Number(snapshot.visibleText.scrollY) || 0),
          viewportHeight: Math.round(Number(snapshot.visibleText.viewportHeight) || 0),
          scrollHeight: Math.round(Number(snapshot.visibleText.scrollHeight) || 0),
          blocks: Array.isArray(snapshot.visibleText.blocks) ? snapshot.visibleText.blocks.length : 0
        }
        : null,
      // The structured snapshot shipped to the sidekick (single source of truth).
      snapshot: contextSnapshot
    }
    fs.appendFile(
      path.join(__dirname, 'llm_context_log.jsonl'),
      JSON.stringify(entry) + '\n',
      error => { if (error) console.error('Unable to write app-state log:', error) }
    )
  } catch (error) {
    console.error('Unable to log app state:', error)
  }
}

async function readCanvasVisibleScrollState(tab) {
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return null
  return tab.view.webContents.executeJavaScript(`
    (() => {
      const candidates = [];
      const addCandidate = (label, element, scrollTop, scrollHeight, clientHeight) => {
        const top = Number(scrollTop) || 0;
        const total = Number(scrollHeight) || 0;
        const height = Number(clientHeight) || 0;
        if (total > height + 4) candidates.push({ label, scrollY: top, scrollHeight: total, viewportHeight: height });
      };
      const doc = document.documentElement;
      const body = document.body;
      addCandidate("window", null, window.scrollY || (doc && doc.scrollTop) || (body && body.scrollTop) || 0, doc && doc.scrollHeight, window.innerHeight || (doc && doc.clientHeight) || 0);
      [doc, body, ...Array.from(document.querySelectorAll("*"))].forEach((element, index) => {
        if (!element) return;
        addCandidate("element:" + index, element, element.scrollTop, element.scrollHeight, element.clientHeight);
      });
      let selected = candidates[0] || { label: "window", scrollY: 0, scrollHeight: document.documentElement.scrollHeight || 0, viewportHeight: window.innerHeight || 0 };
      candidates.forEach(candidate => {
        if (candidate.scrollY > selected.scrollY || (candidate.scrollY === selected.scrollY && candidate.scrollHeight > selected.scrollHeight)) {
          selected = candidate;
        }
      });
      return {
        url: window.location.href,
        scrollY: Math.max(0, Math.round(selected.scrollY || 0)),
        scrollHeight: Math.max(0, Math.round(selected.scrollHeight || 0)),
        viewportHeight: Math.max(0, Math.round(selected.viewportHeight || window.innerHeight || 0)),
        source: selected.label
      };
    })()
  `, true)
}

async function readHtmlVisibleTextState(tab, options = {}) {
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return null
  const region = options && options.region && typeof options.region === 'object' ? options.region : null
  const maxBlocks = Number.isFinite(options.maxBlocks) ? options.maxBlocks : MAX_VISIBLE_TEXT_BLOCKS
  const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : MAX_VISIBLE_TEXT_CHARS
  const payload = JSON.stringify({
    region: region ? {
      x: Math.round(Number(region.x) || 0),
      y: Math.round(Number(region.y) || 0),
      width: Math.max(0, Math.round(Number(region.width) || 0)),
      height: Math.max(0, Math.round(Number(region.height) || 0))
    } : null,
    maxBlocks: Math.max(1, Math.round(maxBlocks)),
    maxChars: Math.max(200, Math.round(maxChars))
  })
  return tab.view.webContents.executeJavaScript(`
    (() => {
      const opts = ${payload};
      const doc = document.documentElement;
      const body = document.body;
      const viewportWidth = window.innerWidth || (doc && doc.clientWidth) || 0;
      const viewportHeight = window.innerHeight || (doc && doc.clientHeight) || 0;
      const pageScrollY = window.scrollY || (doc && doc.scrollTop) || (body && body.scrollTop) || 0;
      const pageScrollX = window.scrollX || (doc && doc.scrollLeft) || (body && body.scrollLeft) || 0;
      const selectors = [
        "main","article","section","aside","nav","header","footer",
        "h1","h2","h3","h4","h5","h6","p","li","dt","dd","blockquote","pre","code",
        "td","th","caption","figcaption","label","button","a","span","div"
      ].join(",");
      const region = opts.region;
      const viewportRegion = region
        ? {
            left: Math.max(0, Math.min(viewportWidth, Number(region.x) || 0)),
            top: Math.max(0, Math.min(viewportHeight, Number(region.y) || 0)),
            right: Math.max(0, Math.min(viewportWidth, (Number(region.x) || 0) + (Number(region.width) || 0))),
            bottom: Math.max(0, Math.min(viewportHeight, (Number(region.y) || 0) + (Number(region.height) || 0)))
          }
        : { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight };

      if (viewportRegion.right <= viewportRegion.left || viewportRegion.bottom <= viewportRegion.top) {
        return {
          url: window.location.href,
          title: document.title || "",
          scrollY: Math.max(0, Math.round(pageScrollY)),
          scrollX: Math.max(0, Math.round(pageScrollX)),
          scrollHeight: Math.max(0, Math.round((doc && doc.scrollHeight) || 0)),
          viewportHeight: Math.max(0, Math.round(viewportHeight)),
          viewportWidth: Math.max(0, Math.round(viewportWidth)),
          region: region ? {
            x: Math.round(viewportRegion.left),
            y: Math.round(viewportRegion.top),
            width: Math.round(viewportRegion.right - viewportRegion.left),
            height: Math.round(viewportRegion.bottom - viewportRegion.top)
          } : null,
          blocks: []
        };
      }

      const nodes = Array.from(document.querySelectorAll(selectors));
      const seen = new Set();
      const blocks = [];
      let chars = 0;

      for (const node of nodes) {
        if (!node || typeof node.getBoundingClientRect !== "function") continue;
        const rect = node.getBoundingClientRect();
        if (!rect || rect.width < 6 || rect.height < 6) continue;
        const intersects = rect.right > viewportRegion.left
          && rect.left < viewportRegion.right
          && rect.bottom > viewportRegion.top
          && rect.top < viewportRegion.bottom;
        if (!intersects) continue;

        const style = window.getComputedStyle(node);
        if (!style || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;

        let text = (node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim();
        if (!text || text.length < 2) continue;
        if (text.length > 280) text = text.slice(0, 280).trim();
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const remaining = Math.max(Number(opts.maxChars) - chars, 0);
        if (!remaining) break;
        if (text.length > remaining) text = text.slice(0, remaining).trim();
        if (!text) break;

        blocks.push({
          tag: String(node.tagName || "").toLowerCase(),
          text,
          y: Math.round(pageScrollY + rect.top),
          x: Math.round(pageScrollX + rect.left)
        });
        chars += text.length;
        if (blocks.length >= Number(opts.maxBlocks)) break;
      }

      blocks.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      return {
        url: window.location.href,
        title: document.title || "",
        scrollY: Math.max(0, Math.round(pageScrollY)),
        scrollX: Math.max(0, Math.round(pageScrollX)),
        scrollHeight: Math.max(0, Math.round((doc && doc.scrollHeight) || 0)),
        viewportHeight: Math.max(0, Math.round(viewportHeight)),
        viewportWidth: Math.max(0, Math.round(viewportWidth)),
        region: region ? {
          x: Math.round(viewportRegion.left),
          y: Math.round(viewportRegion.top),
          width: Math.round(viewportRegion.right - viewportRegion.left),
          height: Math.round(viewportRegion.bottom - viewportRegion.top)
        } : null,
        blocks
      };
    })()
  `, true)
}

// Per-child-frame visible-text extraction script. The main-frame scrape in
// readHtmlVisibleTextState cannot see into cross-origin iframes (Canvas PDF
// previews, embeds), so we run this in each child frame and merge the results.
function buildFrameVisibleTextScript(payloadJson) {
  return `
    (() => {
      const opts = ${payloadJson};
      const doc = document.documentElement;
      const body = document.body;
      const viewportWidth = window.innerWidth || (doc && doc.clientWidth) || 0;
      const viewportHeight = window.innerHeight || (doc && doc.clientHeight) || 0;
      const pageScrollY = window.scrollY || (doc && doc.scrollTop) || (body && body.scrollTop) || 0;
      const pageScrollX = window.scrollX || (doc && doc.scrollLeft) || (body && body.scrollLeft) || 0;
      const selectors = ["h1","h2","h3","h4","h5","h6","p","li","dt","dd","blockquote","pre","code","td","th","caption","figcaption","span","div","a"].join(",");
      const nodes = Array.from(document.querySelectorAll(selectors));
      const seen = new Set();
      const blocks = [];
      let chars = 0;
      for (const node of nodes) {
        if (!node || typeof node.getBoundingClientRect !== "function") continue;
        const rect = node.getBoundingClientRect();
        if (!rect || rect.width < 6 || rect.height < 6) continue;
        const intersects = rect.right > 0 && rect.left < viewportWidth && rect.bottom > 0 && rect.top < viewportHeight;
        if (!intersects) continue;
        const style = window.getComputedStyle(node);
        if (!style || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
        let text = (node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim();
        if (!text || text.length < 2) continue;
        if (text.length > 280) text = text.slice(0, 280).trim();
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const remaining = Math.max(Number(opts.maxChars) - chars, 0);
        if (!remaining) break;
        if (text.length > remaining) text = text.slice(0, remaining).trim();
        if (!text) break;
        blocks.push({ tag: String(node.tagName || "").toLowerCase(), text, y: Math.round(pageScrollY + rect.top), x: Math.round(pageScrollX + rect.left) });
        chars += text.length;
        if (blocks.length >= Number(opts.maxBlocks)) break;
      }
      blocks.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      return blocks;
    })()
  `
}

async function readChildFrameTextBlocks(tab, maxBlocks = MAX_VISIBLE_TEXT_BLOCKS, maxChars = MAX_VISIBLE_TEXT_CHARS) {
  const out = []
  try {
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return out
    const mainFrame = tab.view.webContents.mainFrame
    if (!mainFrame) return out
    const frames = Array.isArray(mainFrame.framesInSubtree) ? mainFrame.framesInSubtree : []
    let remainingBlocks = Math.max(0, Math.round(maxBlocks))
    let remainingChars = Math.max(0, Math.round(maxChars))
    for (const frame of frames) {
      if (!frame || frame === mainFrame) continue
      if (remainingBlocks <= 0 || remainingChars <= 0) break
      try {
        const payloadJson = JSON.stringify({ maxBlocks: remainingBlocks, maxChars: remainingChars })
        const frameBlocks = await frame.executeJavaScript(buildFrameVisibleTextScript(payloadJson), true)
        if (!Array.isArray(frameBlocks)) continue
        const frameUrl = String(frame.url || '')
        for (const block of frameBlocks) {
          if (!block || !block.text) continue
          out.push({
            tag: String(block.tag || 'frame'),
            text: String(block.text),
            y: Math.round(Number(block.y) || 0),
            x: Math.round(Number(block.x) || 0),
            frame: frameUrl
          })
          remainingBlocks -= 1
          remainingChars -= String(block.text).length
          if (remainingBlocks <= 0 || remainingChars <= 0) break
        }
      } catch (_frameError) {
        // Cross-process or detached frames can reject executeJavaScript; skip them.
      }
    }
  } catch (_error) {
    // Never let frame walking break the main visible-context path.
  }
  return out
}

function clampRectToBounds(rect, bounds) {
  const left = Math.max(Number(bounds.x) || 0, Number(rect.x) || 0)
  const top = Math.max(Number(bounds.y) || 0, Number(rect.y) || 0)
  const right = Math.min((Number(bounds.x) || 0) + (Number(bounds.width) || 0), (Number(rect.x) || 0) + (Number(rect.width) || 0))
  const bottom = Math.min((Number(bounds.y) || 0) + (Number(bounds.height) || 0), (Number(rect.y) || 0) + (Number(rect.height) || 0))
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  }
}

function isHtmlVisibleContextTab(tab) {
  return Boolean(tab && isWebContentTab(tab) && tab.view && !tab.view.webContents.isDestroyed())
}

async function updateCurrentHtmlVisibleContext() {
  if (htmlVisibleContextPollInFlight) return
  htmlVisibleContextPollInFlight = true
  try {
    const tab = activetab !== 'None' ? activetab : null
    if (!isHtmlVisibleContextTab(tab)) {
      if (lastHtmlVisibleContextKey !== 'none') {
        lastHtmlVisibleContextKey = 'none'
        setCurrentHtmlPageContext(null)
      }
      return
    }

    const state = await readHtmlVisibleTextState(tab)
    let rawBlocks = Array.isArray(state && state.blocks) ? state.blocks.slice() : []
    // Merge cross-origin / iframe text (e.g. Canvas PDF previews) the main-frame
    // scrape cannot reach. Budgeted so frame text never starves main-frame text.
    try {
      const frameBlocks = await readChildFrameTextBlocks(tab, MAX_VISIBLE_TEXT_BLOCKS, MAX_VISIBLE_TEXT_CHARS)
      if (frameBlocks.length) rawBlocks = rawBlocks.concat(frameBlocks)
    } catch (_frameError) {
      // Frame walking is best-effort; ignore failures.
    }
    const blocks = trimVisibleTextBlocks(rawBlocks)
    const context = state
      ? {
        type: tab.type === 'canvastab' ? 'canvas-html' : 'web-html',
        tabId: String(tab.id || ''),
        url: String((state && state.url) || tab.url || ''),
        title: String((state && state.title) || tab.label || ''),
        scrollY: Math.round(Number(state && state.scrollY) || 0),
        scrollX: Math.round(Number(state && state.scrollX) || 0),
        scrollHeight: Math.round(Number(state && state.scrollHeight) || 0),
        viewportHeight: Math.round(Number(state && state.viewportHeight) || 0),
        viewportWidth: Math.round(Number(state && state.viewportWidth) || 0),
        blocks
      }
      : null

    const key = context
      ? JSON.stringify({
        tabId: context.tabId,
        url: context.url,
        scrollY: context.scrollY,
        viewportHeight: context.viewportHeight,
        first: context.blocks.slice(0, 8).map(block => `${block.tag}:${block.y}:${block.text}`)
      })
      : `none:${tab.id}`
    if (key !== lastHtmlVisibleContextKey) {
      lastHtmlVisibleContextKey = key
      setCurrentHtmlPageContext(context)
    }
  } catch (error) {
    console.error("Unable to update HTML visible context:", error)
  } finally {
    htmlVisibleContextPollInFlight = false
  }
}

async function updateCurrentCanvasVisibleContext() {
  if (canvasVisibleContextPollInFlight) return
  canvasVisibleContextPollInFlight = true
  try {
    const tab = activetab !== 'None' ? activetab : null
    if (!tab || tab.type !== 'canvastab' || tab.canvasMode !== 'browser' || !tab.view) {
      if (lastCanvasVisibleContextKey !== 'none') {
        lastCanvasVisibleContextKey = 'none'
        setCurrentCanvasPageContext(null)
      }
      return
    }

    const scrollState = await readCanvasVisibleScrollState(tab)
    const url = (scrollState && scrollState.url) || tab.url || ''
    const graph = getCanvasVisibleGraph()
    const fileMatch = findCanvasFileForVisibleUrl(graph, url)
    if (!fileMatch || !fileMatch.file || !Array.isArray(fileMatch.file.pages) || !fileMatch.file.pages.length) {
      const key = `no-file:${tab.id}:${url}`
      if (lastCanvasVisibleContextKey !== key) {
        lastCanvasVisibleContextKey = key
        setCurrentCanvasPageContext(null)
      }
      return
    }

    const context = buildCanvasPageContext(graph, fileMatch, url, scrollState || { scrollY: 0, viewportHeight: 0 }, canvasGraphVisibleIndexes)
    const key = JSON.stringify({
      tabId: tab.id,
      url,
      scrollY: context.scrollY,
      viewportHeight: context.viewportHeight,
      pages: context.pages.map(page => page.pageid),
      counts: [context.concepts.length, context.details.length, context.examples.length, context.problems.length]
    })
    if (key !== lastCanvasVisibleContextKey) {
      lastCanvasVisibleContextKey = key
      setCurrentCanvasPageContext(context)
    }
  } catch (error) {
    console.error("Unable to update Canvas visible context:", error)
  } finally {
    canvasVisibleContextPollInFlight = false
  }
}

// Coalesces visible-context refreshes into a single trailing update. Invoked on
// Canvas scroll, tab activation, and navigation rather than on a fixed timer, so
// the main thread is only touched when the visible region can actually change.
function scheduleVisibleContextUpdate() {
  if (visibleContextUpdateQueued) return
  visibleContextUpdateQueued = true
  canvasVisibleContextUpdateQueued = true
  setTimeout(async () => {
    visibleContextUpdateQueued = false
    canvasVisibleContextUpdateQueued = false
    await updateCurrentCanvasVisibleContext()
    await updateCurrentHtmlVisibleContext()
    // Recompute the reactive screen slice from the freshly pulled contexts. No-ops
    // when unchanged, so a scroll that does not move the viewport text is free.
    composeScreenSliceFromMain()
    // Also captures tab open/close/switch that don't change the Canvas context.
    logAppState('surface-update')
  }, 80)
}

function scheduleCanvasVisibleContextUpdate() {
  scheduleVisibleContextUpdate()
}

function compactTab(tab) {
  if (!tab) return null
  return {
    id: tab.id,
    type: tab.type,
    label: tab.label || '',
    workspaceId: tab.workspaceId || '',
    url: tab.url || '',
    courseId: tab.courseId || '',
    active: activetab !== 'None' && sameTabId(activetab.id, tab.id)
  }
}

function listOpenTabsForTool(input = {}) {
  const workspaceId = String(input.workspaceid || input.workspaceId || '').trim()
  return currtabs
    .filter(tab => !workspaceId || tab.workspaceId === workspaceId)
    .map(compactTab)
    .filter(Boolean)
}

async function navigateTabFromTool(input = {}) {
  const tabId = input.tabid || input.tabId
  const value = String(input.url || input.value || '').trim()
  const foundtab = currtabs.find(localtab => sameTabId(localtab.id, tabId))
  if (!foundtab || !isWebContentTab(foundtab) || !foundtab.view) {
    return { ok: false, error: "Browser tab not found." }
  }
  if (!value) {
    return { ok: false, error: "No URL or search text provided." }
  }

  const searchQuery = getEngineSearchQuery(value)
  if (searchQuery !== null) {
    await openEngineSearchInTab(foundtab, searchQuery.query, searchQuery.type)
    return { ok: true, tab: compactTab(foundtab), search: searchQuery.query, type: searchQuery.type }
  }

  const canvasRoute = getEngineCanvasRoute(value)
  if (canvasRoute !== null) {
    openEngineCanvasRoute(foundtab, canvasRoute)
    return { ok: true, tab: compactTab(foundtab), canvas: canvasRoute.url }
  }

  const appRoute = getEngineAppRoute(value)
  if (appRoute) {
    openEngineAppInTab(foundtab, appRoute)
    return { ok: true, tab: compactTab(foundtab), app: appRoute }
  }

  const url = normalizeBrowserUrl(value)
  foundtab.url = url
  if (foundtab.type === "canvastab") {
    const hasAuth = await ensureCanvasAuthForNavigation(foundtab.view.webContents.session)
    if (!hasAuth) {
      mainwindow.webContents.send('canvas:navigation-finished', 'auth')
      revealCanvasView(foundtab.view)
      return { ok: false, error: "Canvas auth is not ready.", tab: compactTab(foundtab) }
    }
    await runCanvasSlateNavigation(mainwindow, foundtab.view, () => {
      return loadCanvasTabURL(foundtab.view, url, status => {
        mainwindow.webContents.send('canvas:navigation-finished', status)
      })
    })
  } else {
    await foundtab.view.webContents.loadURL(url)
  }
  mainwindow.webContents.send('tabs:url_update', { id: foundtab.id, url })
  return { ok: true, tab: compactTab(foundtab) }
}

function focusTabFromTool(input = {}) {
  const tabId = input.tabid || input.tabId
  const foundtab = currtabs.find(localtab => sameTabId(localtab.id, tabId))
  if (!foundtab) return { ok: false, error: "Tab not found." }
  mainwindow.webContents.send('tabs:tool_focus_tab', { tabId: foundtab.id })
  return { ok: true, tab: compactTab(foundtab) }
}

function closeTabFromTool(input = {}) {
  const tabId = input.tabid || input.tabId
  const foundtab = currtabs.find(localtab => sameTabId(localtab.id, tabId))
  if (!foundtab) return { ok: false, error: "Tab not found." }
  if (foundtab.type === "center") return { ok: false, error: "Cannot close workspace center tab." }
  mainwindow.webContents.send('tabs:tool_close_tab', { tabId: foundtab.id })
  return { ok: true, tab: compactTab(foundtab) }
}

function readCanvasDataForTool() {
  const data = canvasApi.readCanvasData()
  return data && typeof data === 'object' ? data : {}
}

function toolLimit(input = {}, fallback = 80) {
  const value = Number(input.limit)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), 200)
}

function compactCanvasCourses() {
  const data = readCanvasDataForTool()
  return (data.courses || []).map(course => ({
    id: String(course.id || ''),
    name: course.name || course.course_code || '',
    description: compactText(course.public_description || course.description || ''),
    course_code: course.course_code || ''
  }))
}

function compactCanvasAssignments(input = {}) {
  const data = readCanvasDataForTool()
  const courseFilter = String(input.courseid || input.courseId || '').trim()
  const assignmentsByCourse = data.assignments || {}
  return Object.entries(assignmentsByCourse).flatMap(([courseid, assignments]) => {
    if (courseFilter && String(courseid) !== courseFilter) return []
    return (assignments || []).map(assignment => ({
      id: String(assignment.id || assignment.assignmentid || ''),
      name: assignment.name || '',
      courseid: String(courseid),
      description: compactText(assignment.description || ''),
      due_at: assignment.due_at || assignment.dueDate || '',
      url: assignment.html_url || assignment.url || ''
    }))
  }).slice(0, toolLimit(input))
}

function compactCanvasFiles(input = {}) {
  const data = readCanvasDataForTool()
  const courseFilter = String(input.courseid || input.courseId || '').trim()
  const filesByCourse = data.file || data.files || {}
  return Object.entries(filesByCourse).flatMap(([courseid, files]) => {
    if (courseFilter && String(courseid) !== courseFilter) return []
    return (files || []).map(file => ({
      id: String(file.id || ''),
      name: file.display_name || file.filename || file.name || '',
      courseid: String(courseid),
      description: compactText(file.content_type || file['content-type'] || file.mime_class || ''),
      url: file.previewurl || file.url || ''
    }))
  }).slice(0, toolLimit(input))
}

function compactCanvasModules(input = {}) {
  const data = readCanvasDataForTool()
  const courseFilter = String(input.courseid || input.courseId || '').trim()
  const modulesByCourse = data.modules || {}
  return Object.entries(modulesByCourse).flatMap(([courseid, modules]) => {
    if (courseFilter && String(courseid) !== courseFilter) return []
    return (modules || []).map(module => ({
      id: String(module.id || ''),
      name: module.name || '',
      courseid: String(courseid),
      description: compactText(module.workflow_state || ''),
      position: module.position || ''
    }))
  }).slice(0, toolLimit(input))
}

async function refreshCanvasDataFromTool() {
  if (!loadCanvasAuthFromEnv()) {
    return { ok: false, error: "No saved Canvas authentication found. Open Canvas manually once to sign in." }
  }
  await installCanvasSessionCookies()
  await setup()
  const data = readCanvasDataForTool()
  return {
    ok: true,
    courses: Array.isArray(data.courses) ? data.courses.length : 0,
    assignmentCourses: data.assignments ? Object.keys(data.assignments).length : 0,
    fileCourses: data.file ? Object.keys(data.file).length : 0,
    moduleCourses: data.modules ? Object.keys(data.modules).length : 0
  }
}

async function runfunction(data) {
  let tool_response = ['tool_response', data.id]
  if (data.name === "add_task") {
     tool_response.push( newTask(
      data.input.task_name,
      data.input.priority_weight,
      undefined,
      "",
      data.input.project_name,
      "Added by agent",
      "unspecified",
      "",
      getprojectcolor(data.input.project_name)
    ));
  }
  else if (data.name === "open_browser_window") {
    const workspaceId = data.input.workspaceid
    const url = normalizeBrowserUrl(data.input.url)

    if (!dataStore.hasWorkspaceId(workspaceId)) {
      tool_response.push("ERROR opening browser tab: workspace not found: " + workspaceId)
      return tool_response
    }

    if (isCanvasBrowserUrl(url)) {
      BrowserWindow.getAllWindows()[0].webContents.send('tabs:open_canvas_window', {
        url,
        workspaceId
      })
      tool_response.push("Opened Canvas tab in workspace " + workspaceId + " at " + url)
    } else {
      BrowserWindow.getAllWindows()[0].webContents.send('tabs:open_browser_window', {
        url,
        workspaceId
      })
      tool_response.push("Opened browser tab in workspace " + workspaceId + " at " + url)
    }
  }
  else if (data.name === "open_canvas_tab") {
    tool_response.push(await openCanvasTabFromTool(data.input || {}))
  }
  else if (data.name === "create_workspace") {
    const input = data.input || {}
    tool_response.push(JSON.stringify(dataStore.newWorkspace(
      input.workspaceid || input.id,
      input.name || input.workspaceid || input.id,
      input.description || ''
    )))
  }
  else if (data.name === "delete_workspace") {
    tool_response.push(JSON.stringify(dataStore.deleteWorkspace((data.input || {}).workspaceid)))
  }
  else if (data.name === "get_all_workspaces") {
    tool_response.push(JSON.stringify(dataStore.getAllWorkspacesForTool()))
  }
  else if (data.name === "get_workspace_ids_by_name") {
    tool_response.push(JSON.stringify(dataStore.getWorkspaceIdsByName(data.input.workspace_name)))
  }
  else if (data.name === "list_open_tabs") {
    tool_response.push(JSON.stringify(listOpenTabsForTool(data.input || {})))
  }
  else if (data.name === "focus_tab") {
    tool_response.push(JSON.stringify(focusTabFromTool(data.input || {})))
  }
  else if (data.name === "close_tab") {
    tool_response.push(JSON.stringify(closeTabFromTool(data.input || {})))
  }
  else if (data.name === "navigate_tab") {
    tool_response.push(JSON.stringify(await navigateTabFromTool(data.input || {})))
  }
  else if (data.name === "list_canvas_courses") {
    tool_response.push(JSON.stringify(compactCanvasCourses()))
  }
  else if (data.name === "list_canvas_assignments") {
    tool_response.push(JSON.stringify(compactCanvasAssignments(data.input || {})))
  }
  else if (data.name === "list_canvas_files") {
    tool_response.push(JSON.stringify(compactCanvasFiles(data.input || {})))
  }
  else if (data.name === "list_canvas_modules") {
    tool_response.push(JSON.stringify(compactCanvasModules(data.input || {})))
  }
  else if (data.name === "refresh_canvas_data") {
    tool_response.push(JSON.stringify(await refreshCanvasDataFromTool()))
  }
  else{
    tool_response.push("Main.js could not find function, nothing changed")
  }
  return tool_response
}


// ─────────────────────────────────────────────────────────────────────────────
// WINDOW & TAB MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the main BrowserWindow with the app's preload script and styling.
 *
 * @returns {BrowserWindow} - The newly created main window instance.
 */
function createWindow() {
  const palette = getThemePalette(__dirname)
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: palette['title-bar'],
      symbolColor: palette['title-bar-symbol'],
      height: 56
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  wireKeyboardRoutingToWebContents(window.webContents)
  window.loadFile(path.join(__dirname, 'index.html'));
  return window;
}

/**
 * Renders (shows + repositions) the given tab view, or hides the active tab
 * if 'None' is passed.
 *
 * @param {WebContentsView|'None'} view - The view to show, or 'None' to hide.
 * @returns {void}
 */
const TAB_VIEW_WIRE_EVENTS = [
  "will-navigate",
  "did-navigate",
  "did-navigate-in-page",
  "did-start-navigation",
  "did-finish-load",
  "did-frame-finish-load",
  "console-message"
]

function clearViewTabWireState(view) {
  if (!view) return
  view._nucleusWiredTabId = null
  view._nucleusWireKey = null
  view._nucleusTabWired = false
  view._nucleusTitleWired = false
  view._nucleusPredictiveSwapHandlerAttached = false
  view._nucleusPredictiveHandlersAttached = false
  view._nucleusPredictive = false
}

function sendTabTitleUpdate(tab, title) {
  const window = mainwindow
  if (!tab || !window || window.isDestroyed() || !isWebContentTab(tab)) return
  const clean = String(title || '').trim()
  if (!clean) return
  window.webContents.send('tabs:title_update', { id: tab.id, title: clean })
}

function pushTabTitleFromView(window, view, tab) {
  if (!view || view.webContents.isDestroyed()) return
  const ownerTab = resolveTabForView(view, tab)
  if (!ownerTab || !isWebContentTab(ownerTab)) return
  try {
    const title = view.webContents.getTitle()
    if (title) sendTabTitleUpdate(ownerTab, title)
  } catch (_error) {}
}

function wireTabTitleUpdates(window, view, tab) {
  if (!view || view._nucleusTitleWired) return
  view._nucleusTitleWired = true
  view.webContents.on('page-title-updated', (_event, title) => {
    const ownerTab = resolveTabForView(view, tab)
    if (!ownerTab || ownerTab.view !== view) return
    sendTabTitleUpdate(ownerTab, title)
  })
  view.webContents.on('did-finish-load', () => {
    pushTabTitleFromView(window, view, tab)
  })
}

function getTabWireKey(tab) {
  if (!tab) return ""
  return `${String(tab.id)}:${tab.type}:${tab.canvasMode || "none"}`
}

function prepareTabViewWiring(view, tab) {
  if (!view || !tab) return false
  const wireKey = getTabWireKey(tab)
  if (view._nucleusWireKey === wireKey && view._nucleusTabWired) {
    return false
  }
  TAB_VIEW_WIRE_EVENTS.forEach(eventName => {
    view.webContents.removeAllListeners(eventName)
  })
  clearViewTabWireState(view)
  view._nucleusWireKey = wireKey
  view._nucleusWiredTabId = String(tab.id)
  return true
}

function shouldRefreshCanvasPredictions(tab) {
  return (
    isCanvasBrowserTab(tab) &&
    tab.view &&
    !tab.view.webContents.isDestroyed() &&
    !tab.view._nucleusPredictive &&
    activetab !== "None" &&
    sameTabId(activetab.id, tab.id)
  )
}

function getTabPoolType(tab) {
  if (tab && tab.poolType) {
    return tab.poolType
  }
  if (tab && tab.view && tab.view._nucleusPoolType) {
    return tab.view._nucleusPoolType
  }
  if (tab && tab.type === "canvastab" && isCanvasBrowserTab(tab)) {
    return "canvas"
  }
  return "web"
}

function shouldTrackInCurrtabs(tab) {
  return tab && (
    tab.type === "browsertab" ||
    tab.type === "canvastab" ||
    tab.type === "mailtab" ||
    tab.type === "synapsetab"
  )
}

function resolveTabForView(view, fallback = null) {
  return getTabForView(view) || fallback
}

function syncActiveSurfaceFromMainTab(window, mainTab) {
  if (rendererOverlayDepth > 0) {
    hideAllWebContentViews(window)
    activetab = mainTab || "None"
    refreshContextForActiveSurface()
    scheduleCanvasVisibleContextUpdate()
    return
  }
  if (!mainTab) {
    renderTab("None", window)
    activetab = "None"
    refreshContextForActiveSurface()
    scheduleCanvasVisibleContextUpdate()
    return
  }
  if (isWebContentTab(mainTab)) {
    if (mainTab.view) {
      renderTab(mainTab.view, window, mainTab)
    } else {
      renderTab("None", window)
    }
    activetab = mainTab
    refreshContextForActiveSurface()
    scheduleCanvasVisibleContextUpdate()
    return
  }
  if (isNativeSurfaceTab(mainTab)) {
    renderTab("None", window)
    activetab = mainTab
    refreshContextForActiveSurface()
    scheduleCanvasVisibleContextUpdate()
    return
  }
  renderTab("None", window)
  activetab = "None"
  refreshContextForActiveSurface()
  scheduleCanvasVisibleContextUpdate()
}

function createMainTabRecord(incoming) {
  return {
    id: incoming.id,
    type: incoming.type,
    workspaceId: incoming.workspaceId,
    label: incoming.label,
    url: incoming.url || "",
    canvasMode: incoming.canvasMode,
    canvasNativePage: incoming.canvasNativePage,
    nativeHistory: incoming.nativeHistory,
    courseId: incoming.courseId,
    courseSection: incoming.courseSection,
    injection: incoming.injection,
    loading: incoming.loading,
    yindex: incoming.yindex,
    poolType: null,
    view: null
  }
}

function mergeIncomingTab(target, incoming) {
  target.workspaceId = incoming.workspaceId
  target.label = incoming.label
  target.url = incoming.url || ""
  target.type = incoming.type
  target.canvasMode = incoming.canvasMode
  target.canvasNativePage = incoming.canvasNativePage
  target.nativeHistory = incoming.nativeHistory
  target.courseId = incoming.courseId
  target.courseSection = incoming.courseSection
  target.injection = incoming.injection
  target.loading = incoming.loading
  target.yindex = incoming.yindex
}

let activeWorkspaceIdForPool = null
const tabSnapshots = new Map()
const tabSnapshotCaptureTimers = new Map()

function logPoolTierCounts(reason) {
  console.log("[BrowserPool]", {
    reason,
    web: {
      inUse: browserpool.inUseLength("web"),
      backup: browserpool.backupLength("web"),
      available: browserpool.availableLength("web")
    },
    canvas: {
      inUse: browserpool.inUseLength("canvas"),
      backup: browserpool.backupLength("canvas"),
      available: browserpool.availableLength("canvas")
    }
  })
}

function broadcastTabViewState(tab, tier, snapshotDataUrl = "") {
  if (!tab || !mainwindow || mainwindow.isDestroyed()) return
  mainwindow.webContents.send("tabs:view_state", {
    id: tab.id,
    tier,
    discarded: Boolean(tab.discarded),
    snapshotDataUrl: snapshotDataUrl || tab.snapshotDataUrl || ""
  })
}

async function captureTabSnapshotFromView(view) {
  if (!view || view.webContents.isDestroyed()) return ""
  try {
    const image = await view.webContents.capturePage()
    return `data:image/png;base64,${image.toPNG().toString("base64")}`
  } catch (error) {
    console.error("Unable to capture tab snapshot:", error)
    return ""
  }
}

function cancelTabSnapshotCapture(tabId) {
  const key = String(tabId || "")
  if (!key || !tabSnapshotCaptureTimers.has(key)) return
  clearTimeout(tabSnapshotCaptureTimers.get(key))
  tabSnapshotCaptureTimers.delete(key)
}

function captureTabSnapshotDebounced(tab, view, delayMs = 300) {
  const tabId = String(tab && tab.id ? tab.id : "")
  if (!tabId) return Promise.resolve("")
  cancelTabSnapshotCapture(tabId)
  return new Promise(resolve => {
    const timer = setTimeout(async () => {
      tabSnapshotCaptureTimers.delete(tabId)
      if (tab && tab.view && tab.view !== view) {
        resolve("")
        return
      }
      const snapshotDataUrl = await captureTabSnapshotFromView(view)
      if (snapshotDataUrl) {
        tab.snapshotDataUrl = snapshotDataUrl
        tabSnapshots.set(tabId, snapshotDataUrl)
        if (tab.view) {
          resolve(snapshotDataUrl)
          return
        }
        const tier = tab.discarded ? "discarded" : "stashed"
        broadcastTabViewState(tab, tier, snapshotDataUrl)
      }
      resolve(snapshotDataUrl)
    }, delayMs)
    tabSnapshotCaptureTimers.set(tabId, timer)
  })
}

async function discardBackupEntry(window, type, entry) {
  if (!entry || !entry.view || entry.view.webContents.isDestroyed()) return
  const tab = currtabs.find(localtab => sameTabId(localtab.id, entry.cache.tabId))
  let snapshotDataUrl = tab && tab.snapshotDataUrl ? tab.snapshotDataUrl : ""
  if (!snapshotDataUrl) {
    snapshotDataUrl = await captureTabSnapshotFromView(entry.view)
  }
  if (tab) {
    tab.discarded = true
    tab.snapshotDataUrl = snapshotDataUrl
    tab.view = null
    tab.poolType = null
    if (snapshotDataUrl) {
      tabSnapshots.set(String(tab.id), snapshotDataUrl)
    }
    broadcastTabViewState(tab, "discarded", snapshotDataUrl)
  }
  await browserpool.releaseView(window, type, entry.view, false)
}

async function restoreStashedTabView(tab, window = mainwindow) {
  if (!tab || !isWebContentTab(tab) || tab.discarded) return false
  if (tab.view) {
    return false
  }
  cancelTabSnapshotCapture(tab.id)
  const poolType = tab.type === "canvastab" ? "canvas" : "web"
  if (!browserpool.findBackupEntry(poolType, tab.id, tab.url)) {
    return false
  }

  const acquired = browserpool.acquireForTab(poolType, tab.id, tab.url)
  if (!acquired.view) {
    return false
  }

  tab.view = acquired.view
  tab.poolType = poolType
  tab.view._nucleusPoolType = poolType
  tab.discarded = false

  if (acquired.fromBackup) {
    const loadedUrl = tab.view.webContents.isDestroyed() ? '' : tab.view.webContents.getURL()
    const requestedUrl = tab.url || ''
    let needsReload = Boolean(requestedUrl && !browserpool.urlsLikelyMatch(loadedUrl, requestedUrl))
    if (needsReload && shouldKeepStashedWebContent(tab, loadedUrl)) {
      if (tab.type === "canvastab") {
        tab.url = loadedUrl
        mainwindow.webContents.send('tabs:url_update', { id: tab.id, url: loadedUrl })
      }
      needsReload = false
    }
    if (tab.type === "canvastab") {
      if (needsReload) {
        const hasAuth = await ensureCanvasAuthForNavigation(tab.view.webContents.session)
        if (!hasAuth) {
          mainwindow.webContents.send('canvas:navigation-finished', 'auth')
          revealCanvasView(tab.view)
        } else {
          tab.view._nucleusSuppressNextCanvasSlate = true
          await runCanvasSlateNavigation(window, tab.view, () => {
            return loadCanvasTabURL(tab.view, requestedUrl, status => {
              mainwindow.webContents.send('canvas:navigation-finished', status)
            })
          })
        }
      } else if (
        tab.pendingSwitchSlate &&
        rendererOverlayDepth === 0 &&
        !tab.view._nucleusSlateNavigationInProgress
      ) {
        tab.pendingSwitchSlate = false
        try {
          const gotslate = addslate(window)
          await setSlateAnimation(gotslate, 'show', 'right')
          revealCanvasOverSlate(window, tab.view, tab, gotslate)
          sendCanvasViewReady(window, tab)
        } catch (error) {
          console.error('Unable to animate canvas tab switch:', error)
          revealCanvasView(tab.view, { immediate: true })
        }
      } else {
        tab.pendingSwitchSlate = false
        tab.view._nucleusSuppressNextCanvasSlate = true
      }
      // Predictive refresh runs from tabs:new_active after surface sync.
    } else if (needsReload) {
      await reloadWebTabContent(tab, requestedUrl).catch(error => {
        console.error("Unable to reload stashed browser tab URL:", error)
      })
      pushTabTitleFromView(window, tab.view, tab)
    } else {
      tab.url = tab.url || tab.view.webContents.getURL()
      pushTabTitleFromView(window, tab.view, tab)
    }
    broadcastTabViewState(tab, "active")
    return true
  }

  tab.view = null
  tab.poolType = null
  await browserpool.releaseView(window, poolType, acquired.view, false)
  return false
}

async function restoreDiscardedTabView(tab, window = mainwindow) {
  if (!tab || !isWebContentTab(tab) || tab.view || !tab.discarded) return false
  const poolType = tab.type === "canvastab" ? "canvas" : "web"
  const snapshotDataUrl = tab.snapshotDataUrl || tabSnapshots.get(String(tab.id)) || ""
  if (snapshotDataUrl && window && !window.isDestroyed()) {
    window.webContents.send("tabs:snapshot_overlay", {
      tabId: tab.id,
      snapshotDataUrl,
      visible: true
    })
  }

  const acquired = browserpool.acquireForTab(poolType, tab.id, tab.url)
  if (!acquired.view) {
    return false
  }

  tab.view = acquired.view
  tab.poolType = poolType
  tab.view._nucleusPoolType = poolType
  tab.view._nucleusRestorePending = true
  tab.discarded = false

  const initialUrl = tab.url || (tab.type === "canvastab" ? canvasBlankWarmUrl : "https://www.google.com")
  const hideOverlay = () => {
    if (tab.view) {
      tab.view._nucleusRestorePending = false
    }
    if (!window || window.isDestroyed()) return
    window.webContents.send("tabs:snapshot_overlay", {
      tabId: tab.id,
      visible: false
    })
    broadcastTabViewState(tab, "active")
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.setVisible(true)
      if (tab.type === "canvastab") {
        revealCanvasView(tab.view)
      }
    }
  }

  if (tab.type === "canvastab") {
    const hasAuth = await ensureCanvasAuthForNavigation(tab.view.webContents.session)
    if (!hasAuth) {
      mainwindow.webContents.send("canvas:navigation-finished", "auth")
      revealCanvasView(tab.view)
      hideOverlay()
      return true
    }
    tab.view._nucleusSuppressNextCanvasSlate = true
    tab.view.webContents.once("did-finish-load", hideOverlay)
    await loadCanvasTabURL(tab.view, initialUrl, status => {
      mainwindow.webContents.send("canvas:navigation-finished", status)
    })
  } else {
    tab.view.webContents.once("did-finish-load", hideOverlay)
    await tab.view.webContents.loadURL(initialUrl)
    tab.url = initialUrl
    mainwindow.webContents.send("tabs:url_update", { id: tab.id, url: tab.url })
  }
  return true
}

async function ensureActiveWebContentTabView(tab, window = mainwindow) {
  if (!tab || !isWebContentTab(tab) || tab.view) return true
  if (tab.discarded) {
    return restoreDiscardedTabView(tab, window)
  }
  if (await restoreStashedTabView(tab, window)) {
    return true
  }

  const searchQuery = getEngineSearchQuery(tab.url)
  if (!searchQuery) {
    return false
  }

  const poolType = tab.type === "canvastab" ? "canvas" : "web"
  const acquired = browserpool.acquireForTab(poolType, tab.id, tab.url)
  if (!acquired.view) {
    return false
  }

  tab.view = acquired.view
  tab.poolType = poolType
  tab.view._nucleusPoolType = poolType
  tab.discarded = false
  attachWebContentView(window, tab.view, tab)
  await openEngineSearchInTab(tab, searchQuery.query, searchQuery.type)
  broadcastTabViewState(tab, "active")
  return true
}

const tabViewLifecycle = {
  async onTabDeactivated(tab, window = mainwindow) {
    if (!tab || tab === "None" || !isWebContentTab(tab) || !tab.view) return
    await stashTabViewToBackup(tab, window)
    logPoolTierCounts("tab-deactivated")
  },

  async onTabActivated(tab, window = mainwindow) {
    if (!tab || !isWebContentTab(tab)) return
    await ensureActiveWebContentTabView(tab, window)
    logPoolTierCounts("tab-activated")
  },

  async deactivateTabsOutsideWorkspace(activeWorkspaceId, keepTabId = null, window = mainwindow) {
    if (!activeWorkspaceId) return
    for (const tab of currtabs) {
      if (!isWebContentTab(tab) || !tab.view) continue
      if (keepTabId && sameTabId(tab.id, keepTabId)) continue
      if (String(tab.workspaceId) === String(activeWorkspaceId)) continue
      await stashTabViewToBackup(tab, window)
    }
    logPoolTierCounts("workspace-deactivated")
  }
}

async function stashTabViewToBackup(tab, window = mainwindow) {
  if (!tab || !tab.view) return "closed"
  cancelCanvasPredictiveRefreshSchedule()
  const poolType = getTabPoolType(tab)
  detachWebContentView(window, tab.view)
  if (poolType === "canvas") {
    await clearCanvasPredictiveViews(tab.id, window)
  }
  const view = tab.view
  const cache = {
    tabId: tab.id,
    url: tab.url,
    label: tab.label,
    workspaceId: tab.workspaceId,
    activeWorkspaceId: activeWorkspaceIdForPool || tab.workspaceId
  }
  tab.view = null
  tab.poolType = null
  const result = await browserpool.stashToBackup(window, poolType, view, cache)
  captureTabSnapshotDebounced(tab, view).catch(error => {
    console.error("Unable to capture tab snapshot on stash:", error)
  })
  broadcastTabViewState(tab, "stashed")
  return result
}

async function releaseTabView(tab, window = mainwindow) {
  if (!tab || !tab.view) return "closed"
  const poolType = getTabPoolType(tab)
  if (poolType === "canvas") {
    await clearCanvasPredictiveViews(tab.id, window)
  }
  const view = tab.view
  tab.view = null
  tab.poolType = null
  return browserpool.releaseView(window, poolType, view)
}

function normalizeCanvasNavigationUrl(url, baseUrl = "") {
  const normalized = normalizeFrameUrl(url)
  if (normalized) return normalized
  try {
    return new URL(String(url || "").trim(), baseUrl || "https://canvas.local").href
  } catch (_error) {
    return String(url || "").trim()
  }
}

function findCanvasPredictiveEntry(tabId, url) {
  const normalizedUrl = normalizeCanvasNavigationUrl(url)
  if (!normalizedUrl) return null

  const predictions = canvasPredictiveByTab.get(String(tabId)) || []
  return predictions.find(prediction => {
    if (!prediction || !prediction.view || prediction.view.webContents.isDestroyed()) {
      return false
    }
    const loadedUrl = prediction.view.webContents.getURL()
    return (
      browserpool.urlsLikelyMatch(prediction.url, normalizedUrl) ||
      browserpool.urlsLikelyMatch(loadedUrl, normalizedUrl)
    )
  }) || null
}

function removeCanvasPredictiveEntry(tabId, prediction) {
  const key = String(tabId || "")
  const predictions = canvasPredictiveByTab.get(key) || []
  canvasPredictiveByTab.set(
    key,
    predictions.filter(item => item !== prediction)
  )
}

async function clearCanvasPredictiveViews(tabId, window = mainwindow) {
  const key = String(tabId || "")
  const predictions = canvasPredictiveByTab.get(key) || []
  canvasPredictiveByTab.delete(key)

  for (const prediction of predictions) {
    if (!prediction || !prediction.view) continue
    const ownerTab = currtabs.find(tab => tab && tab.view === prediction.view)
    if (ownerTab) continue
    await browserpool.releaseView(window, "canvas", prediction.view)
  }
}

async function extractTopCanvasLinks(view) {
  if (!view || view.webContents.isDestroyed()) return []

  try {
    return await view.webContents.executeJavaScript(`
      (() => {
        const current = new URL(window.location.href);
        const seen = new Set();
        const links = [];
        const nodes = Array.from(document.querySelectorAll("a[href]"));

        for (const node of nodes) {
          let href = "";
          try {
            href = new URL(node.getAttribute("href"), current.href).href;
          } catch (_error) {
            continue;
          }

          if (!href || seen.has(href)) continue;
          if (!/^https?:/i.test(href)) continue;
          if (href.includes("/download") || href.includes("download_frd=1")) continue;
          if (node.getAttribute("href") === "#") continue;

          seen.add(href);
          links.push(href);
          if (links.length >= ${CANVAS_PREDICTIVE_LINK_COUNT}) break;
        }

        return links;
      })();
    `, true)
  } catch (error) {
    console.error("Unable to extract canvas predictive links:", error)
    return []
  }
}

async function loadCanvasTabURLQuiet(view, url) {
  if (!view || view.webContents.isDestroyed()) return false

  const targetSession = view.webContents.session
  if (canvas_auth_cookie && canvas_base_url) {
    await installCanvasSessionCookies(targetSession)
  }
  const hasAuth = await hasCanvasSessionCookie(targetSession)
  if (!hasAuth) return false

  const normalizedUrl = normalizeCanvasNavigationUrl(url)
  view._nucleusSuppressNextCanvasSlate = true
  view._nucleusPredictive = true
  const navPromise = waitForCanvasNavigation(view)
  await view.webContents.loadURL(normalizedUrl)
  await waitForCanvasNavigationAndSettle(view, navPromise)
  return true
}

function attachCanvasPredictiveNavigationHandlers(window, tab, view) {
  if (!tab || !view || view._nucleusPredictiveSwapHandlerAttached) return
  view._nucleusPredictiveSwapHandlerAttached = true

  view.webContents.on("will-navigate", (event, url) => {
    if (tab.type !== "canvastab" || tab.view !== view) return
    if (isLikelyDownloadUrl(url)) return

    const prediction = findCanvasPredictiveEntry(tab.id, url)
    if (!prediction) return

    event.preventDefault()
    swapCanvasPredictiveView(window, tab, prediction, url).catch(error => {
      console.error("Unable to swap canvas predictive view:", error)
    })
  })

  if (view._nucleusTabWired || view._nucleusPredictiveHandlersAttached) return
  view._nucleusPredictiveHandlersAttached = true

  let canvasNavigationLoadPromise = null

  view.webContents.on("did-navigate", (_event, url) => {
    if (tab.view !== view) return
    tab.url = url
    logTabNavigationState(tab, url, "did-navigate")
    window.webContents.send("tabs:url_update", { id: tab.id, url })
  })

  view.webContents.on("did-navigate-in-page", (_event, url) => {
    if (tab.view !== view) return
    tab.url = url
    logTabNavigationState(tab, url, "did-navigate-in-page")
    window.webContents.send("tabs:url_update", { id: tab.id, url })
  })

  view.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (!isCanvasBrowserTab(tab) || tab.view !== view || !isMainFrame || isInPlace) return
    if (isLikelyDownloadUrl(_url)) return
    if (view._nucleusSuppressNextCanvasSlate) {
      view._nucleusSuppressNextCanvasSlate = false
      return
    }
    if (view._nucleusSlateNavigationInProgress) return
    if (view._nucleusCanvasNavigationInProgress) return
    if (canvasNavigationLoadPromise) return

    const navpromise = waitForCanvasNavigation(view)
    canvasNavigationLoadPromise = canvaspageload(view, status => {
      window.webContents.send("canvas:navigation-finished", status)
    })
    coverCurrentCanvasNavigationWithSlate(window, view, navpromise).catch(error => {
      console.error("Unable to cover Canvas navigation with slate:", error)
    })
    canvasNavigationLoadPromise.finally(() => {
      canvasNavigationLoadPromise = null
    })
  })
}

async function swapCanvasPredictiveView(window, tab, prediction, url) {
  if (!tab || !prediction || !prediction.view) return false

  const currentView = tab.view
  if (!currentView || currentView === prediction.view) return false

  removeCanvasPredictiveEntry(tab.id, prediction)

  tab.view = null
  const currentUrl = currentView.webContents.isDestroyed()
    ? tab.url
    : currentView.webContents.getURL()
  await browserpool.stashToBackup(window, "canvas", currentView, {
    tabId: tab.id,
    url: currentUrl,
    label: tab.label
  })

  prediction.view._nucleusPredictive = false
  tab.view = prediction.view
  tab.url = normalizeCanvasNavigationUrl(url)

  window.webContents.send("tabs:url_update", { id: tab.id, url: tab.url })
  wireTabTitleUpdates(window, prediction.view, tab)
  pushTabTitleFromView(window, prediction.view, tab)
  renderTab(prediction.view, window, tab)
  revealCanvasView(prediction.view)
  window.webContents.send("canvas:navigation-finished", "done")
  scheduleCanvasVisibleContextUpdate()

  refreshCanvasPredictiveViews(window, tab).catch(error => {
    console.error("Unable to refresh canvas predictive views after swap:", error)
  })

  return true
}

async function refreshCanvasPredictiveViews(window, tab) {
  if (!shouldRefreshCanvasPredictions(tab)) {
    return
  }

  await clearCanvasPredictiveViews(tab.id, window)
  const links = await extractTopCanvasLinks(tab.view)
  const predictions = []

  for (const linkUrl of links.slice(0, CANVAS_PREDICTIVE_LINK_COUNT)) {
    if (!browserpool.canAcquireActive("canvas")) break

    const predictiveView = browserpool.acquirePredictiveView("canvas")
    if (!predictiveView) break

    predictiveView.setVisible(false)
    predictiveView.setBounds(getBrowserBounds(window, tab))
    try {
      window.contentView.addChildView(predictiveView)
    } catch (_error) {
      // View may already be attached.
    }

    const loaded = await loadCanvasTabURLQuiet(predictiveView, linkUrl)
    if (!loaded) {
      await browserpool.releaseView(window, "canvas", predictiveView)
      continue
    }

    predictions.push({
      url: normalizeCanvasNavigationUrl(linkUrl),
      view: predictiveView
    })
  }

  if (predictions.length) {
    canvasPredictiveByTab.set(String(tab.id), predictions)
  }
}

let canvasPredictiveRefreshTimer = null

function cancelCanvasPredictiveRefreshSchedule() {
  if (canvasPredictiveRefreshTimer) {
    clearTimeout(canvasPredictiveRefreshTimer)
    canvasPredictiveRefreshTimer = null
  }
}

function scheduleCanvasPredictiveRefresh(window, tab, delayMs = 500) {
  if (!tab || tab.type !== "canvastab" || !isCanvasBrowserTab(tab)) return
  cancelCanvasPredictiveRefreshSchedule()
  canvasPredictiveRefreshTimer = setTimeout(() => {
    canvasPredictiveRefreshTimer = null
    if (activetab === "None" || !sameTabId(activetab.id, tab.id) || !tab.view) return
    refreshCanvasPredictiveViews(window, tab).catch(error => {
      console.error("Unable to refresh canvas predictive views:", error)
    })
  }, delayMs)
}

function detachWebContentView(window, view) {
  if (!view || view.webContents.isDestroyed()) return
  view.setVisible(false)
  if (!window || window.isDestroyed()) return
  try {
    window.contentView.removeChildView(view)
  } catch (_error) {
    // View may already be detached.
  }
}

function attachWebContentView(window, view, tab = null) {
  if (!view || view.webContents.isDestroyed()) return
  if (!window || window.isDestroyed()) return
  view.setBounds(getBrowserBounds(window, tab))
  try {
    window.contentView.addChildView(view)
  } catch (_error) {
    // View may already be attached.
  }
}

function hideAllWebContentViews(window) {
  browserpool.hideAllViews(window)
  for (const tab of currtabs) {
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) continue
    detachWebContentView(window, tab.view)
  }
  for (const predictions of canvasPredictiveByTab.values()) {
    for (const prediction of predictions) {
      if (!prediction || !prediction.view || prediction.view.webContents.isDestroyed()) continue
      detachWebContentView(window, prediction.view)
    }
  }
  if (slate && !slate.webContents.isDestroyed()) {
    slate.setVisible(false)
  }
}

function isNativeSurfaceTab(tab) {
  return tab && (
    tab.type === "mailtab" ||
    tab.type === "synapsetab" ||
    isCanvasNativeTab(tab)
  )
}

function renderTab(view, window, tab = null) {
  if (view === 'None') {
    hideAllWebContentViews(window)
    return
  }
  for (const localtab of currtabs) {
    if (localtab && localtab.view && localtab.view !== view && !localtab.view.webContents.isDestroyed()) {
      detachWebContentView(window, localtab.view)
    }
  }
  attachWebContentView(window, view, tab)
  if (rendererOverlayDepth > 0) {
    view.setVisible(false)
    return
  }
  if (view._nucleusBlankedForCanvasWipe || view._nucleusRestorePending) {
    view.setVisible(false)
    return
  }
  if (tab && tab.type === 'canvastab' && isCanvasBrowserTab(tab)) {
    revealCanvasView(view, { immediate: canvasViewHasReadyContent(view) })
    return
  }
  view.setVisible(true)
  try {
    if (String(view.webContents.getURL() || '').includes('engine.html')) {
      installEngineAppShortcutLaunchers(view.webContents).catch(() => {})
    }
  } catch (_error) {}
}

// get auth values from files
function getauth() {
  canvas_auth_cookie = get_auth_token()
  canvas_auth_csrf = get_auth_csrf()
  canvas_base_url = get_base_url()
  canvasAuthValidated = true
  installCanvasSessionCookies()
    .then(() => settleCanvasAuthWaiters())
    .catch(error => {
      console.error("Unable to install Canvas auth cookies:", error)
      settleCanvasAuthWaiters(error)
    })
}

let canvasInitialSetupDone = false

async function setup() {
  return canvasApi.setupCanvasData()
}

function getauthview(view) {
  authview = view
}

async function openCanvasApp() {
  if (authview) {
    return { ok: true, status: "auth-open" }
  }

  if (loadCanvasAuthFromEnv()) {
    try {
      await installCanvasSessionCookies()
      if (!canvasInitialSetupDone) {
        await setup()
        canvasInitialSetupDone = true
      }
      return { ok: true, status: "cached-auth" }
    } catch (error) {
      console.warn("Saved Canvas auth failed, opening auth window:", error && error.message ? error.message : error)
    }
  }

  open_canvas_auth_window(mainwindow, getauth, getauthview, async () => {
    await setup()
    canvasInitialSetupDone = true
  })
  return { ok: true, status: "auth-open" }
}

async function ensureCanvasAuthForNavigation(targetSession = session.defaultSession) {
  if (canvas_auth_cookie && canvas_base_url) {
    if (!canvasAuthValidated && !(await validateCanvasAuthState())) {
      clearCanvasAuthState()
    } else {
      canvasAuthValidated = true
      await installCanvasSessionCookies(targetSession)
    }
    if (canvasAuthValidated && await hasCanvasSessionCookie(targetSession)) {
      return true
    }
  }

  if (loadCanvasAuthFromEnv()) {
    if (!canvasAuthValidated && !(await validateCanvasAuthState())) {
      clearCanvasAuthState()
    } else {
      canvasAuthValidated = true
      await installCanvasSessionCookies(targetSession)
    }
    if (canvasAuthValidated && await hasCanvasSessionCookie(targetSession)) {
      return true
    }
  }

  if (!authview) {
    open_canvas_auth_window(mainwindow, getauth, getauthview, setup)
  }
  await waitForCanvasAuth()
  await installCanvasSessionCookies(targetSession)
  return hasCanvasSessionCookie(targetSession)
}

function canvaspageload(view, sendsignal) {
  if (view._nucleusPendingCanvasLoad) {
    view._nucleusPendingCanvasLoad.cancel()
  }

  return new Promise(resolve => {
    const webContents = view.webContents
    let settled = false

    function cleanup() {
      webContents.removeListener('did-finish-load', handler)
      webContents.removeListener('did-fail-load', handlefail)
      if (view._nucleusPendingCanvasLoad === pendingLoad) {
        view._nucleusPendingCanvasLoad = null
      }
    }

    function settle(result, shouldSignal = true) {
      if (settled) return
      settled = true
      cleanup()
      if (shouldSignal) {
        sendsignal(result.status)
      }
      if (result.status !== 'superseded') {
        revealCanvasView(view)
      }
      resolve(result)
    }

    function handler() {
      settle({
        ok: true,
        status: 'success'
      })
      const ownerTab = getTabForView(view)
      const ownerWindow = BrowserWindow.getAllWindows()[0]
      if (
        ownerTab &&
        ownerTab.view === view &&
        !view._nucleusPredictive &&
        ownerWindow
      ) {
        refreshCanvasPredictiveViews(ownerWindow, ownerTab).catch(error => {
          console.error("Unable to refresh canvas predictive views after load:", error)
        })
        scheduleCanvasVisibleContextUpdate()
      }
    }

    function handlefail() {
      settle({
        ok: false,
        status: 'fail'
      })
    }

    const pendingLoad = {
      cancel() {
        settle({
          ok: false,
          status: 'superseded'
        }, false)
      }
    }
    view._nucleusPendingCanvasLoad = pendingLoad
    webContents.once("did-finish-load", handler)
    webContents.once("did-fail-load", handlefail)
  })
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function waitForCanvasNavigation(view) {
  return new Promise(resolve => {
    view.webContents.once('did-navigate', resolve)
  })
}

async function waitForCanvasNavigationAndSettle(view, navpromise) {
  await navpromise
  const twoFrameWait = view
    ? view.webContents.executeJavaScript(`
        new Promise(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(resolve)
          })
        })
      `, true)
    : Promise.resolve()

  await Promise.race([
    twoFrameWait.catch(() => false),
    wait(300)
  ])
  await wait(700)
}

async function loadCanvasTabURL(view, url, sendsignal) {
  const targetSession = view && view.webContents
    ? view.webContents.session
    : session.defaultSession
  const hasAuth = await ensureCanvasAuthForNavigation(targetSession)
  if (!hasAuth) {
    sendsignal('auth')
    revealCanvasView(view)
    return
  }

  const navpromise = waitForCanvasNavigation(view)
  canvaspageload(view, sendsignal)
  view.webContents.loadURL(url).catch(error => {
    console.error("Unable to load canvas tab URL:", error)
    sendsignal('fail')
  })
  await waitForCanvasNavigationAndSettle(view, navpromise)
}

function getTabForView(view) {
  return currtabs.find(localtab => localtab && localtab.view === view)
}

function canvasViewHasReadyContent(view) {
  if (!view || view.webContents.isDestroyed()) return false
  const url = String(view.webContents.getURL() || '').trim()
  return Boolean(url && url !== 'about:blank')
}

function sendCanvasViewReady(window, tab) {
  if (!window || window.isDestroyed() || !tab) return
  window.webContents.send('canvas:view-ready', { id: tab.id })
}

function revealCanvasView(view, options = {}) {
  if (!view) return
  const tab = getTabForView(view) || (activetab !== "None" && activetab.view === view ? activetab : null)
  if (tab && tab.type === "canvastab" && !isCanvasBrowserTab(tab)) {
    view.setVisible(false)
    return
  }
  view._nucleusCanvasNavigationInProgress = false

  const window = BrowserWindow.getAllWindows()[0]
  if (rendererOverlayDepth > 0) {
    view.setVisible(false)
    return
  }
  if (tab && window) {
    attachWebContentView(window, view, tab)
  }

  const isActiveView = activetab !== "None" && activetab.view === view
  if (!isActiveView) {
    view.setVisible(false)
    return
  }

  if (view._nucleusBlankedForCanvasWipe) {
    view.setVisible(false)
    return
  }

  const revealImmediately = options.immediate === true || (
    options.immediate !== false &&
    !view._nucleusCanvasNavigationInProgress &&
    !view._nucleusSlateNavigationInProgress &&
    canvasViewHasReadyContent(view)
  )

  if (revealImmediately) {
    if (view._nucleusRevealTimer) {
      clearTimeout(view._nucleusRevealTimer)
      view._nucleusRevealTimer = null
    }
    view.setVisible(true)
    sendCanvasViewReady(window, tab)
    return
  }

  if (view._nucleusRevealTimer) {
    clearTimeout(view._nucleusRevealTimer)
  }
  view._nucleusRevealTimer = setTimeout(() => {
    view._nucleusRevealTimer = null
    const stillActiveView = activetab !== "None" && activetab.view === view
    if (!stillActiveView || view._nucleusBlankedForCanvasWipe || rendererOverlayDepth > 0) return

    view.setVisible(true)
    sendCanvasViewReady(window, tab)
  }, 100)
}

function getCanvasTabForView(view) {
  const tab = getTabForView(view)
  if (tab && tab.type === "canvastab") return tab
  if (activetab !== "None" && activetab.type === "canvastab" && activetab.view === view) {
    return activetab
  }
  return null
}

function markIntentionalDownload(view, url) {
  if (!view) return
  view._nucleusIntentionalDownload = {
    url,
    startedAt: Date.now()
  }
}

function isIntentionalDownload(view, url) {
  if (!view || !view._nucleusIntentionalDownload) return false
  const marker = view._nucleusIntentionalDownload
  const recent = Date.now() - marker.startedAt < 5000
  return recent
}

function getslate(window) {
  if (!slate) {
    slate = new WebContentsView({
      webPreferences: {
        transparent: true
      }
    })
    slate._nucleusSlateLoaded = false
    slate.webContents.once('did-finish-load', () => {
      slate._nucleusSlateLoaded = true
      applySlateTheme()
    })
    slate.webContents.loadFile(path.join(__dirname, 'slate.html'))
    slate.setVisible(false)
    window.contentView.addChildView(slate)
  }
  return slate
}

function setSlateBounds(window) {
  if (!slate) return
  const tab = activetab !== "None" ? activetab : null
  slate.setBounds(getBrowserBounds(window, tab))
}

async function setSlateAnimation(view, phase, direction = 'right') {
  if (!view) return

  if (!view._nucleusSlateLoaded) {
    await new Promise(resolve => {
      view.webContents.once('did-finish-load', resolve)
    })
  }
  const currclass = `${phase}-${direction === 'left' ? 'left' : 'right'}`
  try {
    return view.webContents.executeJavaScript(`
      new Promise(resolve => {
        const slate = document.querySelector('.slate');
        if (!slate) {
          resolve(false);
          return;
        }
        let settled = false;

        function finish() {
          if (settled) return;
          settled = true;
          slate.removeEventListener('animationend', onAnimationEnd);
          resolve(true);
        }

        function onAnimationEnd(event) {
          if (event.target !== slate) return;
          finish()
        }

        slate.addEventListener('animationend', onAnimationEnd);
        setTimeout(finish, 1000);
        slate.classList.remove('show-right', 'hide-right', 'show-left', 'hide-left');
        void slate.offsetWidth;
        slate.classList.add(${JSON.stringify(currclass)});
      });

    `, true)
  } catch (error) {
    console.error("Unable to animate slate:", error)
  }
}

function addslate(window) {
  
  const gotslate = getslate(window)
  try {
    window.contentView.removeChildView(gotslate)
  } catch (_error) {
    // The slate may not be attached yet.
  }
  setSlateBounds(window)
  window.contentView.addChildView(gotslate)
  gotslate.setVisible(true)
  return gotslate
}

// Reveals the freshly loaded canvas page over the slate (forward links): the
// page is raised above the slate and shown, then the slate is dropped behind it
// with no exit animation, so the page simply "loads on top" of the slide.
function revealCanvasOverSlate(window, view, tab, gotslate) {
  attachWebContentView(window, view, tab)
  view.setVisible(true)
  gotslate.setVisible(false)
}

async function runCanvasSlateNavigation(window, view, action, options = {}) {
  if (!view) return
  const tab = getCanvasTabForView(view)
  if (tab && !isCanvasBrowserTab(tab)) {
    return action()
  }
  if (view._nucleusSlateNavigationInProgress) {
    return action()
  }

  const direction = options.direction === 'left' ? 'left' : 'right'
  const revealOnTop = options.revealOnTop !== false

  view._nucleusSlateNavigationInProgress = true
  try {
    const gotslate = addslate(window)
    await setSlateAnimation(gotslate, 'show', direction)
    view.setVisible(false)
    const result = await action()
    if (revealOnTop) {
      revealCanvasOverSlate(window, view, tab, gotslate)
    } else {
      view.setVisible(true)
      await setSlateAnimation(gotslate, 'hide', direction)
      gotslate.setVisible(false)
    }
    return result
  } finally {
    view._nucleusSlateNavigationInProgress = false
  }
}

async function coverCurrentCanvasNavigationWithSlate(window, view, navpromise, options = {}) {
  if (!view || view._nucleusSlateNavigationInProgress) return
  const tab = getCanvasTabForView(view)
  if (!isCanvasBrowserTab(tab)) return

  const direction = options.direction === 'left' ? 'left' : 'right'
  const revealOnTop = options.revealOnTop !== false

  view._nucleusSlateNavigationInProgress = true
  try {
    const gotslate = addslate(window)
    await setSlateAnimation(gotslate, 'show', direction)
    view.setVisible(false)
    await waitForCanvasNavigationAndSettle(view, navpromise)
    if (revealOnTop) {
      revealCanvasOverSlate(window, view, tab, gotslate)
    } else {
      view.setVisible(true)
      await setSlateAnimation(gotslate, 'hide', direction)
      gotslate.setVisible(false)
    }
  } finally {
    view._nucleusSlateNavigationInProgress = false
  }
}

async function loadbrowserpool(window) {
  await browserpool.load(window)
}
// ─────────────────────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nucleus',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

app.whenReady().then(() => {
  protocol.registerStringProtocol('nucleus', (_request, callback) => {
    callback({ mimeType: 'text/html', data: '<!doctype html><html><body></body></html>' })
  })
  mainwindow = createWindow();
  // Global shortcut fallback when before-input-event does not run (e.g. some focus edge cases).
  try {
    const shortcutRegistered = globalShortcut.register('CommandOrControl+Shift+C', () => {
      logRegionCaptureDebug('global_shortcut_fired')
      dispatchRegionCaptureShortcut('global_shortcut')
    })
    logRegionCaptureDebug('global_shortcut_registered', { ok: Boolean(shortcutRegistered), shortcut: 'CommandOrControl+Shift+C' })
  } catch (error) {
    logRegionCaptureDebug('global_shortcut_register_failed', {
      error: error && error.message ? error.message : String(error)
    })
    console.warn('Unable to register region capture global shortcut:', error)
  }
  const[winwidth, winheight] = mainwindow.getSize();
  loadbrowserpool(mainwindow).catch(error => {
    console.error("Unable to load browser pool:", error)
  })

  
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const foundtab = currtabs.find(localtab =>
      localtab &&
      localtab.type === "canvastab" &&
      localtab.view &&
      localtab.view.webContents === webContents
    )
    if (!foundtab || !foundtab.view) return

    const downloadUrl = item.getURL()
    if (isIntentionalDownload(foundtab.view, downloadUrl)) {
      foundtab.view._nucleusIntentionalDownload = null
      return
    }

    event.preventDefault()
    console.warn("Blocked unintended Canvas download:", downloadUrl)
    if (foundtab.view._nucleusPendingCanvasLoad) {
      foundtab.view._nucleusPendingCanvasLoad.cancel()
    }
    if (foundtab.view._nucleusCanvasNavigationInProgress) {
      mainwindow.webContents.send('canvas:navigation-finished', 'fail')
      revealCanvasView(foundtab.view)
    } else {
      foundtab.view.setVisible(true)
    }
  })
  
  function applyShellLayoutBounds() {
    if (activetab != "None" && activetab.view) {
      activetab.view.setBounds(getBrowserBounds(mainwindow, activetab))
    }
    if (authview) {
      authview.setBounds(getAuthBounds(mainwindow))
    }
    setSlateBounds(mainwindow)
  }
  
  mainwindow.on('resize', () => {
    applyShellLayoutBounds()
    scheduleVisibleContextUpdate()
  })

  // ─── IPC Handlers ──────────────────────────────────────────────────────────

  // tasks:start — Runs the placeholder start-task script for a given task.
  // in:  task (Object) — task record from the renderer
  // out: { ok: true }
  ipcMain.handle('tasks:start', (_, task) => {
    const taskName = task && task.title ? task.title : 'Untitled task'
    console.log(`[nucleus] Placeholder start-task script ran for: ${taskName}`)
    return { ok: true };
  });

  // data:get — Returns the current app data snapshot.
  // in:  none
  // out: { tasks, workspaces, projectGroups }
  ipcMain.handle('data:get', () => {
    return dataStore.getRendererDataSnapshot();
  });

  ipcMain.handle('layout:workspace_sidebar_collapsed', (_, collapsed) => {
    setWorkspaceSidebarCollapsed(Boolean(collapsed))
    applyShellLayoutBounds()
    return { ok: true, collapsed: Boolean(collapsed) }
  });

  // overlay:set_open — Renderer modal depth (settings, etc.). WebContentsViews paint
  // above the shell DOM, so native views must be hidden while overlays are open.
  ipcMain.handle('overlay:set_open', async (_, payload = {}) => {
    const open = Boolean(payload.open)
    if (open) {
      rendererOverlayDepth += 1
      if (rendererOverlayDepth === 1 && mainwindow && !mainwindow.isDestroyed()) {
        hideAllWebContentViews(mainwindow)
      }
    } else {
      rendererOverlayDepth = Math.max(0, rendererOverlayDepth - 1)
      if (rendererOverlayDepth === 0 && mainwindow && !mainwindow.isDestroyed()) {
        const activeMainTab = activetab !== "None" ? activetab : null
        syncActiveSurfaceFromMainTab(mainwindow, activeMainTab)
      }
    }
    return { ok: true, depth: rendererOverlayDepth }
  });

  ipcMain.handle('mail:ensure_auth', async () => {
    try {
      const ok = await ensureMailAuth()
      return { ok }
    } catch (error) {
      return {
        ok: false,
        error: error && error.message ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('gradescope:ensure_auth', async () => {
    try {
      await new Promise((resolve, reject) => {
        openGradescopeAuthWindow(
          mainwindow,
          () => resolve(),
          view => { authview = view },
        )
      })
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error && error.message ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('mail:get_inbox', async () => {
    try {
      const html = await getInboxHtml({ embedStyles: false })
      return { ok: true, html }
    } catch (error) {
      const message = mailError(error)
      return {
        ok: false,
        error: message,
        html: buildHtml(message, { embedStyles: false })
      }
    }
  })

  ipcMain.handle('mail:get_view', async (_, payload = {}) => {
    try {
      const view = await getMailViewData(payload)
      return { ok: true, view }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:get_message', async (_, payload = {}) => {
    try {
      if (!payload || !payload.id) {
        return { ok: false, error: 'Message id is required.' }
      }
      const message = await getMailMessage(payload.id)
      return { ok: true, message }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:get_thread', async (_, payload = {}) => {
    try {
      if (!payload || !payload.threadId) {
        return { ok: false, error: 'Thread id is required.' }
      }
      const thread = await getMailThread(payload.threadId)
      return { ok: true, thread }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:send', async (event, payload = {}) => {
    try {
      const message = await sendMailMessage(payload)
      const sender = event && event.sender ? event.sender : null
      const onContactsUpdate = updatedContacts => {
        if (sender && !sender.isDestroyed()) {
          sender.send('mail:contacts_updated', { contacts: updatedContacts })
        }
      }
      const contacts = await addOutgoingMailToContactChatAsync(payload, message, onContactsUpdate)
      return { ok: true, message, contacts }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:modify', async (_, payload = {}) => {
    try {
      if (!payload || !payload.id) {
        return { ok: false, error: 'Message id is required.' }
      }
      const message = await modifyMailMessage(payload.id, payload)
      return { ok: true, message }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:trash', async (_, payload = {}) => {
    try {
      if (!payload || !payload.id) {
        return { ok: false, error: 'Message id is required.' }
      }
      const message = await trashMailMessage(payload.id)
      return { ok: true, message }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:untrash', async (_, payload = {}) => {
    try {
      if (!payload || !payload.id) {
        return { ok: false, error: 'Message id is required.' }
      }
      const message = await untrashMailMessage(payload.id)
      return { ok: true, message }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:delete', async (_, payload = {}) => {
    try {
      if (!payload || !payload.id) {
        return { ok: false, error: 'Message id is required.' }
      }
      await deleteMailMessage(payload.id)
      return { ok: true, id: payload.id }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:get_contacts', async () => {
    try {
      return { ok: true, contacts: getMailContactsState() }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:add_contact', async (_, payload = {}) => {
    try {
      const contacts = addMailContact(payload)
      return { ok: true, contacts }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:sync_contacts', async (event, payload = {}) => {
    try {
      const messages = Array.isArray(payload.messages) ? payload.messages : []
      const sender = event && event.sender ? event.sender : null
      const contacts = await startMailContactsSync(messages, updatedContacts => {
        if (sender && !sender.isDestroyed()) {
          sender.send('mail:contacts_updated', { contacts: updatedContacts })
        }
      })
      return { ok: true, contacts }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:start_watch', async (event, payload = {}) => {
    try {
      const sender = event && event.sender ? event.sender : null
      const result = await startMailWatcher({
        intervalMs: payload && payload.intervalMs,
        onDelta: delta => {
          if (sender && !sender.isDestroyed()) {
            sender.send('mail:inbox_delta', delta)
          }
        }
      })
      return { ok: true, historyId: result && result.historyId }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('mail:stop_watch', async () => {
    try {
      stopMailWatcher()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: mailError(error) }
    }
  })

  ipcMain.handle('layout:right_panel_width', (_, width) => {
    const numericWidth = Number(width)
    const panelWidth = Number.isFinite(numericWidth) ? Math.max(0, Math.round(numericWidth)) : 340
    setRightPanelWidth(panelWidth)
    applyShellLayoutBounds()
    return { ok: true, width: panelWidth }
  });

  ipcMain.handle('engine:url', () => {
    return getEngineUrl()
  });
  ipcMain.on('theme:get_config', event => {
    // Full runtime payload (name, palette, varsCss, stylesheets) so the renderer
    // can inject the app-wide :root token block synchronously before first paint.
    event.returnValue = getThemeRuntime(__dirname)
  })

  // theme:list — Available themes plus the active one.
  ipcMain.handle('theme:list', () => {
    return {
      active: getThemeSelection(__dirname).activeTheme,
      themes: listThemes(__dirname)
    }
  })

  // theme:set — Persists the chosen theme and returns the new renderer
  // stylesheet list so the renderer can hot-swap its <link> tags (no reload).
  ipcMain.handle('theme:set', (_, name) => {
    try {
      console.log(`[theme-debug] theme:set -> ${name} (activeTab=${typeof activetab === 'object' ? (activetab && activetab.id) : activetab})`)
      setStoredTheme(__dirname, name)
      refreshThemeRuntime()
      const runtime = getThemeRuntime(__dirname)
      // Re-skin every live non-renderer surface so the switch is app-wide and
      // instant (no relaunch): Canvas WebContentsViews, engine views, the slate
      // overlay, and the OS title bar.
      reapplyThemeToOpenSurfaces()
      return {
        ok: true,
        active: runtime.name,
        rendererStylesheets: runtime.rendererStylesheets,
        varsCss: runtime.varsCss,
        colorScheme: runtime.colorScheme,
        palette: runtime.palette
      }
    } catch (error) {
      console.error('Unable to set theme:', error)
      return { ok: false, error: String(error && error.message || error) }
    }
  })

  // prompt:send — Forwards a user message to the Python agent.
  // in:  payload ({ message: string })
  // out: undefined
  ipcMain.handle('prompt:send', (_, payload) => {
    senduserprompt(["message", payload["message"]]).catch(error => {
      console.error('prompt send failed:', error)
      const window = BrowserWindow.getAllWindows()[0]
      if (window && !window.webContents.isDestroyed()) {
        window.webContents.send('prompt:response-done')
      }
    });
  });

  ipcMain.handle('synapse:send', async (event, payload = {}) => {
    const requestId = payload && payload.requestId ? payload.requestId : ''
    const sender = event.sender
    return synapseClient.send(payload, {
      onDelta: delta => {
        if (!requestId || sender.isDestroyed()) return
        sender.send('synapse:response-chunk', { requestId, delta })
      }
    })
  });

  // tabs:new_active — Switches the active rendered tab view.
  // in:  tab ({ view: WebContentsView, ... } | 'None')
  // out: undefined
  ipcMain.handle('tabs:new_active', async (_, tab) => runSerializedTabOperation(async () => {
    const previousActive = activetab !== "None" ? activetab : null

    if (tab === 'None') {
      if (previousActive) {
        await tabViewLifecycle.onTabDeactivated(previousActive, mainwindow)
      }
      syncActiveSurfaceFromMainTab(mainwindow, null)
      return
    }
    const foundtab = currtabs.find(localtab => sameTabId(localtab.id, tab.id))
    if (!foundtab) {
      if (previousActive) {
        await tabViewLifecycle.onTabDeactivated(previousActive, mainwindow)
      }
      syncActiveSurfaceFromMainTab(mainwindow, null)
      return
    }

    if (tab && tab.pendingSwitchSlate) {
      foundtab.pendingSwitchSlate = true
    } else {
      foundtab.pendingSwitchSlate = false
    }

    activeWorkspaceIdForPool = foundtab.workspaceId || activeWorkspaceIdForPool
    if (previousActive && !sameTabId(previousActive.id, foundtab.id)) {
      await tabViewLifecycle.onTabDeactivated(previousActive, mainwindow)
    }
    await tabViewLifecycle.deactivateTabsOutsideWorkspace(
      foundtab.workspaceId,
      foundtab.id,
      mainwindow
    )
    activetab = foundtab
    await tabViewLifecycle.onTabActivated(foundtab, mainwindow)
    syncActiveSurfaceFromMainTab(mainwindow, foundtab)
    if (isNativeSurfaceTab(foundtab)) {
      hideAllWebContentViews(mainwindow)
    } else if (isWebContentTab(foundtab) && foundtab.view) {
      if (foundtab.type === "canvastab") {
        scheduleCanvasPredictiveRefresh(mainwindow, foundtab)
      } else {
        browserpool.syncPredictedBackups(mainwindow, foundtab).catch(error => {
          console.error("Unable to sync predicted browser backups:", error)
        })
      }
    }
  }))

  ipcMain.handle('workspaces:new', (_, payload) => {
    if (typeof payload === "string") {
      return dataStore.newWorkspace(payload, "new workspace", "workspace for anything")
    }
    return dataStore.newWorkspace(payload.id, payload.name, payload.description || "")
  })

  ipcMain.handle('workspaces:delete', (_, workspaceid) => {
    return dataStore.deleteWorkspace(workspaceid)
  })

  ipcMain.handle('canvas:open_app', async () => {
    await openCanvasApp()
    return { ok: true }
  })

  ipcMain.handle('canvas:ensure_auth', async () => {
    try {
      const ok = await ensureCanvasAuthForNavigation(session.defaultSession)
      return { ok }
    } catch (error) {
      return {
        ok: false,
        error: error && error.message ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('canvas:clear_sync_data', () => clearCanvasSyncData())

  // surface:scrolled — the active WebContentsView (web or Canvas) reports a scroll
  // position change so the main process can refresh the render-context screen slice
  // event-driven (on every y-scroll) instead of on a fixed poll. Shared channel for
  // plain web (web-preload.js) and Canvas (app/canvas/preload.js) views.
  ipcMain.on('surface:scrolled', (event) => {
    if (activetab === "None" || !isHtmlVisibleContextTab(activetab) || !activetab.view) return
    if (activetab.view.webContents.isDestroyed()) return
    if (event.sender !== activetab.view.webContents) return
    scheduleVisibleContextUpdate()
  })

  // context:ui_state — the renderer pushes its UI state (sections, sidebar/AI panel
  // layout, workspace catalog, full tab list) whenever it renders. Feeds the app /
  // layout / workspaces / tabs / surface slices.
  ipcMain.on('context:ui_state', (_event, payload = {}) => {
    applyRendererUiState(payload && typeof payload === 'object' ? payload : null)
    logAppState('ui-state')
  })

  // context:screen_text — the renderer pushes visible #view text for native-surface
  // apps (Mail / Canvas-native / Synapse / Project Center) and home/section views,
  // which render into the renderer DOM and cannot be scraped from the main process.
  ipcMain.on('context:screen_text', (_event, payload = {}) => {
    if (screenSliceOwner !== 'renderer') return
    if (!payload || typeof payload !== 'object') return
    const incoming = Array.isArray(payload.blocks) ? payload.blocks : []
    const text = []
    let chars = 0
    for (const block of incoming) {
      if (!block || !block.text) continue
      if (text.length >= MAX_VISIBLE_TEXT_BLOCKS || chars >= MAX_VISIBLE_TEXT_CHARS) break
      const value = compactText(String(block.text), 320)
      if (!value) continue
      text.push({
        tag: String(block.tag || 'text'),
        text: value,
        y: Math.round(Number(block.y) || 0),
        x: Math.round(Number(block.x) || 0)
      })
      chars += value.length
    }
    const scroll = payload.scroll && typeof payload.scroll === 'object' ? payload.scroll : {}
    contextStore.update('screen', {
      source: 'renderer-dom',
      surfaceKind: String(payload.kind || ''),
      url: String(payload.url || ''),
      title: String(payload.title || ''),
      scroll: {
        y: Math.round(Number(scroll.y) || 0),
        ratio: Number(scroll.contentHeight) ? (Number(scroll.y) || 0) / Number(scroll.contentHeight) : 0,
        viewportHeight: Math.round(Number(scroll.viewportHeight) || 0),
        contentHeight: Math.round(Number(scroll.contentHeight) || 0)
      },
      text,
      canvas: null,
      truncated: incoming.length > text.length,
      charCount: chars
    })
    logAppState('renderer-screen')
  })

  ipcMain.handle('region:text_context', async (_, payload = {}) => {
    try {
      const tabId = String(payload.tabId || '')
      const tab = currtabs.find(item => item && sameTabId(item.id, tabId))
      if (!tab || !isWebContentTab(tab) || !tab.view || tab.view.webContents.isDestroyed()) {
        return { ok: false, error: 'Active web tab not found for region capture.' }
      }
      const region = payload.region && typeof payload.region === 'object' ? payload.region : {}
      return captureRegionContextForTab(tab, region)
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) }
    }
  })

  ipcMain.handle('region:capture_shortcut', async (_, payload = {}) => {
    try {
      const tabId = String(payload.tabId || '')
      logRegionCaptureDebug('capture_shortcut_ipc_start', { tabId })
      const tab = currtabs.find(item => item && sameTabId(item.id, tabId))
      if (!tab || !isWebContentTab(tab) || !tab.view || tab.view.webContents.isDestroyed()) {
        logRegionCaptureDebug('capture_shortcut_ipc_no_tab', { tabId })
        return { ok: false, error: 'Active web tab not found for region capture.' }
      }
      const localRegion = await runInPageRegionOverlay(tab)
      if (!localRegion || Number(localRegion.width) <= 4 || Number(localRegion.height) <= 4) {
        logRegionCaptureDebug('capture_shortcut_cancelled', { tabId, localRegion: localRegion || null })
        return { ok: false, cancelled: true, error: 'Region capture cancelled.' }
      }
      const browserBounds = getBrowserBounds(mainwindow, tab)
      const absoluteRegion = {
        x: Math.round((Number(browserBounds.x) || 0) + (Number(localRegion.x) || 0)),
        y: Math.round((Number(browserBounds.y) || 0) + (Number(localRegion.y) || 0)),
        width: Math.round(Number(localRegion.width) || 0),
        height: Math.round(Number(localRegion.height) || 0)
      }
      logRegionCaptureDebug('capture_shortcut_region_selected', { tabId, absoluteRegion })
      const result = await captureRegionContextForTab(tab, absoluteRegion)
      logRegionCaptureDebug('capture_shortcut_finished', {
        tabId,
        ok: Boolean(result && result.ok),
        mode: result && result.mode ? result.mode : '',
        error: result && result.error ? result.error : ''
      })
      return result
    } catch (error) {
      logRegionCaptureDebug('capture_shortcut_error', {
        error: error && error.message ? error.message : String(error)
      })
      return { ok: false, error: error && error.message ? error.message : String(error) }
    }
  })

  ipcMain.handle('tabs:navigate', async (_, tabid, value) => {
    const foundtab = currtabs.find(localtab => sameTabId(localtab.id, tabid))
    if (!foundtab || !isWebContentTab(foundtab) || !foundtab.view) {
      return { ok: false, error: "Browser tab not found." }
    }
    const searchQuery = getEngineSearchQuery(value)
    if (searchQuery !== null) {
      await openEngineSearchInTab(foundtab, searchQuery.query, searchQuery.type)
      return { ok: true, url: value, search: searchQuery.query, type: searchQuery.type }
    }
    const canvasRoute = getEngineCanvasRoute(value)
    if (canvasRoute !== null) {
      openEngineCanvasRoute(foundtab, canvasRoute)
      return { ok: true, url: value, canvas: canvasRoute.url }
    }
    const appRoute = getEngineAppRoute(value)
    if (appRoute) {
      openEngineAppInTab(foundtab, appRoute)
      return { ok: true, url: value, app: appRoute }
    }
    const url = normalizeBrowserUrl(value)
    foundtab.url = url
    if (foundtab.type === "canvastab") {
      if (isLikelyDownloadUrl(url)) {
        markIntentionalDownload(foundtab.view, url)
        foundtab.view.webContents.downloadURL(url)
        return { ok: true, url, download: true }
      }
      const hasAuth = await ensureCanvasAuthForNavigation(foundtab.view.webContents.session)
      if (!hasAuth) {
        mainwindow.webContents.send('canvas:navigation-finished', 'auth')
        revealCanvasView(foundtab.view)
        return { ok: false, error: "Canvas auth is not ready.", url }
      }
      await runCanvasSlateNavigation(mainwindow, foundtab.view, () => {
        return loadCanvasTabURL(foundtab.view, url, status => {
          mainwindow.webContents.send('canvas:navigation-finished', status)
        })
      })
    } else {
      await foundtab.view.webContents.loadURL(url)
    }
    return { ok: true, url }
  })

  // handles view of active tab when tabs:back is called in renderer
  //in: tabid of tab going back
  ipcMain.handle('tabs:back', async (_, tabid) => {
    const foundtab = currtabs.find(localtab => sameTabId(localtab.id, tabid))
    if (!foundtab || !isWebContentTab(foundtab) || !foundtab.view) {
      return { ok: false, error: "Browser tab not found." }
    }
    if (foundtab.view.webContents.canGoBack()) {
      if (foundtab.type === "canvastab") {
        await runCanvasSlateNavigation(mainwindow, foundtab.view, async () => {
          const navpromise = waitForCanvasNavigation(foundtab.view)
          canvaspageload(foundtab.view, status => {
            mainwindow.webContents.send('canvas:navigation-finished', status)
          })
          foundtab.view.webContents.goBack()
          await waitForCanvasNavigationAndSettle(foundtab.view, navpromise)
        }, { direction: 'left', revealOnTop: false })
        if (foundtab.view.webContents.getURL() === canvasBlankWarmUrl) {
          foundtab.view.setVisible(false)
          foundtab.url = ""
          return { ok: true, wentBack: false, restoreNative: true }
        }
      } else {
        foundtab.view.webContents.goBack()
      }
      return { ok: true, wentBack: true }
    }
    return { ok: true, wentBack: false }
  })

  // tabs:push — Replaces the tracked list of active tabs.
  // in:  tabs (Array) or { tabs, activeTabId }
  // out: undefined
  ipcMain.handle("tabs:push", async(_, payload) => runSerializedTabOperation(async () => {
    const tabs = Array.isArray(payload) ? payload : (payload && payload.tabs) || []
    const activeTabId = Array.isArray(payload) ? null : (payload && payload.activeTabId) || null
    let[winwidth, winheight] = mainwindow.getSize()
    const incomingIds = new Set(tabs.map(tab => String(tab.id)))

    const closedTabCleanup = []
    for (const localtab of currtabs) {
      if (!incomingIds.has(String(localtab.id))) {
        if (activetab !== "None" && sameTabId(activetab.id, localtab.id)) {
          activetab = "None"
        }
        closedTabCleanup.push(
          browserpool.clearBackupForTab(mainwindow, getTabPoolType(localtab), localtab.id)
        )
        tabSnapshots.delete(String(localtab.id))
        if (tabSnapshotCaptureTimers.has(String(localtab.id))) {
          clearTimeout(tabSnapshotCaptureTimers.get(String(localtab.id)))
          tabSnapshotCaptureTimers.delete(String(localtab.id))
        }
        if (localtab.type === "canvastab") {
          closedTabCleanup.push(clearCanvasPredictiveViews(localtab.id, mainwindow))
        }
        if (localtab.view) {
          closedTabCleanup.push(releaseTabView(localtab, mainwindow))
        }
      }
    }
    await Promise.all(closedTabCleanup)

    currtabs = currtabs.filter(tab => incomingIds.has(String(tab.id)))
    tabids = new Set(currtabs.map(tab => tab.id))

    const resolvedActiveTabId = activeTabId
      || (activetab !== "None" ? activetab.id : null)

    for (const incomingTab of tabs) {
      let mainTab = currtabs.find(localtab => sameTabId(localtab.id, incomingTab.id))

      if (mainTab) {
        mergeIncomingTab(mainTab, incomingTab)
        if (!isWebContentTab(mainTab) && mainTab.view) {
          await stashTabViewToBackup(mainTab, mainwindow)
        }
      } else if (shouldTrackInCurrtabs(incomingTab)) {
        mainTab = createMainTabRecord(incomingTab)
        currtabs.push(mainTab)
        tabids.add(mainTab.id)
      }

      if (mainTab && isWebContentTab(mainTab) && !mainTab.view) {
          const tab = mainTab
          const isActiveTab = resolvedActiveTabId && sameTabId(tab.id, resolvedActiveTabId)
          if (!isActiveTab) {
            continue
          }
          if (await restoreDiscardedTabView(tab, mainwindow)) {
            continue
          }
          if (await restoreStashedTabView(tab, mainwindow)) {
            continue
          }
          const poolType = tab.type === "canvastab" ? "canvas" : "web"

          const acquired = browserpool.acquireForTab(poolType, tab.id, tab.url)
          let view = acquired.view
          const viewCameFromPool = acquired.viewCameFromPool
          const fromBackup = acquired.fromBackup
          if (!view) {
            console.error(`Unable to acquire ${poolType} view for tab ${tab.id}`)
            continue
          }
          browserpool.newTab(mainwindow, poolType).catch(error => {
            console.error("Unable to refresh browser pool:", error)
          })

          if (prepareTabViewWiring(view, tab)) {
          if (tab.type === "canvastab") {
            view.webContents.on('console-message', (_event, level, message, line, sourceId) => {
              console.log(`Canvas tab console [${level}] ${sourceId}:${line} ${message}`)
            })
          }
          const iframeInjectionTargets = new Map()
          const requestedIframeInjectionIds = tab.injection && Array.isArray(tab.injection.iframeTargets)
            ? new Set(tab.injection.iframeTargets)
            : tab.injection
              ? new Set(Object.keys(iframeInjectionFilesById))
              : new Set()
          const iframeInjectionCssById = tab.injection
            ? new Map(
                Object.entries(iframeInjectionFilesById)
                  .filter(([id]) => requestedIframeInjectionIds.has(id))
                  .map(([id, filename]) => [
                    id,
                    readInjectionCssFile(filename)
                  ])
              )
            : new Map()
          const injectFrameCSS = async frame => {
            if (!tab.injection || !frame || frame === view.webContents.mainFrame) return
            const target = iframeInjectionTargets.get(normalizeFrameUrl(frame.url))
            if (!target) return

            try {
              await frame.executeJavaScript(`
                (() => {
                  const styleId = "nucleus-${target.id}-css";
                  let style = document.getElementById(styleId);
                  if (!style) {
                    style = document.createElement("style");
                    style.id = styleId;
                    document.head.appendChild(style);
                  }
                  style.textContent = ${JSON.stringify(target.css)};
                })();
              `, true)
            } catch (error) {
              console.error("Unable to inject iframe CSS:", target.id, frame.url, error)
            }
          }
          const injectCanvasPreviewRedirector = async frame => {
            if (tab.type !== "canvastab" || !frame) return

            try {
              await frame.executeJavaScript(`
                (() => {
                  if (window.__nucleusCanvasPreviewRedirectorInstalled) return;
                  window.__nucleusCanvasPreviewRedirectorInstalled = true;

                  function isPreviewLink(link) {
                    return Boolean(
                      link &&
                      (
                        link.classList.contains("modal_preview_link") ||
                        link.dataset.canvadocSessionUrl ||
                        link.dataset.attachmentPreviewProcessing === "true"
                      )
                    );
                  }

                  function makePreviewUrl(link) {
                    const url = new URL(link.getAttribute("href"), window.location.href);
                    url.search = "";
                    url.searchParams.set("preview", "1");
                    url.searchParams.set("rand", String(Date.now()));
                    url.hash = "";
                    return url.href;
                  }

                  function collectUrls(value, urls) {
                    if (!value) return;
                    if (typeof value === "string") {
                      if (/^https?:\\/\\//i.test(value) || value.startsWith("/")) {
                        urls.push(new URL(value, window.location.href).href);
                      }
                      return;
                    }
                    if (Array.isArray(value)) {
                      value.forEach(item => collectUrls(item, urls));
                      return;
                    }
                    if (typeof value === "object") {
                      Object.values(value).forEach(item => collectUrls(item, urls));
                    }
                  }

                  async function getCanvadocPreviewUrl(link) {
                    const sessionUrl = link.dataset.canvadocSessionUrl;
                    if (!sessionUrl) return "";

                    const response = await fetch(new URL(sessionUrl, window.location.href).href, {
                      credentials: "include",
                      headers: {
                        Accept: "application/json"
                      }
                    });
                    const data = await response.json();
                    const urls = [];
                    collectUrls(data, urls);

                    return (
                      urls.find(url => /canvadoc|docviewer|viewer|view/i.test(url)) ||
                      urls.find(url => !/download|attachment/i.test(url)) ||
                      urls[0] ||
                      ""
                    );
                  }

                  async function openPreview(link) {
                    try {
                      const canvadocUrl = await getCanvadocPreviewUrl(link);
                      window.location.assign(canvadocUrl || makePreviewUrl(link));
                    } catch (error) {
                      console.warn("Nucleus Canvas preview fallback:", error);
                      window.location.assign(makePreviewUrl(link));
                    }
                  }

                  document.addEventListener("click", event => {
                    const link = event.target.closest && event.target.closest("a[href]");
                    if (!isPreviewLink(link)) return;

                    event.preventDefault();
                    event.stopImmediatePropagation();
                    openPreview(link);
                  }, true);
                })();
              `, true)
            } catch (error) {
              console.error("Unable to inject Canvas preview redirector:", frame.url, error)
            }
          }
          const injectCanvasPreviewRedirectors = () => {
            if (tab.type !== "canvastab") return
            const mainFrame = view.webContents.mainFrame
            if (!mainFrame) return
            const frames = Array.isArray(mainFrame.framesInSubtree)
              ? mainFrame.framesInSubtree
              : []

            injectCanvasPreviewRedirector(mainFrame)
            frames.forEach(frame => {
              if (frame !== mainFrame) {
                injectCanvasPreviewRedirector(frame)
              }
            })
          }
          const collectIframeInjectionTargets = async () => {
            if (!tab.injection) return

            try {
              const iframes = await view.webContents.executeJavaScript(`
                Array.from(document.querySelectorAll("iframe[id]")).map(frame => ({
                  id: frame.id,
                  src: frame.src
                }))
              `, true)

              iframeInjectionTargets.clear()
              iframes.forEach(frame => {
                const css = iframeInjectionCssById.get(frame.id)
                if (!css || !frame.src) return
                iframeInjectionTargets.set(normalizeFrameUrl(frame.src), {
                  id: frame.id,
                  css
                })
              })

              view.webContents.mainFrame.framesInSubtree.forEach(frame => {
                injectFrameCSS(frame)
              })
            } catch (error) {
              console.error("Unable to collect iframe injection targets:", error)
            }
          }
          view.webContents.on('did-finish-load', collectIframeInjectionTargets)
          view.webContents.on('did-finish-load', injectCanvasPreviewRedirectors)
          view.webContents.on('did-frame-finish-load', async (_event, isMainFrame, frameProcessId, frameRoutingId) => {
            const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
            if (isMainFrame) {
              await injectCanvasPreviewRedirector(frame)
              return
            }
            await injectFrameCSS(frame)
            await injectCanvasPreviewRedirector(frame)
          })
          view.webContents.setWindowOpenHandler(({ url }) => {
            if (handleEngineInternalNavigation(tab, url)) {
              return { action: 'deny' }
            }

            if (isLikelyDownloadUrl(url)) {
              markIntentionalDownload(view, url)
              view.webContents.downloadURL(url)
              return { action: 'deny' }
            }

            if (tab.type === "canvastab") {
              const prediction = findCanvasPredictiveEntry(tab.id, url)
              if (prediction) {
                swapCanvasPredictiveView(mainwindow, tab, prediction, url).catch(error => {
                  console.error("Unable to swap canvas predictive popup view:", error)
                })
                return { action: 'deny' }
              }
              ensureCanvasAuthForNavigation(view.webContents.session).then(hasAuth => {
                if (!hasAuth) {
                  mainwindow.webContents.send('canvas:navigation-finished', 'auth')
                  revealCanvasView(view)
                  return
                }
                return runCanvasSlateNavigation(mainwindow, view, () => {
                  return loadCanvasTabURL(view, url, status => {
                    mainwindow.webContents.send('canvas:navigation-finished', status)
                  })
                })
              }).catch(error => {
                console.error("Unable to load canvas tab popup URL:", error)
                mainwindow.webContents.send('canvas:navigation-finished', 'fail')
              })
            } else {
              view.webContents.loadURL(url);
            }
            return { action: 'deny' };
          });
          view.webContents.on('will-navigate', event => {
            const ownerTab = resolveTabForView(view, tab)
            if (!ownerTab) return
            if (handleEngineInternalNavigation(ownerTab, event.url)) {
              event.preventDefault()
            }
          })
          let canvasNavigationLoadPromise = null
          view.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
            if (!isCanvasBrowserTab(tab) || !isMainFrame || isInPlace) return
            if (isLikelyDownloadUrl(_url)) return
            if (view._nucleusSuppressNextCanvasSlate) {
              view._nucleusSuppressNextCanvasSlate = false
              return
            }
            if (view._nucleusSlateNavigationInProgress) return
            if (view._nucleusCanvasNavigationInProgress) return
            if (canvasNavigationLoadPromise) return

            const navpromise = waitForCanvasNavigation(view)
            canvasNavigationLoadPromise = canvaspageload(view, status => {
              mainwindow.webContents.send('canvas:navigation-finished', status)
            })
            coverCurrentCanvasNavigationWithSlate(mainwindow, view, navpromise).catch(error => {
              console.error("Unable to cover Canvas navigation with slate:", error)
            })
            canvasNavigationLoadPromise.finally(() => {
              canvasNavigationLoadPromise = null
            })
          })
          view.webContents.on('did-navigate', (_event, url) => {
            tab.url = url
            logTabNavigationState(tab, url, "did-navigate")
            mainwindow.webContents.send('tabs:url_update', { id: tab.id, url })
            scheduleVisibleContextUpdate()
          });
          view.webContents.on('did-navigate-in-page', (_event, url) => {
            tab.url = url
            logTabNavigationState(tab, url, "did-navigate-in-page")
            mainwindow.webContents.send('tabs:url_update', { id: tab.id, url })
            scheduleVisibleContextUpdate()
          });
          view.webContents.on('did-finish-load', () => {
            scheduleVisibleContextUpdate()
          })
          wireTabTitleUpdates(mainwindow, view, tab)
          view._nucleusTabWired = true
          if (tab.type === "canvastab") {
            attachCanvasPredictiveNavigationHandlers(mainwindow, tab, view)
          }
          }
          attachWebContentView(mainwindow, view, tab)
          view.setVisible(false)
          tab.view = view
          tab.poolType = poolType
          view._nucleusPoolType = poolType
          const initialUrl = tab.url || "https://www.google.com"
          if (tab.type === "canvastab") {
            const recycledUrl = view.webContents.isDestroyed() ? "" : view.webContents.getURL()
            const backupContentMatches = fromBackup && (!tab.url || browserpool.urlsLikelyMatch(recycledUrl, tab.url))
            if (backupContentMatches) {
              tab.url = tab.url || recycledUrl || initialUrl
              mainwindow.webContents.send('tabs:url_update', { id: tab.id, url: tab.url })
              pushTabTitleFromView(mainwindow, view, tab)
              mainwindow.webContents.send('canvas:navigation-finished', 'done')
              revealCanvasView(view)
              refreshCanvasPredictiveViews(mainwindow, tab).catch(error => {
                console.error("Unable to refresh canvas predictive views after restore:", error)
              })
            } else {
            const hasAuth = await ensureCanvasAuthForNavigation(view.webContents.session)
            if (!hasAuth) {
              mainwindow.webContents.send('canvas:navigation-finished', 'auth')
              revealCanvasView(view)
            } else if (viewCameFromPool || fromBackup) {
              view._nucleusSuppressNextCanvasSlate = true
              loadCanvasTabURL(view, initialUrl, status => {
                mainwindow.webContents.send('canvas:navigation-finished', status)
              }).catch(error => {
                console.error("Unable to load initial canvas tab URL:", error)
                mainwindow.webContents.send('canvas:navigation-finished', 'fail')
                revealCanvasView(view)
              })
            } else {
              runCanvasSlateNavigation(mainwindow, view, () => {
                return loadCanvasTabURL(view, initialUrl, status => {
                  mainwindow.webContents.send('canvas:navigation-finished', status)
                })
              }).catch(error => {
                console.error("Unable to load initial canvas tab URL:", error)
                mainwindow.webContents.send('canvas:navigation-finished', 'fail')
                revealCanvasView(view)
              })
            }
            }
          } else {
            if (fromBackup) {
              tab.url = tab.url || view.webContents.getURL() || initialUrl
              mainwindow.webContents.send('tabs:url_update', { id: tab.id, url: tab.url })
              pushTabTitleFromView(mainwindow, view, tab)
            } else {
              await view.webContents.loadURL(initialUrl)
            }
          }
      }
    }

    const activeMainTab = activeTabId
      ? currtabs.find(localtab => sameTabId(localtab.id, activeTabId))
      : (activetab !== "None" ? activetab : null)
    if (activeMainTab && activeMainTab.workspaceId) {
      activeWorkspaceIdForPool = activeMainTab.workspaceId
      await tabViewLifecycle.deactivateTabsOutsideWorkspace(
        activeMainTab.workspaceId,
        activeMainTab.id,
        mainwindow
      )
    }
    for (const tab of currtabs) {
      if (!isWebContentTab(tab) || !tab.view) continue
      if (activeMainTab && sameTabId(tab.id, activeMainTab.id)) continue
      await stashTabViewToBackup(tab, mainwindow)
    }
    if (activeMainTab && isWebContentTab(activeMainTab) && !activeMainTab.view) {
      await ensureActiveWebContentTabView(activeMainTab, mainwindow)
    }
    syncActiveSurfaceFromMainTab(mainwindow, activeMainTab)

    if (activeMainTab && isWebContentTab(activeMainTab) && activeMainTab.view) {
      if (activeMainTab.type === "canvastab") {
        scheduleCanvasPredictiveRefresh(mainwindow, activeMainTab)
      } else {
        browserpool.syncPredictedBackups(mainwindow, activeMainTab).catch(error => {
          console.error("Unable to sync predicted browser backups:", error)
        })
      }
    }
  }))

  ipcMain.handle('injection:get', () => {
    const pathFromTheme = activeThemeManifest
      && activeThemeManifest.canvas
      && activeThemeManifest.canvas.mainInjectionPath
      ? activeThemeManifest.canvas.mainInjectionPath
      : 'injection.css'
    return readThemeCss(__dirname, pathFromTheme, '')
  })

  ipcMain.handle('tabs:write_active_html', async () => {
    if (activetab === "None" || !activetab.view) {
      return { ok: false, error: "No active browser tab." }
    }

    const html = await activetab.view.webContents.executeJavaScript(
      "document.documentElement.outerHTML",
      true
    )
    fs.writeFileSync(path.join(__dirname, 'assignmenthtml.json'), JSON.stringify(html, null, 2))
    console.log(`Wrote active tab HTML to assignmenthtml.json (${html.length} characters).`)
    return { ok: true, characters: html.length }
  })

  ipcMain.handle('tabs:write_active_frames_html', async () => {
    if (activetab === "None" || !activetab.view) {
      return { ok: false, error: "No active browser tab." }
    }

    const outputDir = path.join(__dirname, 'frame-html')
    const mainFrame = activetab.view.webContents.mainFrame
    const subtreeFrames = mainFrame && Array.isArray(mainFrame.framesInSubtree)
      ? mainFrame.framesInSubtree
      : []
    const frameList = mainFrame
      ? [mainFrame, ...subtreeFrames.filter(frame => frame !== mainFrame)]
      : []
    const manifest = []

    fs.mkdirSync(outputDir, { recursive: true })

    for (const [index, frame] of frameList.entries()) {
      const filename = getFrameSnapshotName(frame, index)
      const filepath = path.join(outputDir, filename)
      const entry = {
        index,
        filename,
        name: frame.name || "",
        url: frame.url || "",
        isMainFrame: frame === mainFrame,
        ok: false,
        characters: 0
      }

      try {
        const html = await frame.executeJavaScript(
          "document.documentElement ? document.documentElement.outerHTML : ''",
          true
        )
        fs.writeFileSync(filepath, html || "", 'utf-8')
        entry.ok = true
        entry.characters = html ? html.length : 0
      } catch (error) {
        entry.error = error && error.message ? error.message : String(error)
      }

      manifest.push(entry)
    }

    fs.writeFileSync(
      path.join(outputDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    )
    console.log(`Wrote ${manifest.length} frame HTML snapshots to ${outputDir}.`)
    return { ok: true, directory: outputDir, frames: manifest.length, manifest }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });


});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
