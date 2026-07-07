'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createCanvasPreloadSlotPool, SLOT_STATES } = require('../../lib/canvas-preload-slot-pool')

function mockView(url = 'https://canvas.example/courses/1') {
  return {
    webContents: {
      isDestroyed: () => false,
      getURL: () => url
    }
  }
}

test('slot pool findByUrl matches ready slot', () => {
  const pool = createCanvasPreloadSlotPool({ slotCount: 3 })
  const view = mockView('https://canvas.example/courses/1/assignments/2')
  pool.initSlot(0, view)
  pool.markReady(0, 'https://canvas.example/courses/1/assignments/2')

  const found = pool.findByUrl('https://canvas.example/courses/1/assignments/2')
  assert.ok(found)
  assert.equal(found.index, 0)
  assert.equal(found.view, view)
})

test('slot pool findByUrl matches loading slot when includeLoading', () => {
  const pool = createCanvasPreloadSlotPool({ slotCount: 3 })
  const view = mockView('about:blank')
  pool.initSlot(0, view)
  pool.assignLoading(0, 'https://canvas.example/courses/1/pages/week-2', 'tab-a', 1)

  assert.equal(pool.findByUrl('https://canvas.example/courses/1/pages/week-2', null, { includeLoading: false }), null)
  const found = pool.findByUrl('https://canvas.example/courses/1/pages/week-2', null, { includeLoading: true })
  assert.ok(found)
  assert.equal(found.state, SLOT_STATES.LOADING)
})

test('takeViewFromSlot clears slot and recycleView stores main view', () => {
  const pool = createCanvasPreloadSlotPool({ slotCount: 3 })
  const preloadView = mockView('https://canvas.example/courses/1/pages/week-2')
  const mainView = mockView('https://canvas.example/courses/1/pages/week-1')

  pool.initSlot(0, preloadView)
  pool.markReady(0, 'https://canvas.example/courses/1/pages/week-2')

  const taken = pool.takeViewFromSlot({ index: 0 })
  assert.equal(taken, preloadView)
  assert.equal(pool.getSlot(0).state, SLOT_STATES.IDLE)

  const recycled = pool.recycleView(mainView, 'https://canvas.example/courses/1/pages/week-1', 'tab-a')
  assert.ok(recycled)
  assert.equal(recycled.index, 0)
  assert.equal(pool.getSlot(0).view, mainView)
  assert.equal(pool.getSlot(0).state, SLOT_STATES.READY)
})

test('pickSlotForLoad prefers idle slot over stale ready url', () => {
  const pool = createCanvasPreloadSlotPool({ slotCount: 3 })
  pool.initSlot(0, mockView('https://canvas.example/a'))
  pool.markReady(0, 'https://canvas.example/a')
  pool.initSlot(1, mockView('about:blank'))

  const index = pool.pickSlotForLoad(['https://canvas.example/b'])
  assert.equal(index, 1)
})

test('pickSlotForLoad keeps protected immediate-back url', () => {
  const pool = createCanvasPreloadSlotPool({ slotCount: 3 })
  pool.initSlot(0, mockView('https://canvas.example/back'))
  pool.markReady(0, 'https://canvas.example/back')
  pool.initSlot(1, mockView('about:blank'))

  const index = pool.pickSlotForLoad(
    ['https://canvas.example/forward'],
    { protectedUrls: ['https://canvas.example/back'] }
  )
  assert.equal(index, 1)
})

test('cancelForTab aborts in-flight loading slot', () => {
  const pool = createCanvasPreloadSlotPool({ slotCount: 3 })
  pool.initSlot(0, mockView('about:blank'))
  pool.assignLoading(0, 'https://canvas.example/loading', 'tab-a', 7)
  pool.cancelForTab('tab-a')
  assert.equal(pool.getSlot(0).state, SLOT_STATES.IDLE)
})

test('assignLoading stores loadReason on slot', () => {
  const pool = createCanvasPreloadSlotPool({ slotCount: 3 })
  pool.initSlot(0, mockView('about:blank'))
  pool.assignLoading(0, 'https://canvas.example/target', 'tab-a', 3, 'link_mousedown')
  const found = pool.findByUrl('https://canvas.example/target', null, { includeLoading: true })
  assert.equal(found.loadReason, 'link_mousedown')
})
