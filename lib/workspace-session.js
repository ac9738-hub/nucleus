// Workspace session schema, defaults, and helpers for the Control Center.
// Shared by main (persistence + context) and renderer (UI).

const MAX_RECENT_ACTIVITY = 50

const GROUNDING_MODE_LABELS = {
  strict_course: 'Strict Course',
  course_first: 'Course First',
  workspace_first: 'Workspace First',
  open_context: 'Open Context'
}

const CONTEXT_LOCK_LABELS = {
  soft: 'Soft',
  balanced: 'Balanced',
  strict: 'Strict'
}

const HEALTH_LABELS = {
  strong: 'Strong',
  medium: 'Medium',
  weak: 'Weak'
}

const GROUNDING_MODES = new Set(Object.keys(GROUNDING_MODE_LABELS))
const CONTEXT_LOCKS = new Set(Object.keys(CONTEXT_LOCK_LABELS))

function courseIdFromUrl(value) {
  try {
    const match = new URL(String(value || '')).pathname.match(/\/courses\/([^/]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  } catch (_error) {
    return ''
  }
}

function createDefaultSession(workspaceId = '') {
  return {
    workspaceId: String(workspaceId || ''),
    focus: {
      courseId: null,
      assignmentId: null,
      goal: null,
      dueAt: null
    },
    groundingMode: 'workspace_first',
    contextLock: 'balanced',
    courseScope: {
      primaryCourseIds: [],
      allowOtherCourses: true
    },
    enabledSources: {},
    contextStack: [],
    tabContext: {},
    activeTaskIds: [],
    sessionStartedAt: new Date().toISOString(),
    recentActivity: [],
    memory: {
      pinnedResourceIds: [],
      recentConcepts: [],
      lastGroundingMode: 'workspace_first',
      lastAssignmentId: null
    }
  }
}

function normalizeSession(session, workspaceId = '') {
  const base = createDefaultSession(workspaceId)
  if (!session || typeof session !== 'object') return base

  const tabContext = {}
  if (session.tabContext && typeof session.tabContext === 'object') {
    for (const [tabId, entry] of Object.entries(session.tabContext)) {
      if (!tabId) continue
      tabContext[String(tabId)] = {
        includeInContext: entry && entry.includeInContext !== false
      }
    }
  }

  const groundingMode = GROUNDING_MODES.has(session.groundingMode)
    ? session.groundingMode
    : base.groundingMode
  const contextLock = CONTEXT_LOCKS.has(session.contextLock)
    ? session.contextLock
    : base.contextLock

  return {
    ...base,
    ...session,
    workspaceId: String(session.workspaceId || workspaceId || ''),
    groundingMode,
    contextLock,
    focus: {
      ...base.focus,
      ...(session.focus && typeof session.focus === 'object' ? session.focus : {})
    },
    courseScope: {
      ...base.courseScope,
      ...(session.courseScope && typeof session.courseScope === 'object' ? session.courseScope : {}),
      primaryCourseIds: Array.isArray(session.courseScope && session.courseScope.primaryCourseIds)
        ? session.courseScope.primaryCourseIds.map(String).filter(Boolean)
        : [],
      allowOtherCourses: groundingMode === 'strict_course'
        ? false
        : !(session.courseScope && session.courseScope.allowOtherCourses === false)
    },
    tabContext,
    activeTaskIds: Array.isArray(session.activeTaskIds)
      ? session.activeTaskIds.map(String).filter(Boolean)
      : [],
    recentActivity: Array.isArray(session.recentActivity)
      ? session.recentActivity.slice(0, MAX_RECENT_ACTIVITY)
      : [],
    memory: {
      ...base.memory,
      ...(session.memory && typeof session.memory === 'object' ? session.memory : {})
    }
  }
}

function mergeSessionPatch(session, patch, workspaceId = '') {
  const current = normalizeSession(session, workspaceId)
  if (!patch || typeof patch !== 'object') return current

  const next = normalizeSession({
    ...current,
    ...patch,
    focus: patch.focus ? { ...current.focus, ...patch.focus } : current.focus,
    courseScope: patch.courseScope
      ? { ...current.courseScope, ...patch.courseScope }
      : current.courseScope,
    memory: patch.memory ? { ...current.memory, ...patch.memory } : current.memory,
    tabContext: patch.tabContext
      ? { ...current.tabContext, ...patch.tabContext }
      : current.tabContext
  }, workspaceId)

  return next
}

function defaultTabIncludeInContext(tab) {
  if (!tab || typeof tab !== 'object') return true
  if (tab.type === 'center') return false
  if (tab.type === 'mailtab') return false
  return true
}

function isTabIncludedInContext(session, tabId) {
  const normalized = normalizeSession(session)
  const key = String(tabId || '')
  if (!key) return true
  const entry = normalized.tabContext[key]
  if (!entry) return true
  return entry.includeInContext !== false
}

function setTabIncludeInContext(session, tabId, includeInContext, tab) {
  const normalized = normalizeSession(session)
  const key = String(tabId || '')
  if (!key) return normalized

  const include = Boolean(includeInContext)
  const defaultInclude = tab ? defaultTabIncludeInContext(tab) : true
  const tabContext = { ...normalized.tabContext }

  if (include === defaultInclude) {
    delete tabContext[key]
  } else {
    tabContext[key] = { includeInContext: include }
  }

  return mergeSessionPatch(normalized, { tabContext }, normalized.workspaceId)
}

function collectWorkspaceFocusCourseIds(session, tabs, activeTab) {
  const normalized = normalizeSession(session)
  const ids = new Set()

  if (normalized.focus && normalized.focus.courseId) {
    ids.add(String(normalized.focus.courseId))
  }

  if (normalized.courseScope.primaryCourseIds.length) {
    normalized.courseScope.primaryCourseIds.forEach(id => ids.add(String(id)))
  }

  const consider = tab => {
    if (!tab || typeof tab !== 'object') return
    if (!isTabIncludedInContext(normalized, tab.id)) return
    if (tab.courseId) ids.add(String(tab.courseId))
    if (tab.url) {
      const fromUrl = courseIdFromUrl(tab.url)
      if (fromUrl) ids.add(fromUrl)
    }
  }

  consider(activeTab)
  for (const tab of tabs || []) consider(tab)

  return [...ids]
}

function recordActivity(session, event, workspaceId = '') {
  const normalized = normalizeSession(session, workspaceId)
  const type = String(event && event.type || '').trim()
  const label = String(event && event.label || '').trim()
  if (!type || !label) return normalized

  const entry = {
    at: new Date().toISOString(),
    type,
    label
  }
  if (event && event.ref) entry.ref = event.ref

  const recentActivity = [entry, ...normalized.recentActivity].slice(0, MAX_RECENT_ACTIVITY)
  return mergeSessionPatch(normalized, { recentActivity }, normalized.workspaceId)
}

function computeContextHealth(session, context = {}) {
  const normalized = normalizeSession(session)
  const tasks = Array.isArray(context.tasks) ? context.tasks : []
  const tabs = Array.isArray(context.tabs) ? context.tabs : []
  const workspaceId = normalized.workspaceId

  const workspaceTasks = tasks.filter(task => String(task.workspaceId || '') === workspaceId)
  const activeTask = workspaceTasks.find(task => normalized.activeTaskIds.includes(String(task.id)))
    || workspaceTasks[0]
    || null

  const openTabs = tabs.filter(tab =>
    tab
    && tab.workspaceId === workspaceId
    && tab.type !== 'center'
    && isTabIncludedInContext(normalized, tab.id)
  )

  const reasons = []
  let score = 0

  if (activeTask) {
    score += 30
    reasons.push('Assignment loaded')
  } else {
    reasons.push('Assignment missing')
  }

  const hasLectureOrFile = openTabs.some(tab =>
    tab.type === 'artifacttab'
    || (tab.type === 'canvastab' && tab.canvasMode === 'browser')
    || (tab.type === 'browsertab' && /\.pdf($|\?)/i.test(String(tab.url || '')))
  )
  if (hasLectureOrFile) {
    score += 25
    reasons.push('Lecture loaded')
  } else {
    reasons.push('Lecture missing')
  }

  if (openTabs.length) {
    score += 20
    reasons.push(`${openTabs.length} open page${openTabs.length === 1 ? '' : 's'}`)
  } else {
    reasons.push('No open pages')
  }

  const focusCourseIds = collectWorkspaceFocusCourseIds(normalized, tabs, context.activeTab)
  if (focusCourseIds.length) {
    score += 15
    reasons.push('Course selected')
  }

  if (activeTask && Array.isArray(activeTask.studySections) && activeTask.studySections.length) {
    score += 10
    reasons.push('Study plan loaded')
  }

  let level = 'weak'
  if (score >= 70) level = 'strong'
  else if (score >= 40) level = 'medium'

  return {
    level,
    label: HEALTH_LABELS[level] || 'Weak',
    score,
    reasons
  }
}

function resolveOverview(session, context = {}) {
  const normalized = normalizeSession(session)
  const workspace = context.workspace || {}
  const tasks = Array.isArray(context.tasks) ? context.tasks : []
  const tabs = Array.isArray(context.tabs) ? context.tabs : []
  const canvasData = context.canvasData && typeof context.canvasData === 'object'
    ? context.canvasData
    : { courses: [] }
  const workspaceId = normalized.workspaceId || workspace.id || ''

  const workspaceTasks = tasks.filter(task => String(task.workspaceId || '') === workspaceId)
  const activeTask = workspaceTasks.find(task => normalized.activeTaskIds.includes(String(task.id)))
    || workspaceTasks.find(task => !String(task.status || '').match(/done|complete|finished/i))
    || workspaceTasks[0]
    || null

  let courseId = normalized.focus.courseId
  if (!courseId && activeTask && (activeTask.courseId || activeTask.course)) {
    courseId = String(activeTask.courseId || '').trim()
      || String(activeTask.course || '').replace(/^Canvas\s+/i, '').trim()
  }
  if (!courseId) {
    const focusIds = collectWorkspaceFocusCourseIds(normalized, tabs, context.activeTab)
    courseId = focusIds[0] || null
  }

  const courses = Array.isArray(canvasData.courses) ? canvasData.courses : []
  const course = courses.find(item => String(item.id) === String(courseId))
  const courseLabel = course
    ? (course.course_code || course.name || `Course ${course.id}`)
    : (courseId ? `Course ${courseId}` : 'No course selected')

  const health = computeContextHealth(normalized, {
    tasks,
    tabs,
    activeTab: context.activeTab
  })

  return {
    workspaceName: workspace.name || workspaceId || 'Workspace',
    courseLabel,
    courseId,
    assignmentLabel: activeTask ? (activeTask.title || 'Untitled task') : 'No active assignment',
    goal: normalized.focus.goal || (activeTask && activeTask.details
      ? String(activeTask.details).slice(0, 96)
      : 'Set a goal for this session'),
    dueAt: normalized.focus.dueAt || (activeTask && activeTask.due ? activeTask.due : null),
    groundingLabel: GROUNDING_MODE_LABELS[normalized.groundingMode] || GROUNDING_MODE_LABELS.workspace_first,
    lockLabel: CONTEXT_LOCK_LABELS[normalized.contextLock] || CONTEXT_LOCK_LABELS.balanced,
    health,
    activeTask
  }
}

function tabKindLabel(tab) {
  if (!tab) return 'Tab'
  if (tab.type === 'canvastab') return tab.canvasMode === 'browser' ? 'Canvas page' : 'Canvas'
  if (tab.type === 'synapsetab') return 'Synapse'
  if (tab.type === 'mailtab') return 'Mail'
  if (tab.type === 'artifacttab') return 'Artifact'
  if (tab.type === 'browsertab') return 'Browser'
  if (tab.type === 'task') return 'Task'
  if (tab.type === 'center') return 'Control Center'
  return 'Workspace'
}

const api = {
  MAX_RECENT_ACTIVITY,
  GROUNDING_MODE_LABELS,
  GROUNDING_MODES,
  CONTEXT_LOCK_LABELS,
  CONTEXT_LOCKS,
  HEALTH_LABELS,
  courseIdFromUrl,
  createDefaultSession,
  normalizeSession,
  mergeSessionPatch,
  defaultTabIncludeInContext,
  isTabIncludedInContext,
  setTabIncludeInContext,
  collectWorkspaceFocusCourseIds,
  recordActivity,
  computeContextHealth,
  resolveOverview,
  tabKindLabel
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api
}

if (typeof globalThis !== 'undefined') {
  globalThis.NucleusWorkspaceSession = api
}
