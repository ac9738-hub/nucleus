'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  canvasDiskRecoveryEnabled,
  canvasMemoryCacheEnabled,
  parserDiskRecoveryEnabled,
  vectorDiskRecoveryEnabled
} = require('../lib/canvas-cache-policy')

test('canvas cache policy disables disk recovery and caching', () => {
  assert.equal(canvasDiskRecoveryEnabled(), false)
  assert.equal(canvasMemoryCacheEnabled(), false)
  assert.equal(parserDiskRecoveryEnabled(), false)
})

test('vector retrieval can read a graph produced in the current session', () => {
  assert.equal(vectorDiskRecoveryEnabled(false), false)
  assert.equal(vectorDiskRecoveryEnabled(true), true)
})
