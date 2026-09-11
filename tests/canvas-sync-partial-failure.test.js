'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createCanvasApi } = require('../app/canvas/api')

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Internal Server Error',
    headers: { get: () => null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  }
}

test('Canvas sync aborts without overwriting cache when a required bucket fetch fails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-canvas-partial-'))
  const canvasDataPath = path.join(root, 'canvas_data.json')
  const previous = {
    courses: [{ id: 999, name: 'Previously synced course' }],
    assignments: { 999: [{ id: 1, name: 'Existing assignment' }] }
  }
  fs.writeFileSync(canvasDataPath, JSON.stringify(previous), 'utf8')

  const originalFetch = global.fetch
  global.fetch = async urlValue => {
    const url = String(urlValue)
    if (url.includes('/api/v1/users/self')) {
      return jsonResponse({ id: 'student' })
    }
    if (url.includes('/api/v1/courses?')) {
      return jsonResponse([{
        id: 101,
        name: 'Partially failing course',
        workflow_state: 'available',
        default_view: 'modules'
      }])
    }
    if (url.includes('/api/v1/courses/101?include[]=syllabus_body')) {
      return jsonResponse({ id: 101, name: 'Partially failing course', syllabus_body: '' })
    }
    if (url.includes('/api/v1/courses/101/assignments')) {
      return jsonResponse('temporary assignments failure', 500)
    }
    if (
      url.includes('/api/v1/courses/101/files')
      || url.includes('/api/v1/courses/101/pages')
      || url.includes('/api/v1/courses/101/modules')
    ) {
      return jsonResponse([])
    }
    return jsonResponse([])
  }

  const api = createCanvasApi({
    canvasDataPath,
    rootDir: root,
    getAuthState: () => ({
      canvasAuthCookie: 'canvas-cookie',
      canvasAuthCsrf: '',
      canvasBaseUrl: 'https://canvas.example.edu'
    }),
    sendCanvasDataUpdate: () => {
      throw new Error('cache update should not be sent after an aborted sync')
    },
    onCanvasTasks: () => {
      throw new Error('parser task refresh should not run after an aborted sync')
    }
  })

  try {
    await assert.rejects(
      () => api.setupCanvasData({ freshSync: true }),
      /Canvas sync aborted before overwriting local data/
    )
    assert.deepEqual(JSON.parse(fs.readFileSync(canvasDataPath, 'utf8')), previous)
    assert.equal(fs.existsSync(path.join(root, 'canvas_graph.json')), false)
  } finally {
    global.fetch = originalFetch
    fs.rmSync(root, { recursive: true, force: true })
  }
})
