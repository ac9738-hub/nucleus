'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const EventEmitter = require('events')
const childProcess = require('child_process')

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-canvas-lambda-'))
}

function makeResponse(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => '' },
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

function makeParserProcess(pid) {
  const proc = new EventEmitter()
  proc.pid = pid
  proc.killed = false
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = () => {
    proc.killed = true
    process.nextTick(() => proc.emit('close', null, null))
    return true
  }
  return proc
}

test('lambda parser restarts when a later sync writes a different Canvas snapshot', async () => {
  const rootDir = tempRoot()
  const canvasDataPath = path.join(rootDir, 'canvas_data.json')
  const originalSpawn = childProcess.spawn
  const originalFetch = global.fetch
  const originalPlacement = process.env.PARSER_PLACEMENT
  const spawnCalls = []
  const spawned = []
  const profiles = [
    { id: 'self', name: 'First snapshot' },
    { id: 'self', name: 'Second snapshot' },
    { id: 'self', name: 'Second snapshot' }
  ]
  let profileIndex = 0

  childProcess.spawn = (...args) => {
    spawnCalls.push(args)
    const proc = makeParserProcess(5000 + spawnCalls.length)
    spawned.push(proc)
    return proc
  }
  global.fetch = async url => {
    const text = String(url || '')
    if (text.includes('/api/v1/users/self')) {
      const profile = profiles[Math.min(profileIndex, profiles.length - 1)]
      profileIndex += 1
      return makeResponse(profile)
    }
    if (text.includes('/api/v1/courses?')) {
      return makeResponse([])
    }
    return makeResponse({})
  }
  process.env.PARSER_PLACEMENT = 'local_download_lambda_parse'

  delete require.cache[require.resolve('../app/canvas/api')]
  const { createCanvasApi, killParserProcess } = require('../app/canvas/api')
  const api = createCanvasApi({
    canvasDataPath,
    rootDir,
    getAuthState: () => ({
      canvasAuthCookie: 'cookie',
      canvasAuthCsrf: 'csrf',
      canvasBaseUrl: 'https://canvas.example'
    }),
    sendCanvasDataUpdate: () => {},
    onCanvasTasks: () => {}
  })

  try {
    await api.setupCanvasData({ freshSync: true })
    assert.equal(spawnCalls.length, 1)

    await api.setupCanvasData()
    assert.equal(spawnCalls.length, 2, 'new Canvas snapshot should start a fresh Lambda parse')
    assert.equal(spawned[0].killed, true, 'stale Lambda parser should be killed before restart')

    await new Promise(resolve => setImmediate(resolve))
    await api.setupCanvasData()
    assert.equal(
      spawnCalls.length,
      2,
      'close event from stale parser must not clear the active parser for the same snapshot'
    )
  } finally {
    killParserProcess()
    childProcess.spawn = originalSpawn
    global.fetch = originalFetch
    if (originalPlacement == null) {
      delete process.env.PARSER_PLACEMENT
    } else {
      process.env.PARSER_PLACEMENT = originalPlacement
    }
  }
})
