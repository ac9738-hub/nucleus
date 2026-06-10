// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

// Main Electron process.
// Functionality: owns BrowserWindow/WebContentsView lifecycle, IPC handlers,
// Canvas authentication, Canvas/browser tab navigation, agent tools, and search.
// Dependencies: renderer/preload.js IPC contract, app/canvas/api.js data sync,
// app/canvas/auth.js auth capture view, engine.js search renderer, sidekick.py
// and vector_retreival.py child processes.
const { app, BrowserWindow, ipcMain, WebContentsView, session, webFrameMain } = require('electron');
const path = require('path');
const fs = require('fs')
const { spawn } = require('child_process')
const {open_canvas_auth_window, get_auth_token, get_auth_csrf, get_base_url} = require('./app/canvas/auth')
const { createAgentProcess } = require('./agent-process')
const { createDataStore } = require('./data-store')
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
        label: cache.label || ""
      }
    }
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
    if (match) return match

    if (normalizedUrl) {
      match = entries.find(entry => (
        entry.cache.role === "stashed" &&
        (!normalizedTabId || entry.cache.tabId === normalizedTabId) &&
        this.urlsLikelyMatch(entry.cache.url, normalizedUrl)
      ))
      if (match) return match
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
      url: liveUrl && liveUrl !== canvasBlankWarmUrl ? liveUrl : cache.url,
      label: cache.label
    })

    const deque = this.backupDeque(type)
    while (deque.length >= this.backupCount(type)) {
      const evicted = deque.popFront()
      if (evicted && evicted.view) {
        await this.releaseView(window, type, evicted.view, false)
      }
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
      return new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, "app", "canvas", "preload.js"),
          sandbox: false
        }
      })
    }
    return new WebContentsView()
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
    const appStateContext = buildLiveAppStateText()
    const payloadObject = typeof messagePayload === 'object' && messagePayload !== null
      ? { ...messagePayload }
      : { text: String(messagePayload || '') }
    const existingSystemContext = String(payloadObject.systemContext || '').trim()
    payloadObject.systemContext = [existingSystemContext, appStateContext].filter(Boolean).join('\n\n')
    payloadObject.text = `${messageText}${retrievalContext}`
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
let tabsPushChain = Promise.resolve()
let slate = null
let canvasSetupPromise = null
let mainwindow = null
let currentCanvasPageContext = null
let lastCanvasVisibleContextKey = ''
let canvasVisibleContextPollInFlight = false
let canvasVisibleContextUpdateQueued = false
let lastAppStateLogKey = ''
// Cached lightweight Canvas graph index. The on-disk canvas_graph.json can be
// hundreds of MB, so we parse it at most once per file change and keep only the
// fields the visible-context feature needs (plus precomputed lookup maps).
let canvasGraphIndex = null
let canvasGraphVisibleIndexes = null
let canvasGraphCacheKey = ''

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
      canvaspreviewurl: task.canvaspreviewurl
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
  onCanvasTasks: tasks => addCanvasTasks(tasks)
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
    app: appName
  })
  return true
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

function compactText(value, maxLength = 180) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
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

  return { files, concepts, problems }
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
    const parsed = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
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

  return { concepts, details, examples, problems }
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
    canvas: currentCanvasPageContext || null
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

  return lines.join('\n')
}

