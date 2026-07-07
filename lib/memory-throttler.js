// Graduated memory throttler: parser → preload → sidekick as used RAM rises.
'use strict'

const DEFAULT_PARSER_THRESHOLD_PCT = 85
const DEFAULT_PRELOAD_THRESHOLD_PCT = 90
const DEFAULT_SIDEKICK_THRESHOLD_PCT = 95
const DEFAULT_HYSTERESIS_PCT = 3

function resolveThreshold(name, fallback) {
  const fromEnv = Number(process.env[name])
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : fallback
}

function buildReasons(state) {
  const reasons = []
  if (state.pauseParser) reasons.push('memory_throttle_parser')
  if (state.pausePreload) reasons.push('memory_throttle_preload')
  if (state.pauseSidekick) reasons.push('memory_throttle_sidekick')
  return reasons
}

function createMemoryThrottler(options = {}) {
  const thresholds = {
    parserPct: resolveThreshold(
      'RESOURCE_THROTTLE_PARSER_PCT',
      options.parserThresholdPct ?? DEFAULT_PARSER_THRESHOLD_PCT
    ),
    preloadPct: resolveThreshold(
      'RESOURCE_THROTTLE_PRELOAD_PCT',
      options.preloadThresholdPct ?? DEFAULT_PRELOAD_THRESHOLD_PCT
    ),
    sidekickPct: resolveThreshold(
      'RESOURCE_THROTTLE_SIDEKICK_PCT',
      options.sidekickThresholdPct ?? DEFAULT_SIDEKICK_THRESHOLD_PCT
    ),
    hysteresisPct: resolveThreshold(
      'RESOURCE_THROTTLE_HYSTERESIS_PCT',
      options.hysteresisPct ?? DEFAULT_HYSTERESIS_PCT
    )
  }

  const state = {
    pauseParser: false,
    pausePreload: false,
    pauseSidekick: false,
    usedMemPct: null,
    tier: 'normal'
  }

  function snapshot() {
    return {
      pauseParser: state.pauseParser,
      pausePreload: state.pausePreload,
      pauseSidekick: state.pauseSidekick,
      usedMemPct: state.usedMemPct,
      tier: state.tier,
      thresholds: { ...thresholds },
      reasons: buildReasons(state)
    }
  }

  function evaluate(usedMemPct) {
    const pct = Number(usedMemPct)
    if (!Number.isFinite(pct) || pct < 0) {
      return snapshot()
    }

    state.usedMemPct = pct

    // Escalate in order: parser → preload → sidekick.
    if (pct >= thresholds.parserPct) state.pauseParser = true
    if (pct >= thresholds.preloadPct) state.pausePreload = true
    if (pct >= thresholds.sidekickPct) state.pauseSidekick = true

    // Recover in reverse: sidekick → preload → parser (hysteresis avoids flapping).
    const release = thresholds.hysteresisPct
    if (pct < thresholds.sidekickPct - release) state.pauseSidekick = false
    if (pct < thresholds.preloadPct - release) state.pausePreload = false
    if (pct < thresholds.parserPct - release) state.pauseParser = false

    if (state.pauseSidekick) state.tier = 'sidekick'
    else if (state.pausePreload) state.tier = 'preload'
    else if (state.pauseParser) state.tier = 'parser'
    else state.tier = 'normal'

    return snapshot()
  }

  function reset() {
    state.pauseParser = false
    state.pausePreload = false
    state.pauseSidekick = false
    state.usedMemPct = null
    state.tier = 'normal'
  }

  return {
    evaluate,
    reset,
    getState: snapshot,
    thresholds
  }
}

module.exports = {
  createMemoryThrottler,
  DEFAULT_PARSER_THRESHOLD_PCT,
  DEFAULT_PRELOAD_THRESHOLD_PCT,
  DEFAULT_SIDEKICK_THRESHOLD_PCT,
  DEFAULT_HYSTERESIS_PCT,
  buildReasons
}
