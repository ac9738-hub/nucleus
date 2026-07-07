const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseDiagnosticsConfig,
  parseChannelList,
  sanitizeValue
} = require('../lib/diagnostics')

test('parseDiagnosticsConfig treats all as full channel set', () => {
  const config = parseDiagnosticsConfig({ NUCLEUS_DEBUG: 'all' })
  assert.equal(config.enabled, true)
  assert.equal(config.channels.size, 8)
  assert.equal(config.consoleEnabled, true)
  assert.equal(config.fileEnabled, true)
})

test('parseDiagnosticsConfig honors channel subset', () => {
  const config = parseDiagnosticsConfig({ NUCLEUS_DEBUG: 'render,pool' })
  assert.deepEqual([...config.channels].sort(), ['pool', 'render'])
})

test('parseDiagnosticsConfig stays off by default', () => {
  const config = parseDiagnosticsConfig({})
  assert.equal(config.enabled, false)
})

test('sanitizeValue redacts sensitive keys', () => {
  const value = sanitizeValue({ authCookie: 'secret-value', tabId: 'abc' })
  assert.equal(value.authCookie, '[redacted]')
  assert.equal(value.tabId, 'abc')
})

test('parseChannelList ignores unknown tokens', () => {
  const channels = parseChannelList('render,unknown,pool')
  assert.deepEqual([...channels].sort(), ['pool', 'render'])
})
