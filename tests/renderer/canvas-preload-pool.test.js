'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createCanvasPreloadPool } = require('../../lib/canvas-preload-pool')

test('shared pool reuses view across tabs via ref counts', () => {
  const pool = createCanvasPreloadPool()
  const view = { webContents: { isDestroyed: () => false, getURL: () => 'https://canvas.example/courses/1' } }
  const url = 'https://canvas.example/courses/1/assignments/2'

  pool.register('tab-a', url, view)
  pool.register('tab-b', url, view)

  const found = pool.findEntry(url)
  assert.equal(found.view, view)
  assert.equal(pool.size(), 1)

  pool.releaseTab('tab-a', { isViewInUse: () => false })
  assert.equal(pool.size(), 1)
  assert.ok(pool.findEntry(url))

  pool.releaseTab('tab-b', {
    releaseView: released => assert.equal(released, view),
    isViewInUse: () => false
  })
  assert.equal(pool.size(), 0)
})

test('releaseTab keeps view when still active on a tab', () => {
  const pool = createCanvasPreloadPool()
  const view = { webContents: { isDestroyed: () => false, getURL: () => 'https://canvas.example/courses/1' } }
  const url = 'https://canvas.example/courses/1/files/9'

  pool.register('tab-a', url, view)
  let released = false
  pool.releaseTab('tab-a', {
    releaseView: () => { released = true },
    isViewInUse: v => v === view
  })

  assert.equal(released, false)
  assert.equal(pool.size(), 0)
})

test('detachTab removes one tab ref without evicting shared view', () => {
  const pool = createCanvasPreloadPool()
  const view = { webContents: { isDestroyed: () => false, getURL: () => 'https://canvas.example/courses/2' } }
  const url = 'https://canvas.example/courses/2/pages/week-3'

  pool.register('tab-a', url, view)
  pool.register('tab-b', url, view)
  pool.detachTab('tab-a', url, view)

  assert.equal(pool.size(), 1)
  assert.deepEqual(pool.getForTab('tab-a'), [])
  assert.equal(pool.getForTab('tab-b').length, 1)
})
