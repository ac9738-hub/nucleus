'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawnSync } = require('child_process')

const {
  createCanvasApi,
  beginCanvasSyncWipe,
  endCanvasSyncWipe,
  setParserBatchGate
} = require('../app/canvas/api')
const { createDataStore } = require('../data-store')

test('beginCanvasSyncWipe/endCanvasSyncWipe are exported helpers', () => {
  setParserBatchGate({
    canSend: () => false,
    onQueueChange: () => {}
  })
  beginCanvasSyncWipe()
  beginCanvasSyncWipe()
  endCanvasSyncWipe()
  endCanvasSyncWipe()
  setParserBatchGate({
    canSend: () => true,
    onQueueChange: () => {}
  })
})

test('sendCanvasDataUpdate with canvasWiped sends empty canvas snapshot', () => {
  const messages = []
  const store = createDataStore({
    sendToRenderer: (channel, payload) => messages.push({ channel, payload }),
    getCanvasProjectGroups: () => [{ id: 'canvas-1', label: 'Canvas', items: [] }],
    readCanvasData: () => ({ courses: [{ id: 1, name: 'Stale course' }] })
  })

  store.newTask('Canvas task', 1, 'canvas-task-1', 'nucleus', 'BIO 101', '', 'No due date', '', '#000', [], { source: 'canvas' })
  store.removeCanvasTasks()
  store.sendCanvasDataUpdate({ canvasWiped: true })

  const update = messages.find(entry => entry.channel === 'canvas:update')
  assert.ok(update)
  assert.equal(update.payload.canvasWiped, true)
  assert.deepEqual(update.payload.canvasData, {})
  assert.ok(Array.isArray(update.payload.projectGroups))
  assert.equal(update.payload.projectGroups.some(group => String(group.id || '').startsWith('canvas-')), false)
  assert.equal(update.payload.tasks.some(task => task.source === 'canvas'), false)
})

test('clearCanvasSyncData removes graph sidecar and pdf cache dirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-wipe-'))
  const graphPath = path.join(root, 'canvas_graph.json')
  const sidecarPath = path.join(root, 'canvas_graph_tasks.json')
  const pdfCachePath = path.join(root, '.cache', 'pdf_extract')
  fs.writeFileSync(graphPath, '{}')
  fs.writeFileSync(sidecarPath, '[]')
  fs.mkdirSync(pdfCachePath, { recursive: true })
  fs.writeFileSync(path.join(pdfCachePath, 'sample.json'), '{}')

  const script = `
    const fs = require('fs')
    const path = require('path')
    const relativePaths = [
      'canvas_graph.json',
      'canvas_graph_tasks.json',
      path.join('.cache', 'pdf_extract')
    ]
    relativePaths.forEach(relativePath => {
      const fullPath = path.join(process.argv[1], relativePath)
      if (!fs.existsSync(fullPath)) return
      if (fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(fullPath)
      }
    })
  `
  const proc = spawnSync(process.execPath, ['-e', script, root], { encoding: 'utf8' })
  assert.equal(proc.status, 0, proc.stderr || proc.stdout)

  assert.equal(fs.existsSync(graphPath), false)
  assert.equal(fs.existsSync(sidecarPath), false)
  assert.equal(fs.existsSync(pdfCachePath), false)
})

test('Canvas sync started before wipe cannot repopulate Canvas data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-wipe-race-'))
  const canvasDataPath = path.join(root, 'canvas_data.json')
  const originalFetch = global.fetch
  let releaseCourses
  const messages = []

  function response(body) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => '' },
      json: async () => body,
      text: async () => JSON.stringify(body)
    }
  }

  global.fetch = async url => {
    const value = String(url)
    if (value.includes('/api/v1/users/self')) {
      return response({ id: 1, name: 'Canvas User' })
    }
    if (value.includes('/api/v1/courses?')) {
      return new Promise(resolve => {
        releaseCourses = () => resolve(response([]))
      })
    }
    throw new Error(`Unexpected Canvas fetch: ${value}`)
  }

  try {
    const api = createCanvasApi({
      canvasDataPath,
      rootDir: root,
      getAuthState: () => ({
        canvasAuthCookie: 'cookie=value',
        canvasAuthCsrf: '',
        canvasBaseUrl: 'https://canvas.example.edu'
      }),
      sendCanvasDataUpdate: () => messages.push('canvas:update'),
      onCanvasTasks: () => {}
    })

    const setup = api.setupCanvasData().then(
      () => ({ ok: true }),
      error => ({ ok: false, error })
    )

    while (!releaseCourses) {
      await new Promise(resolve => setImmediate(resolve))
    }

    beginCanvasSyncWipe()
    endCanvasSyncWipe()
    releaseCourses()

    const result = await setup
    assert.equal(result.ok, false)
    assert.match(String(result.error && result.error.message || result.error), /wiped/i)
    assert.equal(messages.length, 0)
    assert.equal(fs.readFileSync(canvasDataPath, 'utf8'), '')
  } finally {
    global.fetch = originalFetch
  }
})
