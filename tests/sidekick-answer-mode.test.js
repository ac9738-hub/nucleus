const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeAnswerMode,
  isGroundedAnswerMode,
  SIDEKICK_ANSWER_GENERAL,
  SIDEKICK_ANSWER_GROUNDED
} = require('../sidekick-answer-mode')

test('normalizeAnswerMode defaults to grounded', () => {
  assert.equal(normalizeAnswerMode(), SIDEKICK_ANSWER_GROUNDED)
  assert.equal(normalizeAnswerMode(''), SIDEKICK_ANSWER_GROUNDED)
  assert.equal(normalizeAnswerMode('general'), SIDEKICK_ANSWER_GENERAL)
})

test('isGroundedAnswerMode', () => {
  assert.equal(isGroundedAnswerMode('grounded'), true)
  assert.equal(isGroundedAnswerMode('general'), false)
})
