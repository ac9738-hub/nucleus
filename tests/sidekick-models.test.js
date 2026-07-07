const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeSidekickModel,
  sidekickModelLabel,
  SIDEKICK_DEFAULT_MODEL
} = require('../sidekick-models')

test('normalizeSidekickModel falls back to default', () => {
  assert.equal(normalizeSidekickModel(), SIDEKICK_DEFAULT_MODEL)
  assert.equal(normalizeSidekickModel('invalid'), SIDEKICK_DEFAULT_MODEL)
  assert.equal(normalizeSidekickModel('claude-opus-4-8'), 'claude-opus-4-8')
  assert.equal(normalizeSidekickModel('deepseek-chat'), 'deepseek-chat')
})

test('sidekickModelLabel', () => {
  assert.equal(sidekickModelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5')
  assert.equal(sidekickModelLabel('deepseek-chat'), 'DeepSeek')
})
