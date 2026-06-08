// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, WebContentsView, session, webFrameMain, View } = require('electron');
const path = require('path');
const fs = require('fs')
const { spawn } = require('child_process')
const { runStartTaskPlaceholder } = require('./task-scripts');
const {open_canvas_auth_window, get_auth_token, get_auth_csrf, get_base_url} = require('./app/canvas/auth')
const { createAgentProcess } = require('./agent-process')
const { createDataStore } = require('./data-store')
const { renderwebsearchresult, searchweb } = require('./engine')
const { getAuthBounds, getBrowserBounds } = require('./view-layout')
const {
  getFrameSnapshotName,
  isLikelyDownloadUrl,
  isWebContentTab,
  normalizeBrowserUrl,
  normalizeFrameUrl,
  sameTabId
} = require('./tab-utils')
const { createCanvasApi } = require('./app/canvas/api')


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

class BrowserPool {
  constructor() {
    this.availableweb = new LinkedDeque()
    this.availablecanvas = new LinkedDeque()
    this.preloadedcanvas = new LinkedDeque()
    this.inuseweb = new LinkedDeque()
    this.inusecanvas = new LinkedDeque()
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
    if (this.totalAvailableLength() <= 10) {
      await this.warm(window, type, 1)
      return true
    }
    return false
  }

  async load(window) {
    await this.warm(window, "web", 2)
    await this.warm(window, "canvas", 2)
  }
}

