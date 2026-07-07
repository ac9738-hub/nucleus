// Sidekick model options (Claude tool/grounded paths).

const SIDEKICK_DEFAULT_MODEL = 'claude-sonnet-4-6'

const SIDEKICK_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'Balanced' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', hint: 'Strongest' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', hint: 'Fastest' },
  { id: 'deepseek-chat', label: 'DeepSeek', hint: 'Fast & economical' }
]

const SIDEKICK_ANSWER_MODES = [
  {
    id: 'grounded',
    label: 'Grounded',
    hint: 'Canvas search & citations'
  },
  {
    id: 'general',
    label: 'General',
    hint: 'Broad knowledge, no RAG'
  }
]

function normalizeSidekickModel(value) {
  const id = String(value || '').trim()
  return SIDEKICK_MODELS.some(model => model.id === id) ? id : SIDEKICK_DEFAULT_MODEL
}

function sidekickModelLabel(modelId) {
  const model = SIDEKICK_MODELS.find(item => item.id === normalizeSidekickModel(modelId))
  return model ? model.label : 'Sonnet 4.6'
}

module.exports = {
  SIDEKICK_DEFAULT_MODEL,
  SIDEKICK_MODELS,
  SIDEKICK_ANSWER_MODES,
  normalizeSidekickModel,
  sidekickModelLabel
}
