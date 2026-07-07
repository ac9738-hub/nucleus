// Shared pointer motion sampling for Canvas preload hint trackers (browser + native).
;(function () {
'use strict'

const DEFAULT_MIN_MOVE_PX = 2
const DEFAULT_DIRECTION_DOT_THRESHOLD = 0.5
const DEFAULT_MAX_SAMPLES = 4
const DEFAULT_HINT_SEND_MS = 50
const DEFAULT_HEARTBEAT_MS = 300
const DEFAULT_SCORE_DELTA = 0.015

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function unitVector(dx, dy) {
  const len = Math.hypot(dx, dy)
  if (len < 0.001) return null
  return { x: dx / len, y: dy / len }
}

function createPointerHintInput(options = {}) {
  const minMovePx = Number(options.minMovePx) || DEFAULT_MIN_MOVE_PX
  const directionDotThreshold = Number(options.directionDotThreshold) || DEFAULT_DIRECTION_DOT_THRESHOLD
  const maxSamples = Math.max(2, Number(options.maxSamples) || DEFAULT_MAX_SAMPLES)
  const hintSendMs = Number(options.hintSendMs) || DEFAULT_HINT_SEND_MS
  const heartbeatMs = Number(options.heartbeatMs) || DEFAULT_HEARTBEAT_MS
  const scoreDelta = Number(options.scoreDelta) || DEFAULT_SCORE_DELTA

  const samples = []
  let lastX = 0
  let lastY = 0
  let lastDirX = 0
  let lastDirY = 0
  let lastSendAt = 0
  let lastTopUrl = ''
  let lastTopCombined = -1

  function seedPointer(px, py) {
    lastX = px
    lastY = py
    lastDirX = 0
    lastDirY = 0
    samples.length = 0
  }

  function recordPointerMove(px, py) {
    const dx = px - lastX
    const dy = py - lastY
    const dist = Math.hypot(dx, dy)
    if (dist < minMovePx) {
      return { moved: false, directionChanged: false, samples }
    }

    const dir = unitVector(dx, dy)
    let directionChanged = false
    if (dir && (lastDirX !== 0 || lastDirY !== 0)) {
      const dot = dir.x * lastDirX + dir.y * lastDirY
      directionChanged = dot < directionDotThreshold
    }
    if (dir) {
      lastDirX = dir.x
      lastDirY = dir.y
    }

    lastX = px
    lastY = py
    samples.push({ x: px, y: py, t: Date.now() })
    while (samples.length > maxSamples) samples.shift()

    return {
      moved: true,
      directionChanged,
      samples: samples.slice()
    }
  }

  function shouldEmitHints(meta = {}) {
    const now = Date.now()
    const topUrl = String(meta.topUrl || '')
    const topCombined = Number(meta.topCombined || 0)
    const force = Boolean(meta.force)
    const directionChanged = Boolean(meta.directionChanged)

    if (force || directionChanged) {
      lastSendAt = now
      lastTopUrl = topUrl
      lastTopCombined = topCombined
      return { emit: true, reason: directionChanged ? 'direction' : 'force' }
    }

    const scoresChanged = Math.abs(topCombined - lastTopCombined) > scoreDelta
    const heartbeatDue = now - lastSendAt >= heartbeatMs
    if (now - lastSendAt < hintSendMs && topUrl === lastTopUrl && !scoresChanged && !heartbeatDue) {
      return { emit: false, reason: 'throttled' }
    }

    lastSendAt = now
    lastTopUrl = topUrl
    lastTopCombined = topCombined
    return { emit: true, reason: scoresChanged ? 'score' : (heartbeatDue ? 'heartbeat' : 'move') }
  }

  return {
    recordPointerMove,
    shouldEmitHints,
    seedPointer,
    getSamples: () => samples.slice()
  }
}

const api = {
  DEFAULT_MIN_MOVE_PX,
  DEFAULT_DIRECTION_DOT_THRESHOLD,
  DEFAULT_MAX_SAMPLES,
  DEFAULT_HINT_SEND_MS,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_SCORE_DELTA,
  createPointerHintInput
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api
}
if (typeof globalThis !== 'undefined') {
  globalThis.nucleusCanvasPreloadPointerInput = api
}
if (typeof window !== 'undefined') {
  window.nucleusCanvasPreloadPointerInput = api
}
})()
