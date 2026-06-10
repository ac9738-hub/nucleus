const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { EventEmitter } = require('node:events')
const Module = require('node:module')

function withModuleMocks(mocks, callback) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request]
    }
    return originalLoad.apply(this, [request, parent, isMain])
  }

  try {
    return callback()
  } finally {
    Module._load = originalLoad
  }
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)]
}

function makeJsonResponse(payload, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    statusText: options.statusText || 'OK',
    headers: { get: () => null },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
    async json() {
      return payload
    }
  }
}

function makeParserProcess() {
  const proc = new EventEmitter()
  proc.killed = false
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = {
    destroyed: false,
    writableEnded: false,
    write(_line, _encoding, callback) {
      if (typeof callback === 'function') callback()
      return true
    }
  }
  proc.kill = () => {
    proc.killed = true
  }
  return proc
}

function dateFnsMock() {
  function startOfWeek(value) {
    const date = new Date(value)
    const day = date.getUTCDay()
    const diff = (day + 6) % 7
    date.setUTCDate(date.getUTCDate() - diff)
    date.setUTCHours(0, 0, 0, 0)
    return date
  }

  return {
    startOfWeek,
    addWeeks(value, weeks) {
      const date = new Date(value)
      date.setUTCDate(date.getUTCDate() + (weeks * 7))
      return date
    },
    isSameWeek(left, right) {
      return Number(startOfWeek(left)) === Number(startOfWeek(right))
    },
    differenceInCalendarWeeks(left, right) {
      return Math.round((Number(startOfWeek(left)) - Number(startOfWeek(right))) / (7 * 24 * 60 * 60 * 1000))
    }
  }
}

async function loadCanvasApiWithMocks() {
  clearModule('../app/canvas/api')
  return withModuleMocks({
    'date-fns': dateFnsMock(),
    child_process: {
      ...require('node:child_process'),
      spawn: () => makeParserProcess()
    }
  }, () => require('../app/canvas/api'))
}

function makeCanvasFetch(overrides = {}) {
  return async url => {
    if (url.endsWith('/api/v1/users/self')) return makeJsonResponse({ id: 'new-user' })
    if (url.endsWith('/api/v1/courses?per_page=100')) {
      return makeJsonResponse([{ id: 101, name: 'Biology', default_view: 'modules' }])
    }
    if (url.endsWith('/api/v1/courses/101/front_page')) return makeJsonResponse({})
    if (url.endsWith('/api/v1/courses/101?include[]=syllabus_body')) return makeJsonResponse({})
    if (url.endsWith('/api/v1/courses/101/assignments?per_page=100')) {
      return makeJsonResponse([{ id: 'a1', name: 'Lab report', html_url: 'https://canvas.test/courses/101/assignments/a1' }])
    }
    if (url.endsWith('/api/v1/courses/101/files?per_page=100')) {
      return makeJsonResponse(Object.prototype.hasOwnProperty.call(overrides, 'files') ? overrides.files : [
        { id: 'f1', display_name: 'Notes.pdf', 'content-type': 'application/pdf', mime_class: 'pdf', url: 'https://canvas.test/files/f1' }
      ])
    }
    if (url.endsWith('/api/v1/courses/101/modules?per_page=100')) return makeJsonResponse([])
    throw new Error(`Unexpected Canvas fetch: ${url}`)
  }
}

