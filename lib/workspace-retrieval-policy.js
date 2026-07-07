// Maps workspace session settings to RAG focus scope and catalog pruning behavior.

const {
  normalizeSession,
  collectWorkspaceFocusCourseIds,
  GROUNDING_MODE_LABELS,
  CONTEXT_LOCK_LABELS
} = require('./workspace-session')

const GROUNDING_MODES = new Set(Object.keys(GROUNDING_MODE_LABELS))
const CONTEXT_LOCKS = new Set(Object.keys(CONTEXT_LOCK_LABELS))

function resolveFocusCourseIdsForRetrieval(session, {
  tabs = [],
  activeTab = null,
  allCourseIds = []
} = {}) {
  const normalized = normalizeSession(session)
  const inferred = collectWorkspaceFocusCourseIds(normalized, tabs, activeTab)
  const primary = normalized.courseScope.primaryCourseIds
  const mode = normalized.groundingMode
  const allowOther = normalized.courseScope.allowOtherCourses !== false

  if (mode === 'open_context') {
    return {
      focusCourseIds: [],
      restrictToFocus: false,
      preferFocus: primary.length ? primary : inferred
    }
  }

  if (mode === 'strict_course') {
    const pool = primary.length ? primary : inferred
    return {
      focusCourseIds: pool,
      restrictToFocus: true,
      preferFocus: pool
    }
  }

  if (mode === 'course_first') {
    const pool = primary.length ? primary : inferred
    if (!allowOther && pool.length) {
      return {
        focusCourseIds: pool,
        restrictToFocus: true,
        preferFocus: pool
      }
    }
    return {
      focusCourseIds: pool,
      restrictToFocus: false,
      preferFocus: pool
    }
  }

  // workspace_first
  const pool = primary.length ? primary : inferred
  if (!allowOther && pool.length) {
    return {
      focusCourseIds: pool,
      restrictToFocus: true,
      preferFocus: pool
    }
  }
  return {
    focusCourseIds: pool,
    restrictToFocus: false,
    preferFocus: pool
  }
}

function buildRetrievalPruneOptions(session, {
  query = '',
  tabs = [],
  activeTab = null,
  allCourseIds = []
} = {}) {
  const normalized = normalizeSession(session)
  const scope = resolveFocusCourseIdsForRetrieval(normalized, { tabs, activeTab, allCourseIds })
  const lock = CONTEXT_LOCKS.has(normalized.contextLock) ? normalized.contextLock : 'balanced'
  const restrictToFocus = scope.restrictToFocus || lock === 'strict'

  return {
    query: String(query || ''),
    focusCourseIds: restrictToFocus ? scope.focusCourseIds : scope.focusCourseIds,
    contextLock: lock,
    groundingMode: normalized.groundingMode,
    restrictToFocus,
    allowOtherCourses: normalized.courseScope.allowOtherCourses !== false,
    preferFocus: scope.preferFocus
  }
}

function buildVectorRetrievalScope(session, context = {}) {
  const normalized = normalizeSession(session)
  const scope = resolveFocusCourseIdsForRetrieval(normalized, context)
  const options = { mode: 'agent' }

  if (normalized.groundingMode === 'open_context' && normalized.courseScope.allowOtherCourses !== false) {
    return options
  }

  if (scope.restrictToFocus && scope.focusCourseIds.length) {
    options.focusCourseIds = scope.focusCourseIds
  } else if (scope.preferFocus.length) {
    options.focusCourseIds = scope.preferFocus
  }

  return options
}

function applyGroundingModeConstraints(session, patch = {}) {
  const next = normalizeSession({ ...session, ...patch })
  if (next.groundingMode === 'strict_course') {
    next.courseScope = {
      ...next.courseScope,
      allowOtherCourses: false
    }
  }
  if (next.groundingMode === 'open_context' && patch.courseScope == null) {
    next.courseScope = {
      ...next.courseScope,
      allowOtherCourses: true
    }
  }
  return next
}

module.exports = {
  GROUNDING_MODES,
  CONTEXT_LOCKS,
  resolveFocusCourseIdsForRetrieval,
  buildRetrievalPruneOptions,
  buildVectorRetrievalScope,
  applyGroundingModeConstraints
}
