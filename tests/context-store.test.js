const test = require('node:test')
const assert = require('node:assert/strict')
const { createContextStore, SCHEMA_VERSION, SLICE_NAMES } = require('../context-store')

test('context store initializes all slices with schema version 1', () => {
  const store = createContextStore()
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.schemaVersion, SCHEMA_VERSION)
  for (const name of SLICE_NAMES) {
    assert.ok(Object.prototype.hasOwnProperty.call(snapshot, name))
    assert.equal(typeof snapshot.versions[name], 'number')
  }
})

test('context store update is a no-op when slice value is unchanged', () => {
  const store = createContextStore()
  const before = store.getVersions()
  const changed = store.update('app', {
    top: 'section',
    activeSection: 'home',
    activeWorkspaceId: null
  })
  const after = store.getVersions()
  assert.equal(changed, false)
  assert.deepEqual(before, after)
})

test('context store update bumps only the changed slice version', () => {
  const store = createContextStore()
  const before = store.getVersions().screen
  store.update('screen', {
    source: 'renderer-dom',
    surfaceKind: 'mail',
    url: '',
    title: 'Inbox',
    scroll: { y: 0, ratio: 0, viewportHeight: 800, contentHeight: 1600 },
    text: [{ tag: 'p', text: 'Hello', y: 0, x: 0 }],
    canvas: null,
    truncated: false,
    charCount: 5
  })
  assert.equal(store.getVersions().screen, before + 1)
  assert.equal(store.getVersions().app, 0)
})

test('context store onChange fires only for changed slices', () => {
  const store = createContextStore()
  const seen = []
  store.onChange(name => seen.push(name))
  store.update('layout', { workspaceSidebarCollapsed: true, aiPanel: { width: 340, minimized: false } })
  store.update('layout', { workspaceSidebarCollapsed: true, aiPanel: { width: 340, minimized: false } })
  assert.deepEqual(seen, ['layout'])
})
