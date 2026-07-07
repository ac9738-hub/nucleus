'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  distanceProximityScore,
  normalizedApproachDot,
  scorePointerHint,
  rankLinksByPointer
} = require('../../lib/canvas-preload-pointer')

test('distanceProximityScore falls off non-linearly with distance', () => {
  const rect = { left: 100, top: 100, right: 200, bottom: 120 }
  const near = distanceProximityScore(150, 110, rect, 200)
  const far = distanceProximityScore(1000, 1000, rect, 200)
  assert.ok(near > far)
  assert.ok(near > 0.9)
  assert.ok(far < 0.1)
})

test('normalizedApproachDot is 1 when moving directly toward target', () => {
  const samples = [
    { x: 0, y: 0, t: 0 },
    { x: 100, y: 0, t: 100 }
  ]
  const dot = normalizedApproachDot(samples, 200, 0, 100, 0)
  assert.ok(dot > 0.99)
})

test('normalizedApproachDot is near 0 when moving perpendicular', () => {
  const samples = [
    { x: 50, y: 0, t: 0 },
    { x: 150, y: 0, t: 100 }
  ]
  const dot = normalizedApproachDot(samples, 100, 200, 100, 0)
  assert.ok(Math.abs(dot) < 0.05)
})

test('scorePointerHint boosts close aimed motion with squared proximity', () => {
  const aimedClose = scorePointerHint(0.9, 1)
  const aimedFar = scorePointerHint(0.3, 1)
  const idleClose = scorePointerHint(0.9, 0)
  assert.ok(aimedClose.combined > aimedFar.combined)
  assert.ok(aimedClose.combined > idleClose.combined)
})

test('rankLinksByPointer orders closer aimed link first', () => {
  const ranked = rankLinksByPointer([
    {
      url: 'https://canvas.example/a',
      rect: { left: 400, top: 100, right: 500, bottom: 120 }
    },
    {
      url: 'https://canvas.example/b',
      rect: { left: 110, top: 100, right: 180, bottom: 120 }
    }
  ], 100, 110, [
    { x: 80, y: 110, t: 0 },
    { x: 95, y: 110, t: 50 }
  ], { limit: 2 })

  assert.equal(ranked[0].url, 'https://canvas.example/b')
})
