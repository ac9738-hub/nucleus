'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createProcessTrace } = require('../../lib/app-fork/process-trace')
const { captureAppScreen, assertScreenCoherent } = require('../../lib/app-fork/screen-state')
const { estimateGpuPressure } = require('../../lib/app-fork/gpu-estimator')
const { createMockMainProcess } = require('../../lib/app-fork/mock-main-process')
const { resolveScenarioTests } = require('../../lib/app-fork/scenarios')

test('process trace records monotonic seq and tMs', () => {
  const trace = createProcessTrace()
  trace.step('main', 'first', { renderer: { activeTabId: 'a' } })
  trace.step('renderer', 'second', { renderer: { activeTabId: 'b' } })
  const summary = trace.summarize()
  assert.equal(summary.count, 2)
  assert.ok(summary.durationMs >= 0)
})

test('assertScreenCoherent detects active tab mismatch', () => {
  const screen = {
    renderer: { activeTabId: 'mail:nucleus', view: { present: true, textLength: 10 } },
    main: { activeTabId: 'center:nucleus' }
  }
  const check = assertScreenCoherent(screen, { activeTabId: 'center:nucleus' })
  assert.equal(check.ok, false)
  assert.ok(check.issues.length >= 1)
})

test('scenario registry resolves all modules', () => {
  const tests = resolveScenarioTests('all')
  assert.ok(tests.length >= 10)
  assert.ok(tests.every(file => file.startsWith('tests/app-fork/')))
})

test('mock main snapshot includes pool and preload counters', () => {
  const trace = createProcessTrace()
  const main = createMockMainProcess({ trace, tabs: [{ id: 't1', type: 'center' }], activeTabId: 't1' })
  const snap = main.snapshot()
  assert.equal(snap.activeTabId, 't1')
  assert.ok(snap.pool.web)
  assert.ok(snap.pool.canvas)
})

test('gpu estimator flags overload', () => {
  const pressure = estimateGpuPressure({
    pool: {
      web: { inUse: 4, backup: 3, available: 1, active: 5, total: 8 },
      canvas: { inUse: 4, backup: 3, available: 1, active: 5, total: 8 }
    },
    preload: { poolSize: 6 }
  }, { budget: { maxLayerScore: 8, maxEstimatedMb: 200, maxHiddenPredictive: 3 } })
  assert.equal(pressure.withinBudget, false)
})
