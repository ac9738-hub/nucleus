const ACTION_VERB_PATTERN = /\b(create|add|delete|remove|open|close|focus|navigate|schedule|mark|move|update|refresh|make|set|rename|duplicate|build|generate|draft)\b/i
const REQUEST_PREFIX_PATTERN = /^(?:please\s+)?(?:can|could|would|will)\s+you\b|^(?:please\s+)?(?:i\s+(?:want|need|would like|would love)\s+(?:you\s+)?to|help\s+me\s+(?:to\s+)?)\b/i
const IMPERATIVE_ACTION_PATTERN = /^(?:please\s+)?(?:create|add|delete|remove|open|close|focus|navigate|schedule|mark|move|update|refresh|make|set|rename|duplicate|build|generate|draft)\b/i
const DATA_TOOL_REQUEST_PATTERN = /\b(?:list|show|get|find|pull up|what(?:'s| is)|when(?:'s| is)|which)\b[\s\S]{0,120}\b(?:my\s+)?(?:canvas|assignments?|deadlines?|due|courses?|files?|modules?|tasks?|workspaces?|tabs?|grades?)\b/i

function normalizeMessageText(messageText) {
  return String(messageText || '').replace(/\s+/g, ' ').trim()
}

function userMessageAllowsToolUse(messageText) {
  const text = normalizeMessageText(messageText)
  if (!text) return false

  if (IMPERATIVE_ACTION_PATTERN.test(text)) return true
  if (REQUEST_PREFIX_PATTERN.test(text) && ACTION_VERB_PATTERN.test(text)) return true
  if (DATA_TOOL_REQUEST_PATTERN.test(text)) return true

  return false
}

module.exports = {
  userMessageAllowsToolUse
}
