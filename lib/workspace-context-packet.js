// Assembles the workspace context packet shipped with every Sidekick request.

const {
  normalizeSession,
  computeContextHealth,
  GROUNDING_MODE_LABELS,
  CONTEXT_LOCK_LABELS
} = require('./workspace-session')
const {
  resolveFocusCourseIdsForRetrieval,
  buildRetrievalPruneOptions
} = require('./workspace-retrieval-policy')

function buildWorkspaceContextPacket(session, context = {}) {
  const normalized = normalizeSession(session, context.workspaceId || '')
  const tabs = Array.isArray(context.tabs) ? context.tabs : []
  const activeTab = context.activeTab || null
  const allCourseIds = Array.isArray(context.allCourseIds)
    ? context.allCourseIds.map(String).filter(Boolean)
    : []

  const scope = resolveFocusCourseIdsForRetrieval(normalized, { tabs, activeTab, allCourseIds })
  const health = computeContextHealth(normalized, {
    tasks: context.tasks || [],
    tabs,
    activeTab
  })

  const pruneOptions = buildRetrievalPruneOptions(normalized, {
    query: context.query || '',
    tabs,
    activeTab,
    allCourseIds
  })

  return {
    workspaceId: normalized.workspaceId,
    groundingMode: normalized.groundingMode,
    groundingLabel: GROUNDING_MODE_LABELS[normalized.groundingMode] || GROUNDING_MODE_LABELS.workspace_first,
    contextLock: normalized.contextLock,
    contextLockLabel: CONTEXT_LOCK_LABELS[normalized.contextLock] || CONTEXT_LOCK_LABELS.balanced,
    courseScope: {
      primaryCourseIds: [...normalized.courseScope.primaryCourseIds],
      allowOtherCourses: normalized.courseScope.allowOtherCourses !== false
    },
    focus: { ...normalized.focus },
    activeTaskIds: [...normalized.activeTaskIds],
    focusCourseIds: scope.focusCourseIds,
    preferFocus: scope.preferFocus,
    restrictToFocus: scope.restrictToFocus,
    pruneOptions,
    health,
    enabledSources: normalized.enabledSources || {}
  }
}

module.exports = {
  buildWorkspaceContextPacket
}
