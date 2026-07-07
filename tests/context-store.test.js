const test = require('node:test')
const assert = require('node:assert/strict')
const { createContextStore, SCHEMA_VERSION, SLICE_NAMES } = require('../context-store')

test('context store initializes all slices with schema version 2', () => {
  const store = createContextStore()
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.schemaVersion, SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, 2)
  for (const name of SLICE_NAMES) {
    assert.ok(Object.prototype.hasOwnProperty.call(snapshot, name), `missing slice ${name}`)
    assert.equal(typeof snapshot.versions[name], 'number')
  }
  assert.ok(Array.isArray(snapshot.index.courses))
  assert.ok(Array.isArray(snapshot.index.tasks))
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

test('context store onChange fires only for changed slices', () => {
  const store = createContextStore()
  const seen = []
  store.onChange(name => seen.push(name))
  store.update('layout', { workspaceSidebarCollapsed: true, aiPanel: { width: 340, minimized: false } })
  store.update('layout', { workspaceSidebarCollapsed: true, aiPanel: { width: 340, minimized: false } })
  assert.deepEqual(seen, ['layout'])
})