const browserpool = new BrowserPool()
const envPath = path.join(__dirname, '.env')
const iframeInjectionFilesById = {
  preview_frame: 'preview_frame.css',
  tool_content: 'injection.css'
}
const canvasBlankWarmUrl = "data:text/html;charset=utf-8," + encodeURIComponent(`
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <style>
        html,
        body {
          background: #0f1117;
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
        item.courseid ? `Course ID: ${item.courseid}` : '',
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
          console.log('vector retrieval startpoints:', result.startpoints)
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
        console.log('vector retrieval skipped empty query')
        return Promise.resolve([])
      }
      if (!proc || proc.killed || proc.stdin.destroyed) {
        console.log('vector retrieval process unavailable; restarting before query')
        start()
      }
      if (!proc || proc.killed || proc.stdin.destroyed) {
        console.error('vector retrieval unavailable after restart')
        return Promise.resolve([])
      }
      const line = JSON.stringify(['query', query, options]) + '\n'
      console.log('vector retrieval sending query:', query, options)
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
            console.log('vector retrieval query written')
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
    const startpoints = await vectorRetrieval.sendQuery(payload[1], { mode: 'agent' })
    const retrievalContext = vectorRetrieval.contextFor(startpoints)
    agent.send(['message', `${payload[1]}${retrievalContext}`])
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
let slate = null
let canvasSetupPromise = null
let mainwindow = null

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
  return fs.readFileSync(path.join(__dirname, filename), 'utf-8')
}

function getEngineUrl() {
  return new URL('file://' + path.join(__dirname, 'engine.html').replace(/\\/g, '/')).href
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

function getEngineSearchPageUrl(tab, html) {
  const outputDir = path.join(__dirname, 'engine-search-cache')
  const safeId = String(tab && tab.id ? tab.id : 'search').replace(/[^a-zA-Z0-9_-]/g, '_')
  const filepath = path.join(outputDir, `${safeId}.html`)

  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(filepath, html, 'utf-8')
  return new URL('file://' + filepath.replace(/\\/g, '/')).href
}

async function openEngineSearchInTab(tab, query, type = 'all') {
  if (!tab || !tab.view || !query) return false
  const searchType = ['all', 'images', 'news', 'videos'].includes(type) ? type : 'all'
  try {
    const [webResult, internalResult] = await Promise.allSettled([
      searchweb(query),
      vectorRetrieval.sendQuery(query, { mode: 'browser' })
    ])
    const result = webResult.status === 'fulfilled'
      ? webResult.value
      : {
          error: webResult.reason && webResult.reason.message ? webResult.reason.message : String(webResult.reason),
          web: { results: [] }
        }
    result.internalResults = internalResult.status === 'fulfilled' ? internalResult.value : []
    if (internalResult.status === 'rejected') {
      result.internalError = internalResult.reason && internalResult.reason.message
        ? internalResult.reason.message
        : String(internalResult.reason)
    }
    const html = renderwebsearchresult(result, query, searchType)
    const url = getEngineSearchPageUrl(tab, html)
    tab.url = `nucleus://search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(searchType)}`
    await tab.view.webContents.loadURL(url)
    mainwindow.webContents.send('tabs:url_update', { id: tab.id, url: tab.url })
    return true
  } catch (error) {
    const internalResults = await vectorRetrieval.sendQuery(query, { mode: 'browser' }).catch(() => [])
    const html = renderwebsearchresult({
      error: error && error.message ? error.message : String(error),
      web: { results: [] },
      internalResults
    }, query, searchType)
    const url = getEngineSearchPageUrl(tab, html)
    console.error("Unable to load Nucleus search:", error)
    await tab.view.webContents.loadURL(url)
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
    console.log("main: running add_task with data", data);
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
 * Creates a new WebContentsView inside the given window, loads a URL, and
 * positions it in the tab content area.
 *
 * @param {BrowserWindow} window           - Parent window to attach the view to.
 * @param {boolean} show                   - Whether the view should be visible immediately.
 * @param {string} [url="https://www.google.com"] - Initial URL to load.
 * @returns {WebContentsView}              - The created view, ready to be tracked.
 */
function createBrowserTab(window, show, url="https://www.google.com") {
  view1 = new WebContentsView()
  view1.setBounds(getBrowserBounds(window))
  view1.setVisible(show)
  view1.webContents.loadURL(url)
  window.contentView.addChildView(view1)
  return view1
}

/**
 * Renders (shows + repositions) the given tab view, or hides the active tab
 * if 'None' is passed.
 *
 * @param {WebContentsView|'None'} view - The view to show, or 'None' to hide.
 * @returns {void}
 */
function renderTab(view, window, tab = null) {
  if (view === 'None') {
    if (activetab !== 'None'){
      activetab.view.setVisible(false)
    }
    return
  }
  if (activetab !== 'None' && view !== activetab.view) {
    activetab.view.setVisible(false)
  }
  view.setBounds(getBrowserBounds(window, tab))
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
  console.log('main got authtokens: ' + canvas_auth_cookie + "\ncsrf: " + canvas_auth_csrf)
  installCanvasSessionCookies()
    .then(() => settleCanvasAuthWaiters())
    .catch(error => {
      console.error("Unable to install Canvas auth cookies:", error)
      settleCanvasAuthWaiters(error)
    })
}

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
  view._nucleusCanvasNavigationInProgress = false

  const window = BrowserWindow.getAllWindows()[0]
  if (tab && window) {
    view.setBounds(getBrowserBounds(window, tab))
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

  setTimeout(() => {
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

function startCanvasNavigation(window, view, options = {}) {
  const showWipe = options.showWipe !== false
  if (view && !showWipe) {
    view._nucleusCanvasNavigationInProgress = true
    view._nucleusBlankedForCanvasWipe = true
    //view.setVisible(false)
  }
  if (showWipe) {
    window.webContents.send('canvas:navigation')
  } else {
    window.webContents.send('canvas:blank')
  }
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

async function setSlateAnimation(view, currclass) {
  if (!view) return

  if (!view._nucleusSlateLoaded) {
    await new Promise(resolve => {
      view.webContents.once('did-finish-load', resolve)
    })
  }
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
        slate.classList.remove('show', 'hide');
        void slate.offsetWidth;
        slate.classList.add(${JSON.stringify(currclass)});
      });

    `, true)
  } catch (error) {
    console.error("Unable to animate slate:", error)
  }
}

function addslate(window) {
  console.log("added slate")
  
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

function hideslate(window){
  if (slate) {
    setSlateAnimation(slate, 'hide').finally(() => {
      slate.setVisible(false)
    })
  }
}

async function runCanvasSlateNavigation(window, view, action) {
  if (!view) return
  if (view._nucleusSlateNavigationInProgress) {
    return action()
  }

  view._nucleusSlateNavigationInProgress = true
  try {
    const gotslate = addslate(window)
    await setSlateAnimation(gotslate, 'show')
    view.setVisible(false)
    const result = await action()
    view.setVisible(true)
    await setSlateAnimation(gotslate, 'hide')
    gotslate.setVisible(false)
    return result
  } finally {
    view._nucleusSlateNavigationInProgress = false
  }
}

async function coverCurrentCanvasNavigationWithSlate(window, view, navpromise) {
  if (!view || view._nucleusSlateNavigationInProgress) return

  view._nucleusSlateNavigationInProgress = true
  try {
    const gotslate = addslate(window)
    await setSlateAnimation(gotslate, 'show')
    view.setVisible(false)
    await waitForCanvasNavigationAndSettle(view, navpromise)
    view.setVisible(true)
    await setSlateAnimation(gotslate, 'hide')
    gotslate.setVisible(false)
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
  
  mainwindow.on('resize', () => {
    console.log("resizing")
    if (activetab != "None"){
      console.log("resizing browser")
      activetab.view.setBounds(getBrowserBounds(mainwindow, activetab))
    }
    if (authview) {
      authview.setBounds(getAuthBounds(mainwindow))
    }
    setSlateBounds(mainwindow)
  })

  // ─── IPC Handlers ──────────────────────────────────────────────────────────

  // tasks:start — Runs the placeholder start-task script for a given task.
  // in:  task (Object) — task record from the renderer
  // out: { ok: true }
  ipcMain.handle('tasks:start', (_, task) => {
    runStartTaskPlaceholder(task);
    return { ok: true };
  });

  // data:get — Returns the current app data snapshot.
  // in:  none
  // out: { tasks, workspaces, projectGroups }
  ipcMain.handle('data:get', () => {
    return dataStore.getRendererDataSnapshot();
  });

  ipcMain.handle('engine:url', () => {
    return getEngineUrl()
  });

  // prompt:send — Forwards a user message to the Python agent.
  // in:  payload ({ message: string })
  // out: undefined
  ipcMain.handle('prompt:send', (_, payload) => {
    senduserprompt(["message",payload["message"]]).catch(error => {
      console.error('prompt send failed:', error)
    });
  });

  // tabs:new_active — Switches the active rendered tab view.
  // in:  tab ({ view: WebContentsView, ... } | 'None')
  // out: undefined
  ipcMain.handle('tabs:new_active', (_, tab) => {
    console.log("recieved signal tabs:new_active")
    if (tab === 'None') {
      console.log("set active tab to None")
      renderTab(tab, mainwindow)
      activetab = "None"
      return
    }
    console.log("trying to find: " + tab.id)
    let foundtab = currtabs.find(localtab => sameTabId(localtab.id, tab.id))
    if (!foundtab) {
      console.log("main: active tab not found: " + tab.id)
      renderTab('None', mainwindow)
      activetab = "None"
      return
    }
    console.log("foundtab: " + foundtab.id +" " + foundtab.type)
    if (isWebContentTab(foundtab)) {
      console.log("set activetab to foundtab to: " + foundtab.id)
      renderTab(foundtab.view, mainwindow, foundtab)
      activetab = foundtab
    } else {
      renderTab('None', mainwindow)
      activetab = "None"
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

  ipcMain.on('canvas:wipe-covered', () => {
    console.log("main: got signal blank canvas page")
    if (activetab === "None" || activetab.type !== "canvastab" || !activetab.view) return
    activetab.view._nucleusBlankedForCanvasWipe = true
    activetab.view.setVisible(false)
  })

  ipcMain.on('canvas:blank-shown', () => {
    console.log("main: got signal blank canvas shown")
    if (activetab === "None" || activetab.type !== "canvastab" || !activetab.view) return
    if (!activetab.view._nucleusCanvasNavigationInProgress) return
    activetab.view._nucleusBlankedForCanvasWipe = true
    activetab.view.setVisible(false)
  })

  ipcMain.on('canvas:wipe-hidden', () => {
    console.log("main: got signal wipe hidden")
    if (activetab === "None" || activetab.type !== "canvastab" || !activetab.view) return
    activetab.view._nucleusBlankedForCanvasWipe = false
    if (activetab.view._nucleusCanvasNavigationInProgress) return
    revealCanvasView(activetab.view)
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
        })
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
  // in:  tabs (Array of tab objects)
  // out: undefined
  ipcMain.handle("tabs:push", async(_, tabs) => {
    console.log('recieved tabs:push, tabs updated')
    let[winwidth, winheight] = mainwindow.getSize()
    const incomingIds = new Set(tabs.map(tab => String(tab.id)))

    for (const localtab of currtabs) {
      if (!incomingIds.has(String(localtab.id)) && localtab.view) {
        if (activetab !== "None" && sameTabId(activetab.id, localtab.id)) {
          activetab = "None"
        }
        mainwindow.contentView.removeChildView(localtab.view)
      }
    }

    currtabs = currtabs.filter(tab => incomingIds.has(String(tab.id)))
    tabids = new Set(currtabs.map(tab => tab.id))

    for (const tab of tabs) {
      const existingtab = currtabs.find(localtab => sameTabId(localtab.id, tab.id))

      if (existingtab) {
        existingtab.workspaceId = tab.workspaceId
        existingtab.label = tab.label
        existingtab.url = tab.url
        existingtab.type = tab.type
        existingtab.canvasMode = tab.canvasMode
        existingtab.canvasNativePage = tab.canvasNativePage
        existingtab.nativeHistory = tab.nativeHistory
        existingtab.courseId = tab.courseId
        existingtab.injection = tab.injection
        existingtab.loading = tab.loading
        if (!isWebContentTab(existingtab) && existingtab.view) {
          if (activetab !== "None" && sameTabId(activetab.id, existingtab.id)) {
            activetab = "None"
          }
          mainwindow.contentView.removeChildView(existingtab.view)
          existingtab.view = null
          currtabs = currtabs.filter(localtab => !sameTabId(localtab.id, existingtab.id))
        }
      } else {
        tabids.add(tab.id)
        if (isWebContentTab(tab)){
          console.log('found web content tab: ' + JSON.stringify(tab))
          const viewOptions = tab.type === "canvastab"
            ? {
                webPreferences: {
                  preload: path.join(__dirname, "app", "canvas", "preload.js"),
                  sandbox: false
                }
              }
            : {}
          const poolType = tab.type === "canvastab" ? "canvas" : "web"

          let view = browserpool.takeAvailable(poolType)
          const viewCameFromPool = Boolean(view)
          if (!view) {
            view = new WebContentsView(viewOptions)
            browserpool.addInUse(poolType, view)
          }
          browserpool.newTab(mainwindow, poolType).catch(error => {
            console.error("Unable to refresh browser pool:", error)
          })

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
            const url = event.url
            const searchQuery = getEngineSearchQuery(url)
            if (searchQuery !== null) {
              event.preventDefault()
              openEngineSearchInTab(tab, searchQuery.query, searchQuery.type).catch(error => {
                console.error("Unable to load engine search navigation:", error)
              })
              return
            }

            const canvasRoute = getEngineCanvasRoute(url)
            if (canvasRoute !== null) {
              event.preventDefault()
              openEngineCanvasRoute(tab, canvasRoute)
              return
            }

            const appRoute = getEngineAppRoute(url)
            if (!appRoute) return
            event.preventDefault()
            openEngineAppInTab(tab, appRoute)
          })
          let canvasNavigationLoadPromise = null
          view.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
            if (tab.type !== "canvastab" || !isMainFrame || isInPlace) return
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
          view.setVisible(false)
          view.setBounds(getBrowserBounds(mainwindow, tab))
          mainwindow.contentView.addChildView(view)
          tab.view = view
          const initialUrl = tab.url || "https://www.google.com"
          if (tab.type === "canvastab") {
            currtabs.push(tab)
            const hasAuth = await ensureCanvasAuthForNavigation(view.webContents.session)
            if (!hasAuth) {
              mainwindow.webContents.send('canvas:navigation-finished', 'auth')
              revealCanvasView(view)
            } else if (viewCameFromPool) {
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
          } else {
            await view.webContents.loadURL(initialUrl)
            currtabs.push(tab)
          }
        }
      }
    }
  })

  ipcMain.handle('injection:get', () => {
    return fs.readFileSync(path.join(__dirname, 'injection.css'), 'utf-8')
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
