const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')

function loadTabs(harness) {
  harness.loadRendererCore()
  return harness.context
}

test('sameTabId compares ids as strings', () => {
  const ctx = loadTabs(createHarness())
  assert.equal(ctx.sameTabId(1, '1'), true)
  assert.equal(ctx.sameTabId('abc', 'def'), false)
})

test('isWebContentTab covers browser and canvas browser tabs', () => {
  const ctx = loadTabs(createHarness())
  assert.equal(ctx.isWebContentTab({ type: 'browsertab' }), true)
  assert.equal(ctx.isWebContentTab({ type: 'canvastab', canvasMode: 'browser' }), true)
  assert.equal(ctx.isWebContentTab({ type: 'canvastab', canvasMode: 'native' }), false)
})

test('isNativeAppTab covers mail synapse canvas native and artifacts', () => {
  const ctx = loadTabs(createHarness())
  assert.equal(ctx.isNativeAppTab({ type: 'mailtab' }), true)
  assert.equal(ctx.isNativeAppTab({ type: 'synapsetab' }), true)
  assert.equal(ctx.isNativeAppTab({ type: 'canvastab', canvasMode: 'native' }), true)
  assert.equal(ctx.isNativeAppTab({ type: 'artifacttab' }), true)
  assert.equal(ctx.isNativeAppTab({ type: 'browsertab' }), false)
})

test('isCanvasUrl detects instructure hosts and course paths', () => {
  const ctx = loadTabs(createHarness())
  assert.equal(ctx.isCanvasUrl('https://canvas.harvard.edu/courses/123'), true)
  assert.equal(ctx.isCanvasUrl('https://example.com/courses/123'), false)
  assert.equal(ctx.isCanvasUrl(''), false)
})

test('ensureWorkspaceCenter creates a center tab when missing', () => {
  const harness = createHarness()
  const ctx = loadTabs(harness)
  ctx.state.tabs = []
  const tabId = ctx.ensureWorkspaceCenter('biology')
  assert.equal(tabId, 'center:biology')
  assert.equal(ctx.state.tabs.length, 1)
  assert.equal(ctx.state.tabs[0].type, 'center')
})

test('closeTab removes tab and selects neighbor when active tab closes', () => {
  const harness = createHarness()
  const ctx = loadTabs(harness)
  ctx.state.top = 'workspace'
  ctx.state.activeWorkspaceId = 'nucleus'
  ctx.state.tabs = [
    { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
    { id: 'mail:nucleus', type: 'mailtab', workspaceId: 'nucleus', label: 'Mail' },
    { id: 'synapse:nucleus', type: 'synapsetab', workspaceId: 'nucleus', label: 'Synapse' }
  ]
  ctx.state.activeTabId = 'mail:nucleus'
  ctx.render = () => {}
  ctx.closeTab('mail:nucleus')
  assert.equal(ctx.state.tabs.length, 2)
  assert.notEqual(ctx.state.activeTabId, 'mail:nucleus')
})

test('getVisibleTabs filters by active workspace', () => {
  const harness = createHarness()
  const ctx = loadTabs(harness)
  ctx.state.activeWorkspaceId = 'nucleus'
  ctx.state.tabs = [
    { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus' },
    { id: 'center:biology', type: 'center', workspaceId: 'biology' }
  ]
  const visible = ctx.getVisibleTabs()
  assert.equal(visible.length, 1)
  assert.equal(visible[0].workspaceId, 'nucleus')
})

test('buildTabPushFingerprint changes when tab url updates', () => {
  const harness = createHarness()
  const ctx = loadTabs(harness)
  ctx.state.tabs = [{ id: 'tab-1', type: 'browsertab', workspaceId: 'nucleus', url: 'https://a.example' }]
  const before = ctx.buildTabPushFingerprint()
  ctx.state.tabs[0].url = 'https://b.example'
  const after = ctx.buildTabPushFingerprint()
  assert.notEqual(before, after)
})

test('queueTabSyncAfterRender always syncs active tab even when push is unchanged', async () => {
  const harness = createHarness()
  const ctx = loadTabs(harness)
  let activeSyncs = 0
  ctx.syncTabs = async () => ({ ok: true, skipped: true, reason: 'unchanged' })
  ctx.syncActiveTab = async () => {
    activeSyncs += 1
    return { ok: true }
  }
  ctx.queueTabSyncAfterRender()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(activeSyncs, 1)
})
