'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppFork } = require('./harness')

test('gpu: baseline workspace tabs within layer budget', () => {
  const fork = createAppFork({ profile: 'jsdom' })
  fork.loadRendererCore()
  fork.screen('baseline screen', 'gpu:baseline')

  const pressure = fork.gpuPressure()
  fork.trace.step('gpu:eval', 'baseline pressure', fork.screen('gpu baseline'), pressure)

  assert.ok(pressure.withinBudget, JSON.stringify(pressure))
  assert.ok(pressure.layerScore < fork.budget.gpu.maxLayerScore)
})

test('gpu: predictive preload load increases pressure but stays bounded', async () => {
  const fork = createAppFork({ profile: 'jsdom' })
  const tab = { id: 'canvas:nucleus', type: 'canvastab', workspaceId: 'nucleus', label: 'Canvas' }
  fork.mockMain.tabs.push(tab)
  fork.mockMain.activateTab('canvas:nucleus')

  const urls = [
    'https://canvas.example/courses/101/assignments/1',
    'https://canvas.example/courses/101/assignments/2',
    'https://canvas.example/courses/101/files/9'
  ]

  fork.screen('before preload simulation', 'gpu:preload')
  const result = await fork.mockMain.simulatePreloadLoad(tab, urls)
  fork.screen('after preload simulation', 'gpu:preload')

  const pressure = fork.gpuPressure()
  fork.trace.step('gpu:eval', 'post-preload pressure', fork.screen('gpu post-preload'), {
    loaded: result.loaded,
    pressure
  })

  assert.equal(result.loaded, 3)
  assert.ok(pressure.predictiveCount >= 3)
  assert.ok(pressure.withinBudget, JSON.stringify(pressure))
})

test('gpu: exceeding predictive cap fails budget check', () => {
  const fork = createAppFork({ profile: 'strict' })
  const snapshot = fork.mockMain.snapshot()
  snapshot.preload.poolSize = 10
  snapshot.pool.canvas.inUse = 4
  snapshot.pool.canvas.backup = 3

  const { estimateGpuPressure } = require('../../lib/app-fork/gpu-estimator')
  const pressure = estimateGpuPressure(snapshot, { budget: fork.budget.gpu })
  fork.trace.step('gpu:eval', 'synthetic overload', null, pressure)

  assert.equal(pressure.withinBudget, false)
  assert.ok(
    pressure.layerScore > fork.budget.gpu.maxLayerScore
    || pressure.predictiveCount > fork.budget.gpu.maxHiddenPredictive,
    JSON.stringify(pressure)
  )
})
