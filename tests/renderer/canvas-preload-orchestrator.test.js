'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildPredictivePreloadUrls,
  collectProtectedPreloadUrls,
  normalizePointerHints,
  shouldPreloadCanvasUrl,
  CANVAS_PREDICTIVE_SLOT_COUNT
} = require('../../lib/canvas-preload-orchestrator')
const { createCanvasPreloadSlotPool } = require('../../lib/canvas-preload-slot-pool')

test('buildPredictivePreloadUrls prioritizes mousedown explicit urls', () => {
  const urls = buildPredictivePreloadUrls({}, {
    limit: CANVAS_PREDICTIVE_SLOT_COUNT,
    activeUrl: 'https://canvas.example/courses/1',
    explicitUrls: ['https://canvas.example/courses/1/assignments/99'],
    domLinks: [],
    pointerHints: [],
    focusCourseIds: ['1']
  })
  assert.equal(urls[0], 'https://canvas.example/courses/1/assignments/99')
  assert.ok(urls.length <= CANVAS_PREDICTIVE_SLOT_COUNT)
})

test('normalizePointerHints dedupes and preserves combined score', () => {
  const hints = normalizePointerHints([
    { url: 'https://canvas.example/courses/1/assignments/5', combined: 0.8 },
    { url: 'https://canvas.example/courses/1/assignments/5', combined: 0.2 }
  ])
  assert.equal(hints.length, 1)
  assert.equal(hints[0].combined, 0.8)
})

test('collectProtectedPreloadUrls includes parent web entry and back cache slot', () => {
  const tab = { id: 'tab-a', url: 'https://canvas.example/current' }
  const protectedUrls = collectProtectedPreloadUrls(tab, {
    parentEntry: { kind: 'web', url: 'https://canvas.example/previous' },
    backSlot: {
      role: 'back_cache',
      url: 'https://canvas.example/previous'
    }
  })
  assert.ok(protectedUrls.includes('https://canvas.example/current'))
  assert.ok(protectedUrls.includes('https://canvas.example/previous'))
})

test('shouldPreloadCanvasUrl skips active and cached slot urls', () => {
  const active = 'https://canvas.example/courses/1/assignments/10'
  const candidate = 'https://canvas.example/courses/1/assignments/20'
  assert.equal(
    shouldPreloadCanvasUrl(active, { activeUrl: active, cachedSlotUrls: [candidate] }),
    false
  )
  assert.equal(
    shouldPreloadCanvasUrl(candidate, {
      activeUrl: active,
      cachedSlotUrls: [candidate],
      urlsMatch: (left, right) => left === right
    }),
    false
  )
  assert.equal(
    shouldPreloadCanvasUrl('https://canvas.example/courses/1/assignments/30', { activeUrl: active }),
    true
  )
})

test('buildPredictivePreloadUrls drops homepage and community links', () => {
  const urls = buildPredictivePreloadUrls({}, {
    limit: CANVAS_PREDICTIVE_SLOT_COUNT,
    activeUrl: 'https://canvas.example/courses/1/assignments/10',
    explicitUrls: [
      'https://canvas.example/courses/1',
      'https://community.canvaslms.com/t5/Student-Guide/id/1',
      'https://canvas.example/courses/1/assignments/99'
    ],
    cachedSlotUrls: ['https://canvas.example/courses/1/assignments/99']
  })
  assert.deepEqual(urls, [])
})

test('back_cache slot is excluded from predictive pickSlotForLoad', () => {
  const pool = createCanvasPreloadSlotPool({ slotCount: 3 })
  const backView = { webContents: { isDestroyed: () => false, getURL: () => 'https://canvas.example/back' } }
  const predictiveView = { webContents: { isDestroyed: () => false, getURL: () => 'about:blank' } }

  pool.initSlot(0, backView)
  pool.recycleView(backView, 'https://canvas.example/back', 'tab-a', { role: 'back_cache', backCacheIndex: 0 })
  pool.initSlot(1, predictiveView)

  const index = pool.pickSlotForLoad(['https://canvas.example/forward'])
  assert.equal(index, 1)
})
