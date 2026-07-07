'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { performance } = require('node:perf_hooks')
const { createAppFork } = require('./harness')
const { assertScreenCoherent } = require('../../lib/app-fork/screen-state')
const { sampleCanvasData } = require('../renderer/fixtures')

test('integration: multi-surface switch sequence preserves final screen', async () => {
  const fork = createAppFork({
    harnessOptions: { canvasData: sampleCanvasData() }
  })
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)
  ctx.syncActiveTab = async () => ({ ok: true })

  const sequence = [
    'mail:nucleus',
    'browser:1',
    'canvas:nucleus',
    'center:nucleus',
    'canvas:nucleus',
    'mail:nucleus'
  ]

  const started = performance.now()
  for (const tabId of sequence) {
    fork.screen(`integration switch → ${tabId}`, 'integration:action')
    ctx.switchWorkspaceTab(tabId)
  }
  const elapsed = performance.now() - started

  fork.screen('integration sequence complete', 'integration:assert')
  assert.equal(ctx.state.activeTabId, 'mail:nucleus')
  assert.ok(elapsed < fork.budget.workspaceSwitchMaxMs * sequence.length)

  const check = assertScreenCoherent(fork.screen('integration coherence', 'integration:assert'), {
    activeTabId: 'mail:nucleus',
    viewPresent: true
  })
  assert.equal(check.ok, true, check.issues.join('; '))
})

test('integration: canvas native section preload IPC fires on section change', () => {
  const fork = createAppFork({
    harnessOptions: { canvasData: sampleCanvasData() }
  })
  fork.renderer.loadCanvasStack()
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)

  ctx.state.top = 'workspace'
  ctx.state.activeTabId = 'canvas:nucleus'
  ctx.state.tabs = ctx.state.tabs.map(tab => (
    tab.id === 'canvas:nucleus'
      ? {
        ...tab,
        canvasMode: 'native',
        canvasNativePage: 'course',
        courseId: '101',
        courseSection: 'weekly'
      }
      : tab
  ))

  const tab = ctx.getActiveTab()
  fork.screen('before native section preload', 'integration:preload')
  fork.callRenderer('scheduleNativeCanvasSectionPreload', tab)
  fork.screen('after native section preload', 'integration:preload')

  const preloadCalls = fork.ipcCalls.filter(call => call.channel === 'canvas:preload_plan')
  assert.ok(preloadCalls.length >= 1)
})

test('integration: fork trace export contains renderer and main lanes', () => {
  const fork = createAppFork()
  fork.loadRendererCore()
  fork.mockMain.activateTab('center:nucleus')
  fork.screen('integration trace export', 'integration:trace')

  const exported = fork.trace.toJSON()
  assert.ok(exported.entries.length >= 1)
  assert.ok(exported.summary.byProcess['fork'] || exported.summary.byProcess['renderer:boot'])
  assert.ok(exported.entries.some(entry => entry.screen && entry.screen.main))
})
