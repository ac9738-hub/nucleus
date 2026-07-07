'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')

function loadApplyTabViewState(harness, stateOverrides = {}) {
  const swallowDomReady = (target) => {
    const orig = target.addEventListener.bind(target)
    target.addEventListener = (type, fn, ...args) => {
      if (type === 'DOMContentLoaded') return
      return orig(type, fn, ...args)
    }
  }
  swallowDomReady(harness.document)
  swallowDomReady(harness.window)

  harness.window.nucleus = {
    on() { return () => {} },
    getData: async () => ({ tasks: [], workspaces: [] })
  }
  harness.runScript('renderer/workspace-page-tabs.js')
  harness.context.paintActiveView = () => {
    harness.context.paintCalls = (harness.context.paintCalls || 0) + 1
  }
  harness.context.patchWorkspacePageTabs = () => {
    harness.context.patchCalls = (harness.context.patchCalls || 0) + 1
  }
  harness.context.scheduleRenderWorkspacePageTabs = () => {
    harness.context.scheduleCalls = (harness.context.scheduleCalls || 0) + 1
  }
  harness.context.renderBrowserToolbar = () => {}
  harness.context.renderCanvasToolbar = () => {}
  harness.runScript('renderer/render.js')
  Object.assign(harness.context.state, stateOverrides)
}

test('applyTabViewState keeps loading true until main sends loading false', () => {
  const tabState = {
    top: 'workspace',
    activeWorkspaceId: 'nucleus',
    activeTabId: 'canvas:nucleus',
    tabs: [{
      id: 'canvas:nucleus',
      type: 'canvastab',
      workspaceId: 'nucleus',
      canvasMode: 'browser',
      url: 'https://canvas.example/courses/1',
      loading: true
    }]
  }
  const harness = createHarness({ state: tabState })
  loadApplyTabViewState(harness, tabState)
  const tab = harness.context.state.tabs[0]

  harness.context.applyTabViewState({
    id: 'canvas:nucleus',
    tier: 'active',
    discarded: false,
    loading: true
  })

  assert.equal(tab.loading, true)
})

test('applyTabViewState clears loading only when payload.loading is false', () => {
  const tabState = {
    top: 'workspace',
    activeWorkspaceId: 'nucleus',
    activeTabId: 'canvas:nucleus',
    tabs: [{
      id: 'canvas:nucleus',
      type: 'canvastab',
      workspaceId: 'nucleus',
      canvasMode: 'browser',
      url: 'https://canvas.example/courses/1',
      loading: true
    }]
  }
  const harness = createHarness({ state: tabState })
  loadApplyTabViewState(harness, tabState)
  const tab = harness.context.state.tabs[0]

  harness.context.applyTabViewState({
    id: 'canvas:nucleus',
    tier: 'active',
    discarded: false,
    loading: false
  })

  assert.equal(tab.loading, false)
})

test('applyTabViewState holds snapshot overlay when loading clears on canvas browser tab', () => {
  const tabState = {
    top: 'workspace',
    activeWorkspaceId: 'nucleus',
    activeTabId: 'canvas:nucleus',
    tabs: [{
      id: 'canvas:nucleus',
      type: 'canvastab',
      workspaceId: 'nucleus',
      canvasMode: 'browser',
      url: 'https://canvas.example/courses/1',
      loading: true,
      snapshotDataUrl: 'data:image/png;base64,abc'
    }]
  }
  const harness = createHarness({ state: tabState })
  loadApplyTabViewState(harness, tabState)
  const tab = harness.context.state.tabs[0]

  harness.context.applyTabViewState({
    id: 'canvas:nucleus',
    tier: 'active',
    discarded: false,
    loading: false
  })

  assert.equal(tab.loading, false)
  const overlay = harness.window.__nucleusTabSnapshot.get()
  assert.equal(overlay.visible, true)
  assert.equal(overlay.tabId, 'canvas:nucleus')
  assert.equal(overlay.snapshotDataUrl, 'data:image/png;base64,abc')
})

test('applyTabViewState skips repaint when payload is a no-op', () => {
  const tabState = {
    top: 'workspace',
    activeWorkspaceId: 'nucleus',
    activeTabId: 'canvas:nucleus',
    tabs: [{
      id: 'canvas:nucleus',
      type: 'canvastab',
      workspaceId: 'nucleus',
      canvasMode: 'browser',
      url: 'https://canvas.example/courses/1',
      loading: true,
      viewTier: 'active',
      discarded: false
    }]
  }
  const harness = createHarness({ state: tabState })
  loadApplyTabViewState(harness, tabState)
  harness.context.paintCalls = 0
  harness.context.patchCalls = 0

  harness.context.applyTabViewState({
    id: 'canvas:nucleus',
    tier: 'active',
    discarded: false,
    loading: true
  })

  assert.equal(harness.context.paintCalls, 0)
  assert.equal(harness.context.patchCalls, 0)
})

test('switchWorkspaceTab sets loading true for web content tabs', () => {
  const harness = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: 'center:nucleus',
      activeTabByWorkspace: { nucleus: 'center:nucleus' },
      tabs: [
        { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
        {
          id: 'canvas:nucleus',
          type: 'canvastab',
          workspaceId: 'nucleus',
          canvasMode: 'browser',
          url: 'https://canvas.example/courses/1'
        }
      ]
    }
  })
  harness.loadRendererCore()
  const ctx = harness.context
  ctx.revealActiveTabSurface = async () => ({ ok: true })
  ctx.syncTabs = async () => ({ ok: true })
  ctx.renderWorkspaceViewPartial = () => {}
  ctx.paintActiveView = () => {}
  ctx.beginPendingViewTransition = () => null
  ctx.demoteSiblingWebTabViewTiers = () => {}
  ctx.rememberActiveCanvasYIndex = () => {}
  ctx.syncRenderContext = () => {}

  ctx.switchWorkspaceTab('canvas:nucleus')
  const tab = ctx.state.tabs.find(item => item.id === 'canvas:nucleus')
  assert.equal(tab.loading, true)
})
