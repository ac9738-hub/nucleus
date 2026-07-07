'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')

function buildTabState() {
  return {
    top: 'workspace',
    activeWorkspaceId: 'nucleus',
    activeTabId: 'center:nucleus',
    activeTabByWorkspace: { nucleus: 'center:nucleus' },
    tabs: [
      { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
      { id: 'mail:nucleus', type: 'mailtab', workspaceId: 'nucleus', label: 'Mail' },
      { id: 'browser:1', type: 'browsertab', workspaceId: 'nucleus', label: 'Engine', url: 'nucleus://search' }
    ]
  }
}

function stubFastPipeline(ctx) {
  ctx.renderWorkspaceSidebarCollapseState = () => {}
  ctx.renderPrimaryTabs = () => {}
  ctx.renderWorkspaceTabs = () => {}
  ctx.updateWorkspacePageTabs = () => {}
  ctx.renderBrowserToolbar = () => {}
  ctx.renderCanvasToolbar = () => {}
  ctx.syncRenderContext = () => {}
  ctx.demoteSiblingWebTabViewTiers = () => {}
  ctx.syncTabs = async () => ({ ok: true })
}

test('race 1: stale deferred sync cannot win after rapid tab switches', async () => {
  const harness = createHarness({ state: buildTabState() })
  harness.loadRendererCore()
  const ctx = harness.context
  stubFastPipeline(ctx)

  const syncStarts = []
  ctx.syncActiveTab = () => new Promise(resolve => {
    const tabIdAtCall = ctx.state.activeTabId
    syncStarts.push(tabIdAtCall)
    setTimeout(() => resolve({ ok: true, tabIdAtCall }), 35)
  })

  ctx.switchWorkspaceTab('mail:nucleus')
  ctx.switchWorkspaceTab('browser:1')
  ctx.switchWorkspaceTab('center:nucleus')
  await new Promise(resolve => setTimeout(resolve, 120))

  assert.equal(ctx.state.activeTabId, 'center:nucleus')
  assert.equal(syncStarts[syncStarts.length - 1], 'center:nucleus')
})

test('race 2: superseded workspace surface generation is ignored', async () => {
  const harness = createHarness({ state: buildTabState() })
  harness.loadRendererCore()
  const ctx = harness.context

  let syncCalls = 0
  ctx.syncTabs = async () => {
    await new Promise(resolve => setTimeout(resolve, 25))
    return { ok: true }
  }
  ctx.syncActiveTab = async () => {
    syncCalls += 1
    await new Promise(resolve => setTimeout(resolve, 25))
    return { ok: true }
  }

  const staleGen = ctx.bumpTabSurfaceSyncGeneration()
  ctx.state.activeTabId = 'mail:nucleus'
  ctx.deferWorkspaceSurfaceSync(staleGen)

  const currentGen = ctx.bumpTabSurfaceSyncGeneration()
  ctx.state.activeTabId = 'center:nucleus'
  ctx.deferWorkspaceSurfaceSync(currentGen)

  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(ctx.isTabSurfaceSyncCurrent(staleGen), false)
  assert.equal(ctx.isTabSurfaceSyncCurrent(currentGen), true)
  assert.equal(ctx.state.activeTabId, 'center:nucleus')
  assert.ok(syncCalls >= 1)
})

test('race 3: fast tab switch paint keeps latest tab content visible', async () => {
  const harness = createHarness({ state: buildTabState() })
  harness.loadRendererCore()
  const ctx = harness.context
  stubFastPipeline(ctx)
  ctx.syncActiveTab = async () => ({ ok: true })

  ctx.switchWorkspaceTab('mail:nucleus')
  ctx.switchWorkspaceTab('browser:1')
  ctx.switchWorkspaceTab('center:nucleus')

  const view = harness.document.getElementById('view')
  assert.ok(view)
  assert.match(view.textContent, /Control Center/)
  assert.equal(view.querySelector('.view-transition-layer'), null)
})