test('failed Canvas sync preserves the previous complete cache', async () => {
  const { createCanvasApi } = await loadCanvasApiWithMocks()
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-canvas-fail-'))
  const canvasDataPath = path.join(rootDir, 'canvas_data.json')
  const previous = {
    profile: { id: 'old-user' },
    courses: [{ id: 999, name: 'Existing course' }],
    assignments: { 999: [{ id: 'old-assignment' }] },
    file: { 999: [{ id: 'old-file' }] },
    modules: { 999: [] },
    weekly_schedule: { 999: [{ weekLabel: 'Existing week' }] }
  }
  const previousText = JSON.stringify(previous, null, 2)
  fs.writeFileSync(canvasDataPath, previousText)

  const originalFetch = global.fetch
  global.fetch = makeCanvasFetch({ files: { malformed: true } })
  try {
    const api = createCanvasApi({
      canvasDataPath,
      rootDir,
      getAuthState: () => ({
        canvasAuthCookie: 'cookie',
        canvasAuthCsrf: 'csrf',
        canvasBaseUrl: 'https://canvas.test'
      }),
      sendCanvasDataUpdate: () => {}
    })

    await assert.rejects(api.setupCanvasData(), /forEach/)
    assert.equal(fs.readFileSync(canvasDataPath, 'utf8'), previousText)
  } finally {
    global.fetch = originalFetch
  }
})

test('successful Canvas sync writes one complete snapshot', async () => {
  const { createCanvasApi } = await loadCanvasApiWithMocks()
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-canvas-success-'))
  const canvasDataPath = path.join(rootDir, 'canvas_data.json')
  let updateCount = 0

  const originalFetch = global.fetch
  global.fetch = makeCanvasFetch()
  try {
    const api = createCanvasApi({
      canvasDataPath,
      rootDir,
      getAuthState: () => ({
        canvasAuthCookie: 'cookie',
        canvasAuthCsrf: 'csrf',
        canvasBaseUrl: 'https://canvas.test'
      }),
      sendCanvasDataUpdate: () => {
        updateCount += 1
      }
    })

    await api.setupCanvasData()
    const data = JSON.parse(fs.readFileSync(canvasDataPath, 'utf8'))
    assert.equal(data.profile.id, 'new-user')
    assert.equal(data.courses[0].id, 101)
    assert.equal(data.assignments['101'][0].name, 'Lab report')
    assert.equal(data.file['101'][0].previewurl, 'https://canvas.test/courses/101/files?preview=f1')
    assert.deepEqual(data.modules['101'], [])
    assert.ok(data.weekly_schedule)
    assert.equal(updateCount, 1)
    assert.deepEqual(fs.readdirSync(rootDir).filter(name => name.endsWith('.tmp')), [])
  } finally {
    global.fetch = originalFetch
  }
})

function loadMailApiWithMocks() {
  clearModule('../app/mail/api')
  class OAuth2 extends EventEmitter {
    generateAuthUrl() {
      return 'https://accounts.test/auth'
    }

    setCredentials(credentials) {
      this.credentials = credentials
    }

    async getToken(code) {
      if (code === 'bad') throw new Error('token exchange failed')
      return { tokens: { access_token: `token-${code}` } }
    }
  }

  return withModuleMocks({
    electron: {
      BrowserWindow: class BrowserWindow {}
    },
    googleapis: {
      google: {
        auth: { OAuth2 }
      }
    }
  }, () => require('../app/mail/api'))
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function getText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body })
      })
    }).on('error', reject)
  })
}

class FakeAuthWindow extends EventEmitter {
  constructor() {
    super()
    this.closed = false
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.emit('closed')
  }

  isDestroyed() {
    return this.closed
  }
}

test('Gmail OAuth callback rejects when auth window is closed', async () => {
  const { _test } = loadMailApiWithMocks()
  const authview = new FakeAuthWindow()
  const port = await getFreePort()
  const authPromise = _test.startCallbackServer(authview, { port })

  authview.close()
  await assert.rejects(authPromise, /closed before sign-in completed/)
})

test('Gmail OAuth callback responds to missing code instead of hanging', async () => {
  const { _test } = loadMailApiWithMocks()
  const authview = new FakeAuthWindow()
  const port = await getFreePort()
  const authPromise = _test.startCallbackServer(authview, { port })

  const response = await getText(`http://localhost:${port}/callback`)
  assert.equal(response.statusCode, 400)
  assert.match(response.body, /Missing OAuth code/)

  authview.close()
  await assert.rejects(authPromise, /closed before sign-in completed/)
})
