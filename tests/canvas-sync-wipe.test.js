'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawnSync } = require('child_process')

const {
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
