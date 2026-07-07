'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createLagSpikeCollector } = require('../lib/lag-spike-collector')
const { buildFixPlan } = require('../lib/perf-eval-server')

test('lag spike collector records spikes above threshold', async () => {
  const collector = createLagSpikeCollector({ spikeMs: 50, navSpikeMs: 100 })
  await collector.span('test.slow_op', async () => {
    await new Promise(resolve => setTimeout(resolve, 60))
  })
  const snapshot = collector.getSnapshot()
  assert.ok(snapshot.spikeCount >= 1)
  assert.ok(snapshot.byOp.some(row => row.op === 'test.slow_op'))
})

test('buildFixPlan suggests visible context defer when dominant', () => {
  const plan = buildFixPlan({
    lag: {
      byOp: [{ op: 'visible_context.update', p95Ms: 180, count: 4, maxMs: 220 }],
      spikes: { totalSpikes: 3, navSpikeCount: 1, recent: [], topDrivers: [] }
    },
    governor: { policy: { pausePreload: false } }
  })
  assert.ok(plan.some(line => line.includes('visible_context.update')))
})
