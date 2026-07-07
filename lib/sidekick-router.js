// Fast sidekick intent routing — mirrors sidekick_router.py for zero-latency main-process use.

const TOOL_VERB_PATTERN = /\b(create|add|delete|remove|open|close|focus|navigate|schedule|mark|move|update|refresh|make|set|rename|duplicate|build|generate|draft)\b/i
const APP_DATA_PATTERN = /\b(my tasks?|assignments? due|what(?:'s| is) due|deadlines?|upcoming|grades?|classes today|show my|list my|how am i doing|due tomorrow|due this week|canvas courses?|my courses?)\b/i
const CANVAS_CONTENT_PATTERN = /\b(syllabus|lecture|slides?|readings?|exam|midterm|final|pset|problem sets?|homework|notes on|study guide|module|office hours?|section|quiz|quizzes|diagnostic)\b/i
const SCHEDULE_QUERY_PATTERN = /\b(when(?:'s| is)|what(?:'s| is) due|due date|how long until)\b/i
const QUIZ_ASSIGNMENT_PATTERN = /\b(quiz|quizzes|diagnostic|assignment|assignments|pset|problem sets?|homework|tests?)\b/i
const COURSE_CODE_PATTERN = /\b[A-Z]{2,4}\s*\d{3}[A-Z]?\b/i
const MY_SCHEDULE_PATTERN = /\bmy\b/i
const GENERAL_CHAT_PATTERN = /\b(explain|what is|what are|how does|how do|why|define|summarize|help me understand|tell me about|difference between|compare)\b/i
const SCREEN_PATTERN = /\b(on my screen|this page|what(?:'s| is) (?:here|visible|showing)|currently (?:on|viewing)|what am i looking at)\b/i
const COURSE_HINT_PATTERN = /\b(course|canvas|class)\b/i
const PROBLEM_QUERY_PATTERN = /\b(help me (?:with|on|solve)|i(?:'m| am) stuck(?: on)?|how (?:do|can|should) i (?:solve|approach|start|do|work)|(?:walk|talk) me through|(?:give me )?(?:a )?hint(?: for)?|solve (?:this|the|problem|question|exercise)|(?:practice |worked )?(?:problem|exercise|question)\s*#?\d+|(?:problem|question|exercise)\s*#?\d+|pset\s*\d+\s*(?:q|question|problem)\s*\d+|approach (?:this|the) (?:problem|question))\b/i

const SidekickRoute = {
  TOOL: 'tool',
  DATA: 'data',
  CHAT: 'chat',
  FALLBACK: 'fallback'
}

function isGroundedExplanation(text) {
  return GENERAL_CHAT_PATTERN.test(String(text || ''))
}

function isProblemQuery(text) {
  return PROBLEM_QUERY_PATTERN.test(String(text || ''))
}

function needsRetrieval(route, text, hints = {}) {
  const lowered = String(text || '').trim()
  if (!lowered) return false
  if (route === SidekickRoute.TOOL) return false
  if (isProblemQuery(lowered)) return true
  if (route === SidekickRoute.CHAT) {
    if (!isGroundedExplanation(lowered)) return false
    // Always retrieve for explanation-style queries so answers can ground in course material.
    return true
  }
  if (route === SidekickRoute.DATA) {
    if (SCREEN_PATTERN.test(lowered)) return false
    if (SCHEDULE_QUERY_PATTERN.test(lowered) && MY_SCHEDULE_PATTERN.test(lowered)) return false
    if (APP_DATA_PATTERN.test(lowered) && !CANVAS_CONTENT_PATTERN.test(lowered)) return false
    return CANVAS_CONTENT_PATTERN.test(lowered) || COURSE_HINT_PATTERN.test(lowered)
  }
  if (route === SidekickRoute.FALLBACK) {
    if (lowered.split(/\s+/).length <= 4
      && !CANVAS_CONTENT_PATTERN.test(lowered)
      && !COURSE_HINT_PATTERN.test(lowered)
      && !isProblemQuery(lowered)) {
      return false
    }
    return true
  }
  return false
}

function classifySidekickMessage(text, options = {}) {
  const lowered = String(text || '').trim()
  const hasAttachments = Boolean(options.hasAttachments)
  const hints = {
    hasCourseFocus: Boolean(options.hasCourseFocus),
    hasScreenChunks: Boolean(options.hasScreenChunks)
  }

  if (!lowered) {
    return { route: SidekickRoute.FALLBACK, confidence: 0, needsRetrieval: false, reason: 'empty_message', groundedExplain: false, problemQuery: false }
  }

  if (hasAttachments) {
    if (TOOL_VERB_PATTERN.test(lowered)) {
      return { route: SidekickRoute.TOOL, confidence: 0.95, needsRetrieval: false, reason: 'attachment_with_tool_verb', groundedExplain: false, problemQuery: false }
    }
    return { route: SidekickRoute.FALLBACK, confidence: 0.7, needsRetrieval: false, reason: 'attachment_review', groundedExplain: false, problemQuery: false }
  }

  if (SCREEN_PATTERN.test(lowered)) {
    return { route: SidekickRoute.DATA, confidence: 0.88, needsRetrieval: false, reason: 'screen_context', groundedExplain: false, problemQuery: false }
  }

  if (SCHEDULE_QUERY_PATTERN.test(lowered) && MY_SCHEDULE_PATTERN.test(lowered)) {
    const route = SidekickRoute.DATA
    return {
      route,
      confidence: 0.86,
      needsRetrieval: needsRetrieval(route, lowered, hints),
      reason: 'personal_schedule',
      groundedExplain: false,
      problemQuery: false
    }
  }

  const toolHits = (lowered.match(TOOL_VERB_PATTERN) || []).length
  const appHit = APP_DATA_PATTERN.test(lowered)
  const canvasHit = CANVAS_CONTENT_PATTERN.test(lowered)
  const generalHit = GENERAL_CHAT_PATTERN.test(lowered)
  const problemHit = isProblemQuery(lowered)

  if (problemHit && !(toolHits && !appHit)) {
    const route = SidekickRoute.CHAT
    return {
      route,
      confidence: Math.min(0.88, 0.72 + (canvasHit ? 0.08 : 0) + (hints.hasCourseFocus ? 0.06 : 0)),
      needsRetrieval: needsRetrieval(route, lowered, hints),
      reason: 'problem_solve',
      groundedExplain: false,
      problemQuery: true
    }
  }

  if (generalHit && isGroundedExplanation(lowered)) {
    const route = SidekickRoute.CHAT
    return {
      route,
      confidence: Math.min(0.9, 0.75),
      needsRetrieval: needsRetrieval(route, lowered, hints),
      reason: 'grounded_explain',
      groundedExplain: true,
      problemQuery: problemHit
    }
  }

  if (toolHits && !appHit) {
    return {
      route: SidekickRoute.TOOL,
      confidence: Math.min(0.96, 0.62 + toolHits * 0.15),
      needsRetrieval: false,
      reason: 'tool_verbs',
      groundedExplain: false,
      problemQuery: false
    }
  }

  if (appHit || canvasHit) {
    const route = SidekickRoute.DATA
    const confidence = Math.min(0.94, 0.58 + (appHit ? 0.18 : 0) + (canvasHit ? 0.16 : 0))
    return {
      route,
      confidence,
      needsRetrieval: needsRetrieval(route, lowered, hints),
      reason: 'app_or_canvas_data',
      groundedExplain: generalHit,
      problemQuery: false
    }
  }

  if (SCHEDULE_QUERY_PATTERN.test(lowered)
    && (MY_SCHEDULE_PATTERN.test(lowered)
      || COURSE_CODE_PATTERN.test(lowered)
      || QUIZ_ASSIGNMENT_PATTERN.test(lowered))) {
    const route = SidekickRoute.DATA
    return {
      route,
      confidence: MY_SCHEDULE_PATTERN.test(lowered) ? 0.86 : 0.78,
      needsRetrieval: needsRetrieval(route, lowered, hints),
      reason: 'schedule_query',
      groundedExplain: false,
      problemQuery: false
    }
  }

  const route = SidekickRoute.FALLBACK
  return {
    route,
    confidence: 0.35,
    needsRetrieval: needsRetrieval(route, lowered, hints),
    reason: 'low_confidence',
    groundedExplain: false,
    problemQuery: problemHit
  }
}

function chooseModelRoute(decision, minConfidence = 0.55) {
  if (!decision) return SidekickRoute.FALLBACK
  if (decision.route === SidekickRoute.FALLBACK) return SidekickRoute.FALLBACK
  if (decision.confidence < minConfidence) return SidekickRoute.FALLBACK
  return decision.route
}

module.exports = {
  SidekickRoute,
  classifySidekickMessage,
  chooseModelRoute,
  needsRetrieval,
  isGroundedExplanation,
  isProblemQuery
}
