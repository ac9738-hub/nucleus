const test = require('node:test')
const assert = require('node:assert/strict')
const { statusForToolCall, statusForPhase, truncateText } = require('../sidekick-status')

test('statusForToolCall maps retrieval and stage modes', () => {
  assert.match(
    statusForToolCall({ name: 'retrieve_user_context', input: { query: 'CHI108 syllabus sections' } }),
    /Searching Canvas/
  )
  assert.equal(
    statusForToolCall({ name: 'continue_sidekick', input: { mode: 'wait_for_context' } }),
    'Retrieving course context…'
  )
  assert.equal(
    statusForToolCall({ name: 'continue_sidekick', input: { mode: 'tool_use' } }),
    'Opening app tools…'
  )
})

test('statusForPhase exposes live context label', () => {
  assert.equal(statusForPhase('live_context'), 'Reading live context…')
})

test('truncateText shortens long queries', () => {
  const long = 'a'.repeat(80)
  assert.ok(truncateText(long, 20).endsWith('…'))
  assert.ok(truncateText(long, 20).length <= 20)
})
