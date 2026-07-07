// Local resource governor: polls CPU/RAM and gates background work (preload, parser, vector reload).
'use strict'

const { createElectronResourceHarness } = require('./electron-resource-harness')
const { createMemoryThrottler } = require('./memory-throttler')

const DEFAULT_POLL_MS = 2000
const DEFAULT_INTERACTIVE_BUSY_MS = 5000
const DEFAULT_FREE_MEM_PRESSURE_MB = 2048
const DEFAULT_FREE_MEM_CRITICAL_MB = 1024

function resolvePollIntervalMs(value) {
  if (value !== undefined && value !== null) {
    return Math.max(0, Number(value) || 0)
  }
  const fromEnv = Number(process.env.RESOURCE_GOVERNOR_POLL_MS)
  if (Number.isFinite(fromEnv)) return Math.max(0, fromEnv)
  return DEFAULT_POLL_MS
}

function resolveThreshold(name, fallback) {
  const fromEnv = Number(process.env[name])
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : fallback
}

function policiesEqual(left, right) {
  if (!left || !right) return false
  return left.tier === right.tier
    && left.pausePreload === right.pausePreload
    && left.pauseParser === right.pauseParser
    && left.pauseSidekick === right.pauseSidekick
    && left.deferVectorReload === right.deferVectorReload
}

function computePolicy(snapshot, activity, thresholds, memoryThrottle = null) {
  const sys = snapshot && snapshot.system ? snapshot.system : {}
  const ctx = snapshot && snapshot.governor && snapshot.governor.context
    ? snapshot.governor.context
    : {}
  const freeMemMb = Number(sys.freeMemMb) || 0
  const usedMemPct = Number(sys.usedMemPct)
  const memoryPressured = freeMemMb > 0 && freeMemMb < thresholds.freeMemPressureMb
  const memoryCritical = freeMemMb > 0 && freeMemMb < thresholds.freeMemCriticalMb
  const memThrottle = memoryThrottle || {
    pauseParser: false,
    pausePreload: false,
    pauseSidekick: false,
    tier: 'normal',
    reasons: []
  }
  const now = Date.now()

  const p0Surface = ctx.activeTabType === 'mailtab' || ctx.activeTabType === 'synapsetab'
  const p0Busy = now < activity.p0BusyUntil
    || Boolean(ctx.tabNavigating)
    || p0Surface
    || activity.synapseInFlight > 0
    || activity.mailInFlight > 0

  const p1Busy = Boolean(ctx.sidekickPending)
  const reasons = []

  if (memoryCritical) reasons.push('memory_critical')
  else if (memoryPressured) reasons.push('memory_pressure')
  for (const reason of memThrottle.reasons || []) reasons.push(reason)
  if (now < activity.p0BusyUntil) reasons.push('interactive_busy')
  if (ctx.tabNavigating) reasons.push('tab_navigating')
  if (p0Surface) reasons.push('interactive_surface')
  if (activity.synapseInFlight > 0) reasons.push('synapse_in_flight')
  if (activity.mailInFlight > 0) reasons.push('mail_in_flight')
  if (p1Busy) reasons.push('sidekick_pending')

  const pauseParser = p0Busy || p1Busy || memoryPressured || memoryCritical || memThrottle.pauseParser
  const pausePreload = p0Busy || p1Busy || memoryPressured || memoryCritical || memThrottle.pausePreload
  const pauseSidekick = memThrottle.pauseSidekick
  const deferVectorReload = p0Busy || p1Busy

  let tier = 'normal'
  if (memoryCritical) tier = 'critical'
  else if (pauseSidekick) tier = 'memory_sidekick'
  else if (p0Busy || memoryPressured || memThrottle.pausePreload) tier = 'interactive'
  else if (memThrottle.pauseParser) tier = 'memory_parser'
  else if (p1Busy) tier = 'sidekick'

  return {
    tier,
    pausePreload,
    pauseParser,
    pauseSidekick,
    deferVectorReload,
    p0Busy,
    p1Busy,
    memoryPressured,
    memoryCritical,
    usedMemPct: Number.isFinite(usedMemPct) ? usedMemPct : null,
    memoryThrottleTier: memThrottle.tier || 'normal',
    freeMemMb,
    parserQueueDepth: activity.parserQueueDepth,
    reasons
  }
}

