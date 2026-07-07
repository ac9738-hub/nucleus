'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createMemoryThrottler } = require('../lib/memory-throttler')
const { computePolicy } = require('../lib/resource-governor')

test('memory throttler escalates parser → preload → sidekick', () => {
  const throttler = createMemoryThrottler({
    parserThresholdPct: 85,
    preloadThresholdPct: 90,
    sidekickThresholdPct: 95,
    hysteresisPct: 3
  })

  let state = throttler.evaluate(84)
  assert.equal(state.pauseParser, false)
  assert.equal(state.pausePreload, false)
  assert.equal(state.pauseSidekick, false)

  state = throttler.evaluate(86)
  assert.equal(state.pauseParser, true)
  assert.equal(state.pausePreload, false)
  assert.equal(state.pauseSidekick, false)
  assert.equal(state.tier, 'parser')

  state = throttler.evaluate(91)
  assert.equal(state.pauseParser, true)
  assert.equal(state.pausePreload, true)
  assert.equal(state.pauseSidekick, false)
  assert.equal(state.tier, 'preload')

  state = throttler.evaluate(96)
  assert.equal(state.pauseParser, true)
  assert.equal(state.pausePreload, true)
  assert.equal(state.pauseSidekick, true)
  assert.equal(state.tier, 'sidekick')
})

test('memory throttler recovers in reverse order with hysteresis', () => {
  const throttler = createMemoryThrottler({
    parserThresholdPct: 85,
    preloadThresholdPct: 90,
    sidekickThresholdPct: 95,
    hysteresisPct: 3
  })

  throttler.evaluate(96)
  let state = throttler.evaluate(91)
  assert.equal(state.pauseSidekick, false)
  assert.equal(state.pausePreload, true)
  assert.equal(state.pauseParser, true)

  state = throttler.evaluate(86)
  assert.equal(state.pauseSidekick, false)
  assert.equal(state.pausePreload, false)
  assert.equal(state.pauseParser, true)

  state = throttler.evaluate(81)
  assert.equal(state.pauseParser, false)
  assert.equal(state.tier, 'normal')
})

test('computePolicy applies memory throttle before sidekick-only pause', () => {
  const thresholds = { freeMemPressureMb: 2048, freeMemCriticalMb: 1024, interactiveBusyMs: 5000 }
  const activity = { p0BusyUntil: 0, synapseInFlight: 0, mailInFlight: 0, parserQueueDepth: 0 }
  const memThrottle = {
    pauseParser: true,
    pausePreload: false,
    pauseSidekick: false,
    tier: 'parser',
    reasons: ['memory_throttle_parser']
  }

  const policy = computePolicy(
    { system: { freeMemMb: 4096, usedMemPct: 86 }, governor: { context: {} } },
    activity,
    thresholds,
    memThrottle
  )

  assert.equal(policy.pauseParser, true)
  assert.equal(policy.pausePreload, false)
  assert.equal(policy.pauseSidekick, false)
  assert.ok(policy.reasons.includes('memory_throttle_parser'))
})

test('governor shouldAllowSidekick follows memory throttle tier', () => {
  const { createResourceGovernor } = require('../lib/resource-governor')
  const governor = createResourceGovernor({
    app: { getAppMetrics: () => [] },
    pollIntervalMs: 0,
    harness: {
      resetCpuBaseline() {},
      collect: () => ({
        sampledAt: Date.now(),
        system: { freeMemMb: 512, usedMemPct: 96, totalMemMb: 8192 },
        electron: { totalWorkingSetMb: 900, totalCpuPct: 10 },
        counts: {}
      })
    }
  })

  governor.sample()
  assert.equal(governor.shouldAllowSidekick(), false)
  assert.equal(governor.getPolicy().pauseSidekick, true)
  assert.equal(governor.getPolicy().pausePreload, true)
  assert.equal(governor.getPolicy().pauseParser, true)
})
