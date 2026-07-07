'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createCanvasNavStackStore,
  navEntriesEqual,
  snapshotNativeEntry,
  snapshotNativeFromForward,
  snapshotWebEntry
} = require('../../lib/canvas-nav-stack')

test('canvas nav stack push dedupes consecutive identical entries', () => {
  const store = createCanvasNavStackStore()
  const web = { kind: 'web', url: 'https://canvas.example/courses/1/pages/a' }
  assert.equal(store.push('tab-1', web), true)
  assert.equal(store.push('tab-1', { ...web }), false)
  assert.equal(store.size('tab-1'), 1)
})

test('canvas nav stack pop returns entries in LIFO order', () => {
  const store = createCanvasNavStackStore()
  store.push('tab-1', { kind: 'native', page: 'dashboard', courseId: null, courseSection: 'homepage', yindex: 0 })
  store.push('tab-1', { kind: 'web', url: 'https://canvas.example/courses/1/assignments/2' })
  assert.equal(store.pop('tab-1').kind, 'web')
  assert.equal(store.pop('tab-1').kind, 'native')
  assert.equal(store.pop('tab-1'), null)
})

test('snapshot helpers build native and web entries', () => {
  assert.deepEqual(
    snapshotNativeEntry({
      canvasNativePage: 'course',
      courseId: '100',
      courseSection: 'weekly',
      yindex: 42
    }),
    {
      kind: 'native',
      page: 'course',
      courseId: '100',
      courseSection: 'weekly',
      yindex: 42
    }
  )
  assert.deepEqual(
    snapshotWebEntry('https://canvas.example/courses/1/pages/week-1', url => url),
    { kind: 'web', url: 'https://canvas.example/courses/1/pages/week-1' }
  )
})

test('snapshotNativeFromForward builds native entries from navForwardFrom payload', () => {
  assert.deepEqual(
    snapshotNativeFromForward({
      kind: 'native',
      page: 'course',
      courseId: '15222',
      courseSection: 'weekly',
      yindex: 12
    }),
    {
      kind: 'native',
      page: 'course',
      courseId: '15222',
      courseSection: 'weekly',
      yindex: 12
    }
  )
})

test('canvas nav stack peekParent returns entry below top', () => {
  const store = createCanvasNavStackStore()
  store.push('tab-1', { kind: 'native', page: 'dashboard', courseId: null, courseSection: 'homepage', yindex: 0 })
  store.push('tab-1', { kind: 'web', url: 'https://canvas.example/courses/1/assignments/2' })
  assert.equal(store.peekParent('tab-1').kind, 'native')
  assert.equal(store.peek('tab-1').kind, 'web')
  assert.equal(store.peekParent('tab-2'), null)
})

test('navEntriesEqual matches web urls via matcher', () => {
  const left = { kind: 'web', url: 'https://canvas.example/courses/1/files/5?wrap=1' }
  const right = { kind: 'web', url: 'https://canvas.example/courses/1/files/5' }
  assert.equal(
    navEntriesEqual(left, right, (a, b) => a.replace('?wrap=1', '') === b),
    true
  )
})
