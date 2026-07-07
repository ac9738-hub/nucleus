'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { performance } = require('node:perf_hooks')
const { createAppFork } = require('./harness')
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

test('stress: workspace switching across many workspaces', async () => {
  const rendererState = buildStressRendererState({ workspaceCount: 5, browserPerWorkspace: 2 })
  const fork = createAppFork({
    profile: process.env.NUCLEUS_APP_FORK_PROFILE || 'jsdom',
    state: rendererState,
    harnessOptions: { workspaces: rendererState.workspaces }
  })
  const stressBudget = resolveStressBudget(fork.budget)
  const collector = createStressCollector(fork, 'workspace_switch_burst')

  const ctx = fork.loadFullStack()
  await fork.settleRendererBoot()
  ctx.syncActiveTab = async () => ({ ok: true })

  const workspaceIds = rendererState.workspaces.map(ws => ws.id)
  collector.sampleGpu('workspace stress baseline', 'stress:workspace')

  for (let round = 0; round < stressBudget.workspaceSwitchBurst; round += 1) {
    const workspaceId = workspaceIds[round % workspaceIds.length]
    const t0 = performance.now()
    fork.screen(`stress workspace → ${workspaceId}`, 'stress:workspace')
    fork.callRenderer('setActiveWorkspace', workspaceId)
    collector.recordWorkspaceSwitchMs(performance.now() - t0)

    const tabIds = cycleTabIds(ctx.state.tabs, workspaceId)
    for (let t = 0; t < 2; t += 1) {
      const tabId = tabIds[t % tabIds.length]
      const switchT0 = performance.now()
      fork.callRenderer('switchWorkspaceTab', tabId)
      collector.recordSwitchMs(performance.now() - switchT0)
    }

    if (round % 4 === 3) collector.sampleGpu(`workspace round ${round + 1}`, 'stress:workspace')
  }

  await fork.settleRendererBoot()
  collector.sampleGpu('workspace stress peak', 'stress:workspace')

  const finalWorkspaceId = workspaceIds[(stressBudget.workspaceSwitchBurst - 1) % workspaceIds.length]
  const expectedTabId = rendererState.activeTabByWorkspace[finalWorkspaceId]
  const check = assertScreenCoherent(fork.screen('workspace stress final', 'stress:assert'), {
    activeTabId: expectedTabId,
    viewPresent: true
  })

  const report = collector.finalize({
    pass: check.ok,
    workspaceCount: workspaceIds.length,
    finalWorkspaceId
  })

  assert.equal(check.ok, true, check.issues.join('; '))
  assert.equal(ctx.state.activeWorkspaceId, finalWorkspaceId)
  assertStressBounds(report, stressBudget, assert.ok)
  collector.writeReport('stress_workspaces.json', report)
})

test('stress: remembered workspace tabs survive round-robin workspace hops', async () => {
  const rendererState = buildStressRendererState({ workspaceCount: 4, browserPerWorkspace: 1 })
  const fork = createAppFork({
    state: rendererState,
    harnessOptions: { workspaces: rendererState.workspaces }
  })
  const collector = createStressCollector(fork, 'workspace_memory')

  const ctx = fork.loadFullStack()
  await fork.settleRendererBoot()
  ctx.syncActiveTab = async () => ({ ok: true })

  const remembered = {}
  for (const ws of rendererState.workspaces) {
    const mailTab = `mail:${ws.id}`
    fork.callRenderer('setActiveWorkspace', ws.id)
    fork.callRenderer('switchWorkspaceTab', mailTab)
    remembered[ws.id] = mailTab
  }

  for (let hop = 0; hop < 12; hop += 1) {
    const ws = rendererState.workspaces[hop % rendererState.workspaces.length]
    fork.callRenderer('setActiveWorkspace', ws.id)
    assert.equal(ctx.state.activeTabId, remembered[ws.id])
    collector.sampleGpu(`workspace memory hop ${hop + 1}`, 'stress:workspace')
  }

  const report = collector.finalize({ pass: true, remembered })
  collector.writeReport('stress_workspace_memory.json', report)
})

test('stress: section ↔ workspace navigation under load', async () => {
  const rendererState = buildStressRendererState({ workspaceCount: 3, browserPerWorkspace: 2 })
  const fork = createAppFork({
    state: rendererState,
    harnessOptions: { workspaces: rendererState.workspaces }
  })
  const stressBudget = resolveStressBudget(fork.budget)
  const collector = createStressCollector(fork, 'section_workspace_ping')

  const ctx = fork.loadFullStack()
  await fork.settleRendererBoot()
  ctx.syncActiveTab = async () => ({ ok: true })

  for (let i = 0; i < 20; i += 1) {
    const t0 = performance.now()
    if (i % 2 === 0) {
      fork.callRenderer('setActiveSection', 'tasks')
      fork.screen(`section tasks ${i + 1}`, 'stress:section')
    } else {
      fork.callRenderer('setActiveWorkspace', rendererState.workspaces[i % rendererState.workspaces.length].id)
      fork.screen(`workspace restore ${i + 1}`, 'stress:section')
    }
    collector.recordWorkspaceSwitchMs(performance.now() - t0)
    if (i % 5 === 4) collector.sampleGpu(`section/workspace ping ${i + 1}`, 'stress:workspace')
  }

  await fork.settleRendererBoot()
  const report = collector.finalize({ pass: true })
  assert.ok(report.peak.poolCanvasTotal <= stressBudget.maxPoolCanvasTotal)
  collector.writeReport('stress_section_workspace.json', report)
})
