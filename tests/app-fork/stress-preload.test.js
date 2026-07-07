'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppFork } = require('./harness')
const { buildStressCanvasUrls } = require('../../lib/app-fork/stress-fixtures')
const {
  createStressCollector,
  resolveStressBudget,
  assertStressBounds
} = require('../../lib/app-fork/stress-metrics')
const { POOL_LIMITS } = require('../../lib/app-fork/mock-main-process')

test('stress: predictive preload burst stays within pool and GPU caps', async () => {
  const fork = createAppFork({ profile: process.env.NUCLEUS_APP_FORK_PROFILE || 'jsdom' })
  const stressBudget = resolveStressBudget(fork.budget)
  const collector = createStressCollector(fork, 'preload_burst')

  const tab = {
    id: 'canvas:nucleus',
    type: 'canvastab',
    workspaceId: 'nucleus',
    label: 'Canvas'
  }
  fork.mockMain.tabs.push(tab)
  fork.mockMain.activateTab(tab.id)

  const urls = buildStressCanvasUrls('101', stressBudget.preloadUrlBurst)
  collector.sampleGpu('preload stress baseline', 'stress:preload')

  let totalLoaded = 0
  for (let burst = 0; burst < stressBudget.concurrentPreloadGenerations; burst += 1) {
    const generation = fork.mockMain.bumpPreloadGeneration()
    const slice = urls.slice(
      burst * Math.floor(urls.length / stressBudget.concurrentPreloadGenerations),
      (burst + 1) * Math.floor(urls.length / stressBudget.concurrentPreloadGenerations)
    )
    const result = await fork.mockMain.simulatePreloadLoad(tab, slice, { generation })
    totalLoaded += result.loaded
    collector.recordPreloadResult(slice.length, result.loaded)
    collector.sampleGpu(`preload burst ${burst + 1} loaded=${result.loaded}`, 'stress:preload')
  }

  collector.sampleGpu('preload stress peak', 'stress:preload')
  const report = collector.finalize({
    pass: true,
    totalLoaded,
    poolLimits: POOL_LIMITS.canvas
  })

  assert.ok(report.peak.preloadPoolSize <= 3, `preload pool size ${report.peak.preloadPoolSize}`)
  assert.ok(totalLoaded >= 1)

  assertStressBounds(report, stressBudget, assert.ok)
  collector.writeReport('stress_preload.json', report)
})

test('stress: interleaved preload generations discard stale quiet loads', async () => {
  const fork = createAppFork()
  const collector = createStressCollector(fork, 'preload_generation_race')
  const tab = { id: 'canvas:nucleus', type: 'canvastab', workspaceId: 'nucleus', label: 'Canvas' }
  const urls = buildStressCanvasUrls('101', 12)

  let staleLoaded = 0
  let freshLoaded = 0
  for (let round = 0; round < 6; round += 1) {
    const staleGen = fork.mockMain.bumpPreloadGeneration()
    const stalePromise = fork.mockMain.simulatePreloadLoad(
      tab,
      [urls[round * 2]],
      { generation: staleGen }
    )
    fork.mockMain.bumpPreloadGeneration()
    const fresh = await fork.mockMain.simulatePreloadLoad(tab, [urls[round * 2 + 1] || urls[0]])
    const stale = await stalePromise
    staleLoaded += stale.loaded
    freshLoaded += fresh.loaded
    collector.sampleGpu(`preload generation round ${round + 1}`, 'stress:preload')
  }

  const report = collector.finalize({
    pass: true,
    staleLoaded,
    freshLoaded
  })

  assert.ok(freshLoaded >= 1)
  assert.ok(staleLoaded <= freshLoaded)
  assert.ok(report.peak.poolCanvasTotal <= POOL_LIMITS.canvas.maxSize)
  collector.writeReport('stress_preload_generations.json', report)
})

test('stress: native section preload IPC storm stays bounded', () => {
  const fork = createAppFork()
  fork.renderer.loadCanvasStack()
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)

  const collector = createStressCollector(fork, 'preload_ipc_storm')
  const sections = ['homepage', 'weekly', 'modules', 'assignments', 'files', 'grades']
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
  tab.canvasUserInteracted = true
  for (let i = 0; i < sections.length * 3; i += 1) {
    tab.courseSection = sections[i % sections.length]
    fork.callRenderer('scheduleNativeCanvasSectionPreload', tab)
    if (i % 4 === 0) collector.sampleGpu(`ipc storm step ${i + 1}`, 'stress:preload')
  }

  const preloadCalls = fork.ipcCalls.filter(call => call.channel === 'canvas:preload_plan')
  const report = collector.finalize({
    pass: true,
    preloadIpcCount: preloadCalls.length
  })

  assert.ok(preloadCalls.length >= 1)
  assert.ok(preloadCalls.length <= sections.length)
  assert.ok(report.peak.layerScore <= resolveStressBudget(fork.budget).maxPeakLayerScore)
  collector.writeReport('stress_preload_ipc.json', report)
})