function createResourceGovernor(options = {}) {
  const harness = options.harness || createElectronResourceHarness()
  const pollIntervalMs = resolvePollIntervalMs(options.pollIntervalMs)
  const getContext = typeof options.getContext === 'function' ? options.getContext : () => ({})
  const onSample = typeof options.onSample === 'function' ? options.onSample : null
  const onPolicyChange = typeof options.onPolicyChange === 'function' ? options.onPolicyChange : null
  const logSamples = options.logSamples === true || process.env.RESOURCE_GOVERNOR_LOG === '1'

  const thresholds = {
    freeMemPressureMb: resolveThreshold('RESOURCE_GOVERNOR_FREE_MEM_PRESSURE_MB', DEFAULT_FREE_MEM_PRESSURE_MB),
    freeMemCriticalMb: resolveThreshold('RESOURCE_GOVERNOR_FREE_MEM_CRITICAL_MB', DEFAULT_FREE_MEM_CRITICAL_MB),
    interactiveBusyMs: resolveThreshold('RESOURCE_GOVERNOR_INTERACTIVE_BUSY_MS', DEFAULT_INTERACTIVE_BUSY_MS)
  }

  const memoryThrottler = createMemoryThrottler(options.memoryThrottler)

  let appRef = options.app || null
  let timer = null
  let latestSnapshot = null
  let latestPolicy = null
  let sampleCount = 0
  let startedAt = 0
  let hooks = {
    onParserFlush: null,
    onVectorRestart: null
  }

  const activity = {
    p0BusyUntil: 0,
    synapseInFlight: 0,
    mailInFlight: 0,
    parserQueueDepth: 0,
    pendingVectorRestartDelay: null
  }

  function markInteractiveBusy(durationMs = thresholds.interactiveBusyMs) {
    const ms = Math.max(0, Number(durationMs) || thresholds.interactiveBusyMs)
    activity.p0BusyUntil = Math.max(activity.p0BusyUntil, Date.now() + ms)
  }

  function markSynapseBusy() {
    activity.synapseInFlight += 1
  }

  function clearSynapseBusy() {
    activity.synapseInFlight = Math.max(0, activity.synapseInFlight - 1)
  }

  function markMailBusy() {
    activity.mailInFlight += 1
  }

  function clearMailBusy() {
    activity.mailInFlight = Math.max(0, activity.mailInFlight - 1)
  }

  function setParserQueueDepth(depth) {
    activity.parserQueueDepth = Math.max(0, Number(depth) || 0)
  }

  function setHooks(nextHooks = {}) {
    hooks = {
      onParserFlush: typeof nextHooks.onParserFlush === 'function' ? nextHooks.onParserFlush : hooks.onParserFlush,
      onVectorRestart: typeof nextHooks.onVectorRestart === 'function' ? nextHooks.onVectorRestart : hooks.onVectorRestart
    }
  }

  function deferVectorRestart(delayMs = 1500) {
    activity.pendingVectorRestartDelay = Math.max(0, Number(delayMs) || 0)
  }

  function flushDeferredActions(policy) {
    if (policy && !policy.deferVectorReload && activity.pendingVectorRestartDelay != null) {
      const delayMs = activity.pendingVectorRestartDelay
      activity.pendingVectorRestartDelay = null
      if (hooks.onVectorRestart) hooks.onVectorRestart(delayMs)
    }
    if (policy && !policy.pauseParser && activity.parserQueueDepth > 0 && hooks.onParserFlush) {
      hooks.onParserFlush()
    }
  }

  function applyPolicy(snapshot) {
    const usedMemPct = snapshot && snapshot.system ? snapshot.system.usedMemPct : null
    const memThrottle = memoryThrottler.evaluate(usedMemPct)
    const policy = computePolicy(snapshot, activity, thresholds, memThrottle)
    const changed = !policiesEqual(latestPolicy, policy)
    const previous = latestPolicy
    latestPolicy = policy
    flushDeferredActions(policy)
    if (changed && onPolicyChange) onPolicyChange(policy, previous, snapshot)
    return policy
  }

  function shouldAllowPreload() {
    return !(latestPolicy && latestPolicy.pausePreload)
  }

  function shouldAllowParser() {
    return !(latestPolicy && latestPolicy.pauseParser)
  }

  function shouldAllowSidekick() {
    return !(latestPolicy && latestPolicy.pauseSidekick)
  }

  function shouldDeferVectorReload() {
    return Boolean(latestPolicy && latestPolicy.deferVectorReload)
  }

  function sample() {
    if (!appRef) return null
    const context = getContext() || {}
    const snapshot = harness.collect(appRef, { counts: context })
    sampleCount += 1
    snapshot.governor = {
      sampleCount,
      pollIntervalMs,
      startedAt: startedAt || null,
      context,
      policy: applyPolicy({ ...snapshot, governor: { context } })
    }
    latestSnapshot = snapshot
    if (onSample) onSample(snapshot)
    if (logSamples) {
      const sys = snapshot.system || {}
      const el = snapshot.electron || {}
      const policy = snapshot.governor.policy || {}
      console.log(
        `[nucleus:resource] #${sampleCount} tier=${policy.tier || 'unknown'}`
        + ` mem=${policy.usedMemPct != null ? `${policy.usedMemPct}%` : '—'}`
        + ` free=${sys.freeMemMb}MB electron=${el.totalWorkingSetMb}MB`
        + ` preload=${policy.pausePreload ? 'paused' : 'ok'}`
        + ` parser=${policy.pauseParser ? 'paused' : 'ok'}`
        + ` sidekick=${policy.pauseSidekick ? 'paused' : 'ok'}`
      )
    }
    return snapshot
  }

  function start(app) {
    if (app) appRef = app
    if (!appRef || pollIntervalMs <= 0 || timer) return false
    startedAt = Date.now()
    sampleCount = 0
    latestSnapshot = null
    latestPolicy = computePolicy(null, activity, thresholds)
    harness.resetCpuBaseline()
    timer = setInterval(sample, pollIntervalMs)
    if (typeof timer.unref === 'function') timer.unref()
    return true
  }

  function stop() {
    if (!timer) return false
    clearInterval(timer)
    timer = null
    return true
  }

  function isRunning() {
    return timer != null
  }

  function getLatestSnapshot() {
    return latestSnapshot
  }

  function getPolicy() {
    return latestPolicy
  }

  function getStatus() {
    return {
      running: isRunning(),
      pollIntervalMs,
      sampleCount,
      startedAt: startedAt || null,
      hasSnapshot: latestSnapshot != null,
      policy: latestPolicy,
      memoryThrottle: memoryThrottler.getState(),
      activity: {
        p0BusyUntil: activity.p0BusyUntil,
        synapseInFlight: activity.synapseInFlight,
        mailInFlight: activity.mailInFlight,
        parserQueueDepth: activity.parserQueueDepth,
        pendingVectorRestart: activity.pendingVectorRestartDelay != null
      },
      thresholds
    }
  }

  return {
    start,
    stop,
    sample,
    isRunning,
    getLatestSnapshot,
    getPolicy,
    getStatus,
    pollIntervalMs,
    markInteractiveBusy,
    markSynapseBusy,
    clearSynapseBusy,
    markMailBusy,
    clearMailBusy,
    setParserQueueDepth,
    setHooks,
    deferVectorRestart,
    shouldAllowPreload,
    shouldAllowParser,
    shouldAllowSidekick,
    shouldDeferVectorReload,
    getMemoryThrottleState: () => memoryThrottler.getState(),
    computePolicy: (snapshot, extraActivity = {}) => {
      const usedMemPct = snapshot && snapshot.system ? snapshot.system.usedMemPct : null
      const memThrottle = memoryThrottler.evaluate(usedMemPct)
      return computePolicy(snapshot, { ...activity, ...extraActivity }, thresholds, memThrottle)
    }
  }
}

module.exports = {
  createResourceGovernor,
  createMemoryThrottler,
  computePolicy,
  DEFAULT_POLL_MS,
  DEFAULT_INTERACTIVE_BUSY_MS,
  DEFAULT_FREE_MEM_PRESSURE_MB,
  DEFAULT_FREE_MEM_CRITICAL_MB,
  resolvePollIntervalMs
}
