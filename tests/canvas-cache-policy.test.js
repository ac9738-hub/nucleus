'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  canvasDiskRecoveryEnabled,
  canvasMemoryCacheEnabled,
  parserDiskRecoveryEnabled
} = require('../lib/canvas-cache-policy')

test('canvas cache policy disables disk recovery and caching', () => {
  assert.equal(canvasDiskRecoveryEnabled(), false)
  assert.equal(canvasMemoryCacheEnabled(), false)
  assert.equal(parserDiskRecoveryEnabled(), false)
})
