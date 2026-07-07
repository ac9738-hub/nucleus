// Compact native app-state index for the sidekick context snapshot.
// Pulls from tasks, canvas_data.json, and active tab / Canvas focus metadata.
// Does not include on-screen text scraping.

const { nucleusNow } = require('./lib/clock')

const UPCOMING_MS = 14 * 24 * 60 * 60 * 1000
const MAX_DUE_SOON = 24
const MAX_TASKS = 40
const MAX_WEEKLY_ITEMS = 12

function cleanSurrogates(value) {
  const text = String(value || '')
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (i + 1 < text.length) {
        const next = text.charCodeAt(i + 1)
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out += text[i] + text[i + 1]
          i += 1
          continue
        }
      }
      out += '\uFFFD'
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      out += '\uFFFD'
    } else {
      out += text[i]
    }
  }
  return out
}

function deepCleanSurrogates(value) {
  if (typeof value === 'string') return cleanSurrogates(value)
  if (Array.isArray(value)) return value.map(deepCleanSurrogates)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      out[cleanSurrogates(key)] = deepCleanSurrogates(entry)
    }
    return out
  }
  return value
}

function courseIdFromUrl(value) {
  try {
    const match = new URL(String(value || '')).pathname.match(/\/courses\/([^/]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  } catch (_error) {
    return ''
  }
}

function collectFocusCourseIds(activeTab, tabs) {
  const ids = new Set()
  const consider = tab => {
    if (!tab || typeof tab !== 'object') return
    if (tab.courseId) ids.add(String(tab.courseId))
    if (tab.url) {
      const fromUrl = courseIdFromUrl(tab.url)
      if (fromUrl) ids.add(fromUrl)
    }
  }
  consider(activeTab)
  for (const tab of tabs || []) consider(tab)
  return ids
}

function compactCourses(canvasData) {
  const courses = canvasData && Array.isArray(canvasData.courses) ? canvasData.courses : []
  return courses.map(course => ({
    id: String(course.id || ''),
    code: String(course.course_code || ''),
    name: String(course.name || '')
  })).filter(entry => entry.id)
}

function compactStudyProgress(task) {
  if (!task || !Array.isArray(task.studySections) || !task.studySections.length) {
    return null
  }
  const total = task.studySections.length
  const completed = (task.studyProgress?.completedSectionIds || []).length
  return {
    completed,
    total,
    remaining: Math.max(0, total - completed)
  }
}

function compactTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks : []
  return list.slice(0, MAX_TASKS).map(task => {
    const entry = {
      id: String(task.id || ''),
      title: String(task.title || ''),
      due: String(task.due || ''),
      course: String(task.course || ''),
      workspaceId: String(task.workspaceId || ''),
      priority: task.priority_weight ?? null,
      source: String(task.source || '')
    }
    const studyProgress = compactStudyProgress(task)
    if (studyProgress) {
      entry.studyProgress = studyProgress
    }
    return entry
  }).filter(entry => entry.id || entry.title)
}

function compactDueSoon(canvasData, focusCourseIds, nowMs = nucleusNow()) {
  const assignmentsByCourse = canvasData && canvasData.assignments ? canvasData.assignments : {}
  const horizon = nowMs + UPCOMING_MS
  const items = []

  for (const [courseid, assignments] of Object.entries(assignmentsByCourse)) {
    if (focusCourseIds.size && !focusCourseIds.has(String(courseid))) continue
    for (const assignment of assignments || []) {
      if (!assignment) continue
      const dueRaw = assignment.due_at || assignment.dueDate || ''
      if (!dueRaw) continue
      const dueMs = Date.parse(dueRaw)
      if (Number.isNaN(dueMs) || dueMs < nowMs - 24 * 60 * 60 * 1000 || dueMs > horizon) continue
      items.push({
        id: String(assignment.id || assignment.assignmentid || ''),
        name: String(assignment.name || ''),
        courseid: String(courseid),
        due_at: String(dueRaw),
        url: String(assignment.html_url || assignment.url || '')
      })
    }
  }

  items.sort((left, right) => Date.parse(left.due_at) - Date.parse(right.due_at))
  return items.slice(0, MAX_DUE_SOON)
}

function compactWeeklyItemNames(items, key = 'name') {
  return (items || [])
    .map(item => {
      if (!item || typeof item !== 'object') return ''
      if (key === 'name') return String(item.name || item.title || '')
      const nested = item.event || item.assignment
      if (nested && nested.name) return String(nested.name)
      return String(item.name || '')
    })
    .filter(Boolean)
    .slice(0, MAX_WEEKLY_ITEMS)
}

function pickWeeklyWeeks(weeks, nowMs = nucleusNow()) {
  const list = Array.isArray(weeks) ? weeks : []
  if (!list.length) return { current: null, next: null }

  let current = list.find(week => week && week.isCurrentWeek) || null
  if (!current) {
    current = list.find(week => {
      const start = Date.parse(week && week.weekStart)
      const end = Date.parse(week && week.weekEnd)
      return !Number.isNaN(start) && !Number.isNaN(end) && nowMs >= start && nowMs <= end + 24 * 60 * 60 * 1000
    }) || null
  }

  let next = null
  if (current) {
    const currentStart = Date.parse(current.weekStart)
    next = list.find(week => {
      const start = Date.parse(week && week.weekStart)
      return !Number.isNaN(start) && start > (Number.isNaN(currentStart) ? nowMs : currentStart)
    }) || null
  } else {
    next = list.find(week => {
      const start = Date.parse(week && week.weekStart)
      return !Number.isNaN(start) && start >= nowMs
    }) || null
  }

  return { current, next }
}

function compactWeeklyWeek(week) {
  if (!week || typeof week !== 'object') return null
  return {
    weekLabel: String(week.weekLabel || ''),
    dateRange: String(week.dateRange || ''),
    weekStart: String(week.weekStart || ''),
    weekEnd: String(week.weekEnd || ''),
    files: compactWeeklyItemNames(week.files),
    assignments: compactWeeklyItemNames(week.assignments),
    events: compactWeeklyItemNames(week.events, 'event')
  }
}

function compactWeeklyFocus(canvasData, focusCourseIds) {
  const schedule = canvasData && canvasData.weekly_schedule ? canvasData.weekly_schedule : {}
  const out = {}

  const courseIds = focusCourseIds.size
    ? [...focusCourseIds]
    : Object.keys(schedule)

  for (const courseid of courseIds) {
    const weeks = schedule[courseid] || schedule[String(courseid)]
    if (!Array.isArray(weeks) || !weeks.length) continue
    const { current, next } = pickWeeklyWeeks(weeks, nucleusNow())
    const entry = {}
    const currentCompact = compactWeeklyWeek(current)
    const nextCompact = compactWeeklyWeek(next)
    if (currentCompact) entry.current = currentCompact
    if (nextCompact) entry.next = nextCompact
    if (Object.keys(entry).length) out[String(courseid)] = entry
  }

  return out
}

function compactCanvasFocus(activeTab) {
  const focus = {}
  if (activeTab && typeof activeTab === 'object') {
    if (activeTab.courseId) focus.courseId = String(activeTab.courseId)
    if (activeTab.courseSection) focus.courseSection = String(activeTab.courseSection)
    if (activeTab.canvasNativePage) focus.nativePage = String(activeTab.canvasNativePage)
    if (activeTab.url) focus.url = String(activeTab.url)
  }
  return Object.keys(focus).length ? focus : null
}

function buildContextIndex({
  tasks = [],
  canvasData = null,
  activeTab = null,
  tabs = [],
  nowMs = nucleusNow()
} = {}) {
  const data = canvasData && typeof canvasData === 'object' ? canvasData : {}
  const focusCourseIds = collectFocusCourseIds(activeTab, tabs)

  return deepCleanSurrogates({
    courses: compactCourses(data),
    tasks: compactTasks(tasks),
    dueSoon: compactDueSoon(data, focusCourseIds, nowMs),
    weekly: compactWeeklyFocus(data, focusCourseIds),
    focus: compactCanvasFocus(activeTab),
    focusCourseIds: [...focusCourseIds]
  })
}

module.exports = {
  buildContextIndex,
  collectFocusCourseIds,
  compactCourses,
  compactTasks,
  compactDueSoon,
  compactWeeklyFocus,
  pickWeeklyWeeks,
  courseIdFromUrl
}
