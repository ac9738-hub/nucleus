const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createResourceGovernor,
  computePolicy,
  resolvePollIntervalMs,
  DEFAULT_POLL_MS
} = require('../lib/resource-governor')

const mockApp = {
  getAppMetrics() {
    return [{
      pid: 100,
      type: 'Browser',
      cpu: { percentCPUUsage: 5 },
      memory: { workingSetSize: 64 * 1048576, peakWorkingSetSize: 70 * 1048576 }
    }]
  }
}

const harness = {
  resetCpuBaseline() {},
  collect(app, meta) {
    return {
      sampledAt: Date.now(),
      system: { freeMemMb: 4096, usedMemPct: 50 },
      electron: { totalWorkingSetMb: 64, totalCpuPct: 5 },
      counts: meta.counts || {}
    }
  }
}

test('resolvePollIntervalMs defaults and clamps', () => {
  assert.equal(resolvePollIntervalMs(undefined), DEFAULT_POLL_MS)
  assert.equal(resolvePollIntervalMs(0), 0)
  assert.equal(resolvePollIntervalMs(-5), 0)
})

test('computePolicy pauses background work for interactive surfaces', () => {
  const policy = computePolicy(
    { system: { freeMemMb: 4096 }, governor: { context: { activeTabType: 'mailtab' } } },
    { p0BusyUntil: 0, synapseInFlight: 0, mailInFlight: 0, parserQueueDepth: 0 },
    { freeMemPressureMb: 2048, freeMemCriticalMb: 1024, interactiveBusyMs: 5000 }
  )
  assert.equal(policy.tier, 'interactive')
  assert.equal(policy.pausePreload, true)
  assert.equal(policy.pauseParser, true)
})

test('computePolicy pauses parser for sidekick pending', () => {
  const policy = computePolicy(
    { system: { freeMemMb: 4096 }, governor: { context: { sidekickPending: true } } },
    { p0BusyUntil: 0, synapseInFlight: 0, mailInFlight: 0, parserQueueDepth: 0 },
    { freeMemPressureMb: 2048, freeMemCriticalMb: 1024, interactiveBusyMs: 5000 }
  )
  assert.equal(policy.tier, 'sidekick')
  assert.equal(policy.pauseParser, true)
  assert.equal(policy.deferVectorReload, true)
})

test('computePolicy uses memory pressure thresholds', () => {
  const policy = computePolicy(
    { system: { freeMemMb: 900 }, governor: { context: {} } },
    { p0BusyUntil: 0, synapseInFlight: 0, mailInFlight: 0, parserQueueDepth: 0 },
    { freeMemPressureMb: 2048, freeMemCriticalMb: 1024, interactiveBusyMs: 5000 }
  )
  assert.equal(policy.tier, 'critical')
  assert.equal(policy.pausePreload, true)
  assert.equal(policy.pauseParser, true)
})

test('governor samples and tracks latest snapshot', () => {
  const governor = createResourceGovernor({
    app: mockApp,
    pollIntervalMs: 0,
    harness,
    getContext: () => ({ tabs: 2 })
  })

  assert.equal(governor.getStatus().running, false)
  const snapshot = governor.sample()
  assert.ok(snapshot)
  assert.equal(snapshot.counts.tabs, 2)
  assert.equal(snapshot.governor.sampleCount, 1)
  assert.ok(snapshot.governor.policy)
  assert.equal(governor.getLatestSnapshot(), snapshot)
})

test('governor flushes deferred vector restart when allowed', () => {
  let sidekickPending = true
  const restarts = []
  const governor = createResourceGovernor({
    app: mockApp,
    pollIntervalMs: 0,
    harness,
    getContext: () => ({ sidekickPending })
  })
  governor.setHooks({
    onVectorRestart: delayMs => restarts.push(delayMs)
  })
  governor.sample()
  governor.deferVectorRestart(1500)
  governor.sample()
  assert.equal(restarts.length, 0)

  sidekickPending = false
  governor.sample()
  assert.deepEqual(restarts, [1500])
})

test('governor start and stop polling timer', () => {
  const governor = createResourceGovernor({
    app: mockApp,
    pollIntervalMs: 50,
    harness: {
      resetCpuBaseline() {},
      collect: () => ({
        sampledAt: Date.now(),
        system: { freeMemMb: 4096, usedMemPct: 40 },
        electron: { totalWorkingSetMb: 64, totalCpuPct: 2 },
        counts: {}
      })
    }
  })

  assert.equal(governor.start(), true)
  assert.equal(governor.isRunning(), true)
  assert.equal(governor.start(), false)

  return new Promise(resolve => {
    setTimeout(() => {
      assert.ok(governor.getStatus().sampleCount >= 1)
      assert.equal(governor.stop(), true)
      assert.equal(governor.isRunning(), false)
      resolve()
    }, 120)
  })
})

test('governor flushes parser hook when parser gate opens', () => {
  let sidekickPending = true
  const flushes = []
  const governor = createResourceGovernor({
    app: mockApp,
    pollIntervalMs: 0,
    harness,
    getContext: () => ({ sidekickPending })
  })
  governor.setHooks({ onParserFlush: () => flushes.push(Date.now()) })
  governor.setParserQueueDepth(3)
  governor.sample()
  assert.equal(flushes.length, 0)

  sidekickPending = false
  governor.sample()
  assert.equal(flushes.length, 1)
})
