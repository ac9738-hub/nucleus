// Sidekick answer mode: grounded (Canvas RAG) vs general knowledge.

const SIDEKICK_ANSWER_GROUNDED = 'grounded'
const SIDEKICK_ANSWER_GENERAL = 'general'

function normalizeAnswerMode(value) {
  return String(value || '').trim().toLowerCase() === SIDEKICK_ANSWER_GENERAL
    ? SIDEKICK_ANSWER_GENERAL
    : SIDEKICK_ANSWER_GROUNDED
}

function isGroundedAnswerMode(value) {
  return normalizeAnswerMode(value) === SIDEKICK_ANSWER_GROUNDED
}

module.exports = {
  SIDEKICK_ANSWER_GROUNDED,
  SIDEKICK_ANSWER_GENERAL,
  normalizeAnswerMode,
  isGroundedAnswerMode
}
