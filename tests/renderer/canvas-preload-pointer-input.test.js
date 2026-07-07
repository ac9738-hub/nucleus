'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPointerHintInput } = require('../../lib/canvas-preload-pointer-input')

test('seedPointer resets motion baseline without emitting direction change', () => {
  const input = createPointerHintInput({ minMovePx: 2 })
  input.seedPointer(600, 400)

  const first = input.recordPointerMove(620, 400)
  assert.equal(first.moved, true)
  assert.equal(first.directionChanged, false)

  const second = input.recordPointerMove(640, 400)
  assert.equal(second.moved, true)
  assert.equal(second.directionChanged, false)
})

test('recordPointerMove detects direction change after established motion', () => {
  const input = createPointerHintInput({ minMovePx: 2, directionDotThreshold: 0.5 })
  input.seedPointer(100, 100)

  input.recordPointerMove(120, 100)
  input.recordPointerMove(140, 100)
  const turn = input.recordPointerMove(140, 70)

  assert.equal(turn.moved, true)
  assert.equal(turn.directionChanged, true)
})

test('shouldEmitHints always emits on direction change', () => {
  const input = createPointerHintInput()
  const decision = input.shouldEmitHints({
    topUrl: 'https://canvas.example/courses/1/assignments/2',
    topCombined: 0.4,
    directionChanged: true
  })
  assert.equal(decision.emit, true)
  assert.equal(decision.reason, 'direction')
})
