// Pointer proximity / approach scoring for Canvas preload (pure functions).
;(function () {
'use strict'

const DEFAULT_FALLOFF_PX = 280
const MIN_SPEED_PX_MS = 0.04

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function closestPointOnRect(px, py, rect) {
  return {
    x: clamp(px, rect.left, rect.right),
    y: clamp(py, rect.top, rect.bottom)
  }
}

/** Inverse-quadratic falloff in [0, 1]; no sqrt required. */
function distanceProximityScore(px, py, rect, falloffPx = DEFAULT_FALLOFF_PX) {
  const point = closestPointOnRect(px, py, rect)
  const dx = px - point.x
  const dy = py - point.y
  const d2 = dx * dx + dy * dy
  const f2 = falloffPx * falloffPx
  return 1 / (1 + d2 / f2)
}

/** Normalized dot product of velocity vs direction to target; in [-1, 1]. */
function normalizedApproachDot(samples, targetX, targetY, px, py, minSpeedPxMs = MIN_SPEED_PX_MS) {
  if (!Array.isArray(samples) || samples.length < 2) return 0
  const first = samples[0]
  const last = samples[samples.length - 1]
  const dt = Math.max(1, last.t - first.t)
  const vx = (last.x - first.x) / dt
  const vy = (last.y - first.y) / dt
  const speed = Math.hypot(vx, vy)
  if (speed < minSpeedPxMs) return 0

  const tx = targetX - px
  const ty = targetY - py
  const dist = Math.hypot(tx, ty)
  if (dist < 1) return 1

  return clamp((vx * tx + vy * ty) / (speed * dist), -1, 1)
}

/**
 * Combine proximity + approach. When moving toward a link, proximity is squared
 * (stronger when close). Idle/near-stationary keeps a small proximity-only nudge.
 */
function scorePointerHint(proximity, approachDot) {
  const toward = clamp(approachDot, 0, 1)
  const proximityClamped = clamp(proximity, 0, 1)
  const idleNudge = proximityClamped * 0.1
  const combined = toward > 0
    ? toward * (proximityClamped * proximityClamped)
    : idleNudge
  return {
    proximityScore: proximityClamped,
    approachDot: toward,
    approachRaw: approachDot,
    combined: clamp(combined, 0, 1)
  }
}

function rankLinksByPointer(links, px, py, samples, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 5)
  const falloffPx = Number(options.falloffPx) || DEFAULT_FALLOFF_PX
  const minSpeedPxMs = Number(options.minSpeedPxMs) || MIN_SPEED_PX_MS
  const ranked = []

  for (const link of links || []) {
    const rect = link.rect || link
    const url = String(link.url || link.href || '').trim()
    if (!url || !rect) continue

    const proximity = distanceProximityScore(px, py, rect, falloffPx)
    const cx = (rect.left + rect.right) / 2
    const cy = (rect.top + rect.bottom) / 2
    const approachRaw = normalizedApproachDot(samples, cx, cy, px, py, minSpeedPxMs)
    const scores = scorePointerHint(proximity, approachRaw)
    ranked.push({
      url,
      rect,
      ...scores
    })
  }

  ranked.sort((left, right) => right.combined - left.combined)
  return ranked.slice(0, limit)
}

const api = {
  DEFAULT_FALLOFF_PX,
  MIN_SPEED_PX_MS,
  closestPointOnRect,
  distanceProximityScore,
  normalizedApproachDot,
  scorePointerHint,
  rankLinksByPointer
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api
}
if (typeof globalThis !== 'undefined') {
  globalThis.nucleusCanvasPreloadPointer = api
}
if (typeof window !== 'undefined') {
  window.nucleusCanvasPreloadPointer = api
}
})()
