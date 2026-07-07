'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { performance } = require('node:perf_hooks')
const { createAppFork, buildWorkspaceTabState } = require('./harness')
const {
  buildStressRendererState,
  cycleTabIds
} = require('../../lib/app-fork/stress-fixtures')
const {
  createStressCollector,
  resolveStressBudget,
  assertStressBounds
} = require('../../lib/app-fork/stress-metrics')
const { assertScreenCoherent } = require('../../lib/app-fork/screen-state')

test('stress: rapid tab switching across many surfaces', () => {
  const rendererState = buildStressRendererState({ workspaceCount: 3, browserPerWorkspace: 3 })
  const fork = createAppFork({
    profile: process.env.NUCLEUS_APP_FORK_PROFILE || 'jsdom',
    state: rendererState,
    harnessOptions: { workspaces: rendererState.workspaces }
  })
  const stressBudget = resolveStressBudget(fork.budget)
  const collector = createStressCollector(fork, 'tab_switch_burst')

  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)
  ctx.syncActiveTab = async () => ({ ok: true })

  const tabIds = cycleTabIds(ctx.state.tabs)
  let paintCount = 0
  const origPaint = ctx.paintActiveView.bind(ctx)
  ctx.paintActiveView = (options) => {
    const t0 = performance.now()
    origPaint(options)
    collector.recordPaintMs(performance.now() - t0)
    paintCount += 1
  }

  collector.sampleGpu('tab stress baseline', 'stress:tabs')

  for (let i = 0; i < stressBudget.tabSwitchBurst; i += 1) {
    const tabId = tabIds[i % tabIds.length]
    const t0 = performance.now()
    fork.screen(`stress switch → ${tabId}`, 'stress:tabs')
    ctx.switchWorkspaceTab(tabId)
    collector.recordSwitchMs(performance.now() - t0)
    if (i % 12 === 11) collector.sampleGpu(`tab stress step ${i + 1}`, 'stress:tabs')
  }

  collector.sampleGpu('tab stress peak', 'stress:tabs')
  const finalTabId = tabIds[(stressBudget.tabSwitchBurst - 1) % tabIds.length]
  const check = assertScreenCoherent(fork.screen('tab stress final screen', 'stress:assert'), {
    activeTabId: finalTabId,
    viewPresent: true
  })

  const report = collector.finalize({
    pass: check.ok,
    finalTabId,
    tabCount: tabIds.length,
    paintCount
  })

  assert.equal(check.ok, true, check.issues.join('; '))
  assert.ok(paintCount <= stressBudget.tabSwitchBurst * stressBudget.maxPaintPerSwitch)
  assertStressBounds(report, stressBudget, assert.ok)
  collector.writeReport('stress_tabs.json', report)
})

test('stress: opening many browser tabs increases pool pressure but stays capped', () => {
  const fork = createAppFork({ profile: 'relaxed' })
  const stressBudget = resolveStressBudget(fork.budget)
  const collector = createStressCollector(fork, 'tab_open_burst')
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)
  ctx.syncActiveTab = async () => ({ ok: true })

  const workspaceId = ctx.state.activeWorkspaceId
  const openCount = 12

  for (let i = 0; i < openCount; i += 1) {
    const id = `browser:stress-open:${i}`
    const tab = {
      id,
      type: 'browsertab',
      workspaceId,
      label: `Opened ${i + 1}`,
      url: `nucleus://opened/${i}`
    }
    ctx.state.tabs.push(tab)
    fork.mockMain.tabs.push({ ...tab })
    fork.mockMain.activateTab(id)
    ctx.switchWorkspaceTab(id)
    if (i % 3 === 2) collector.sampleGpu(`opened tab ${i + 1}`, 'stress:tabs')
  }

  const report = collector.finalize({
    pass: true,
    openedTabs: openCount,
    totalTabs: ctx.state.tabs.length
  })

  assert.ok(report.peak.poolWebTotal <= stressBudget.maxPoolWebTotal)
  assert.ok(ctx.state.tabs.length >= openCount + 4)
  collector.writeReport('stress_tab_open.json', report)
})

test('stress: render stack tab switches under full renderer boot', async () => {
  const rendererState = buildStressRendererState({ workspaceCount: 2, browserPerWorkspace: 2 })
  const fork = createAppFork({
    state: rendererState,
    harnessOptions: { workspaces: rendererState.workspaces, canvasData: { courses: [] } }
  })
  const stressBudget = resolveStressBudget(fork.budget)
  const collector = createStressCollector(fork, 'tab_render_full_stack')

  const ctx = fork.loadFullStack()
  await fork.settleRendererBoot()
  ctx.syncActiveTab = async () => ({ ok: true })

  const tabIds = cycleTabIds(ctx.state.tabs, rendererState.activeWorkspaceId)
  for (let i = 0; i < Math.min(stressBudget.tabSwitchBurst, 24); i += 1) {
    const tabId = tabIds[i % tabIds.length]
    const t0 = performance.now()
    fork.callRenderer('switchWorkspaceTab', tabId)
    collector.recordSwitchMs(performance.now() - t0)
    if (i % 8 === 7) collector.sampleGpu(`full stack switch ${i + 1}`, 'stress:tabs')
  }
  await fork.settleRendererBoot()

  const report = collector.finalize({
    pass: true,
    mode: 'full_stack'
  })

  assert.ok(report.samples.switchCount >= 24)
  assertStressBounds(report, stressBudget, assert.ok)
  collector.writeReport('stress_tabs_render.json', report)
})