// Appends one JSONL record of the full app state handed to the LLM whenever it
// changes (tab open/close/switch, page change, y-scroll). `systemContext` is
// byte-identical to what senduserprompt() injects. De-duplicated so identical
// consecutive snapshots are not re-logged. Async write keeps the main thread free.
function logAppState(reason = '') {
  try {
    const snapshot = buildAppStateSnapshot()
    const systemContext = buildLiveAppStateText()
    const key = JSON.stringify({
      rendered: snapshot.rendered,
      activeTabId: snapshot.activeTab ? snapshot.activeTab.id : null,
      tabs: snapshot.openTabs.map(tab => `${tab.id}:${tab.type}:${tab.canvasMode || ''}:${tab.url}`),
      canvasKey: lastCanvasVisibleContextKey
    })
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
      systemContext
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
function scheduleCanvasVisibleContextUpdate() {
  if (canvasVisibleContextUpdateQueued) return
  canvasVisibleContextUpdateQueued = true
  setTimeout(async () => {
    canvasVisibleContextUpdateQueued = false
    await updateCurrentCanvasVisibleContext()
    // Also captures tab open/close/switch that don't change the Canvas context.
    logAppState('surface-update')
  }, 80)
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
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#171a21',
      symbolColor: '#e7e9ee',
      height: 56
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

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
  view._nucleusPredictiveSwapHandlerAttached = false
  view._nucleusPredictiveHandlersAttached = false
  view._nucleusPredictive = false
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
  if (!mainTab) {
    renderTab("None", window)
    activetab = "None"
    scheduleCanvasVisibleContextUpdate()
    return
  }
  if (isWebContentTab(mainTab) && mainTab.view) {
    renderTab(mainTab.view, window, mainTab)
    activetab = mainTab
    scheduleCanvasVisibleContextUpdate()
    return
  }
  if (isNativeSurfaceTab(mainTab)) {
    renderTab("None", window)
    activetab = mainTab
    scheduleCanvasVisibleContextUpdate()
    return
  }
  renderTab("None", window)
  activetab = "None"
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

async function stashTabViewToBackup(tab, window = mainwindow) {
  if (!tab || !tab.view) return "closed"
  const poolType = getTabPoolType(tab)
  detachWebContentView(window, tab.view)
  if (poolType === "canvas") {
    await clearCanvasPredictiveViews(tab.id, window)
  }
  const view = tab.view
  const cache = {
    tabId: tab.id,
    url: tab.url,
    label: tab.label
  }
  tab.view = null
  tab.poolType = null
  return browserpool.stashToBackup(window, poolType, view, cache)
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
    window.webContents.send("tabs:url_update", { id: tab.id, url })
  })

  view.webContents.on("did-navigate-in-page", (_event, url) => {
    if (tab.view !== view) return
    tab.url = url
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
  if (!view._nucleusBlankedForCanvasWipe) {
    view.setVisible(true)
  }
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

async function setup() {
  if (!canvasSetupPromise) {
    canvasSetupPromise = canvasApi.setupCanvasData()
      .finally(() => {
        canvasSetupPromise = null
      })
  }
  return canvasSetupPromise
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
      await setup()
      return { ok: true, status: "cached-auth" }
    } catch (error) {
      console.warn("Saved Canvas auth failed, opening auth window:", error && error.message ? error.message : error)
    }
  }

  open_canvas_auth_window(mainwindow, getauth, getauthview, setup)
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

function revealCanvasView(view) {
  if (!view) return
  const tab = getTabForView(view) || (activetab !== "None" && activetab.view === view ? activetab : null)
  if (tab && tab.type === "canvastab" && !isCanvasBrowserTab(tab)) {
    view.setVisible(false)
    return
  }
  view._nucleusCanvasNavigationInProgress = false

  const window = BrowserWindow.getAllWindows()[0]
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

  if (view._nucleusRevealTimer) {
    clearTimeout(view._nucleusRevealTimer)
  }
  view._nucleusRevealTimer = setTimeout(() => {
    view._nucleusRevealTimer = null
    const stillActiveView = activetab !== "None" && activetab.view === view
    if (!stillActiveView || view._nucleusBlankedForCanvasWipe) return

    view.setVisible(true)
    if (window) {
      window.webContents.send('canvas:view-ready', {
        id: tab ? tab.id : null
      })
    }
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

app.whenReady().then(() => {
  mainwindow = createWindow();
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
    event.returnValue = {
      name: getThemeSelection(__dirname).activeTheme,
      rendererStylesheets: getRendererStylesheets(__dirname)
    }
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
      setStoredTheme(__dirname, name)
      refreshThemeRuntime()
      return {
        ok: true,
        active: getThemeSelection(__dirname).activeTheme,
        rendererStylesheets: getRendererStylesheets(__dirname)
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
  ipcMain.handle('tabs:new_active', (_, tab) => {
    if (tab === 'None') {
      syncActiveSurfaceFromMainTab(mainwindow, null)
      return
    }
    const foundtab = currtabs.find(localtab => sameTabId(localtab.id, tab.id))
    if (!foundtab) {
      syncActiveSurfaceFromMainTab(mainwindow, null)
      return
    }
    syncActiveSurfaceFromMainTab(mainwindow, foundtab)
    if (isWebContentTab(foundtab) && foundtab.view) {
      if (foundtab.type === "canvastab") {
        refreshCanvasPredictiveViews(mainwindow, foundtab).catch(error => {
          console.error("Unable to refresh canvas predictive views:", error)
        })
      } else {
        browserpool.syncPredictedBackups(mainwindow, foundtab).catch(error => {
          console.error("Unable to sync predicted browser backups:", error)
        })
      }
    }
  })

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

  // canvas:scrolled — the active Canvas tab reports a scroll position change so
  // the main process can refresh the visible-context (replaces fixed polling).
  ipcMain.on('canvas:scrolled', (event) => {
    if (activetab === "None" || !isCanvasBrowserTab(activetab) || !activetab.view) return
    if (activetab.view.webContents.isDestroyed()) return
    if (event.sender !== activetab.view.webContents) return
    scheduleCanvasVisibleContextUpdate()
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
  ipcMain.handle("tabs:push", async(_, payload) => {
    const runPush = async() => {
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
            if (isEngineHomeUrl(url)) {
              tab.url = 'nucleus://engine'
              view.webContents.loadURL(getEngineUrl())
              mainwindow.webContents.send('tabs:url_update', { id: tab.id, url: tab.url })
              return { action: 'deny' }
            }

            const searchQuery = getEngineSearchQuery(url)
            if (searchQuery !== null) {
              openEngineSearchInTab(tab, searchQuery.query, searchQuery.type).catch(error => {
                console.error("Unable to load engine search popup URL:", error)
              })
              return { action: 'deny' }
            }

            const canvasRoute = getEngineCanvasRoute(url)
            if (canvasRoute !== null) {
              openEngineCanvasRoute(tab, canvasRoute)
              return { action: 'deny' }
            }

            const appRoute = getEngineAppRoute(url)
            if (appRoute) {
              openEngineAppInTab(tab, appRoute)
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
            const url = event.url
            if (isEngineHomeUrl(url)) {
              event.preventDefault()
              ownerTab.url = 'nucleus://engine'
              view.webContents.loadURL(getEngineUrl())
              mainwindow.webContents.send('tabs:url_update', { id: ownerTab.id, url: ownerTab.url })
              return
            }

            const searchQuery = getEngineSearchQuery(url)
            if (searchQuery !== null) {
              event.preventDefault()
              openEngineSearchInTab(ownerTab, searchQuery.query, searchQuery.type).catch(error => {
                console.error("Unable to load engine search navigation:", error)
              })
              return
            }

            const canvasRoute = getEngineCanvasRoute(url)
            if (canvasRoute !== null) {
              event.preventDefault()
              openEngineCanvasRoute(ownerTab, canvasRoute)
              return
            }

            const appRoute = getEngineAppRoute(url)
            if (!appRoute) return
            event.preventDefault()
            openEngineAppInTab(ownerTab, appRoute)
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
            mainwindow.webContents.send('tabs:url_update', { id: tab.id, url })
          });
          view.webContents.on('did-navigate-in-page', (_event, url) => {
            tab.url = url
            mainwindow.webContents.send('tabs:url_update', { id: tab.id, url })
          });
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
            } else {
              await view.webContents.loadURL(initialUrl)
            }
          }
      }
    }

    const activeMainTab = activeTabId
      ? currtabs.find(localtab => sameTabId(localtab.id, activeTabId))
      : (activetab !== "None" ? activetab : null)
    syncActiveSurfaceFromMainTab(mainwindow, activeMainTab)

    if (activeMainTab && isWebContentTab(activeMainTab) && activeMainTab.view) {
      if (activeMainTab.type === "canvastab") {
        refreshCanvasPredictiveViews(mainwindow, activeMainTab).catch(error => {
          console.error("Unable to refresh canvas predictive views:", error)
        })
      } else {
        browserpool.syncPredictedBackups(mainwindow, activeMainTab).catch(error => {
          console.error("Unable to sync predicted browser backups:", error)
        })
      }
    }
    }

    tabsPushChain = tabsPushChain.then(runPush, runPush)
    return tabsPushChain
  })

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
