// Canvas predictive preload planner (pure functions).
// Scores preload candidates from weekly_schedule, due dates, and DOM links.
// Dependencies: context-index pickWeeklyWeeks / courseIdFromUrl (Node + browser).

(function (root, factory) {
  const graphModule = typeof require !== 'undefined'
    ? require('./canvas-preload-graph')
    : (root.nucleusCanvasPreloadGraph || {})
  const moduleModule = typeof require !== 'undefined'
    ? require('./canvas-preload-modules')
    : (root.nucleusCanvasPreloadModules || {})
  const domModule = typeof require !== 'undefined'
    ? require('./canvas-preload-dom')
    : (root.nucleusCanvasPreloadDom || {})
  const api = factory(
    typeof require !== 'undefined' ? require('../context-index') : root.__nucleusContextIndex || {},
    graphModule,
    moduleModule,
    domModule
  )
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  if (typeof root !== 'undefined') {
    root.nucleusCanvasPreloadPlanner = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCanvasPreloadPlanner(contextIndex, graphModule, moduleModule, domModule) {
  const collectGraphCandidates = graphModule.collectGraphCandidates || (() => [])
  const collectModuleSequenceCandidates = moduleModule.collectModuleSequenceCandidates || (() => [])
  const moduleSequenceScore = moduleModule.moduleSequenceScore || (() => 0)
  const isCanvasPreloadableUrl = domModule.isCanvasPreloadableUrl || (() => true)
  const canonicalCanvasPreloadUrl = domModule.canonicalCanvasPreloadUrl || ((url) => String(url || '').trim())
  const pickWeeklyWeeks = contextIndex.pickWeeklyWeeks || (() => ({ current: null, next: null }))
  const courseIdFromUrl = contextIndex.courseIdFromUrl || (() => '')

  const UPCOMING_MS = 14 * 24 * 60 * 60 * 1000
  const MAX_PER_COURSE = 8

  const WEIGHTS = {
    currentWeek: 0.15,
    nextWeek: 0.08,
    dueUrgency: 0.20,
    domLink: 0.40,
    pointer: 0.35,
    dueSoon: 0.0,
    siblingTab: 0.05,
    graphEvent: 0.12,
    taskMatch: 0.12,
    moduleSequence: 0.10
  }

  function normalizeFocusCourseIds(value) {
    if (!value) return []
    if (value instanceof Set) return [...value].map(String).filter(Boolean)
    if (Array.isArray(value)) return value.map(String).filter(Boolean)
    return [String(value)].filter(Boolean)
  }

  function normalizeCanvasUrl(url) {
    return canonicalCanvasPreloadUrl(url)
  }

  function dueUrgencyScore(dueRaw, nowMs) {
    if (!dueRaw) return 0
    const dueMs = Date.parse(dueRaw)
    if (Number.isNaN(dueMs)) return 0
    const days = (dueMs - nowMs) / (24 * 60 * 60 * 1000)
    if (days < -7) return 0.15
    if (days < 0) return 0.55
    if (days <= 1) return 1
    if (days <= 3) return 0.85
    if (days <= 7) return 0.65
    if (days <= 14) return 0.4
    return 0.2
  }

  function weekAffinityScore(weekKind) {
    if (weekKind === 'current') return WEIGHTS.currentWeek
    if (weekKind === 'next') return WEIGHTS.nextWeek
    return 0
  }

  function domLinkScore(rank) {
    if (rank < 0) return 0
    if (rank === 0) return WEIGHTS.domLink
    if (rank === 1) return WEIGHTS.domLink * 0.72
    if (rank === 2) return WEIGHTS.domLink * 0.48
    return WEIGHTS.domLink * 0.25
  }

  function makeCandidate(fields) {
    return {
      url: fields.url || '',
      courseId: String(fields.courseId || ''),
      kind: fields.kind || 'page',
      source: fields.source || 'weekly',
      priority: 0,
      weekLabel: fields.weekLabel || '',
      dueAt: fields.dueAt || '',
      reason: fields.reason || ''
    }
  }

  function pushCandidate(list, seen, fields) {
    const url = normalizeCanvasUrl(fields.url)
    if (!url || seen.has(url) || !isCanvasPreloadableUrl(url)) return
    seen.add(url)
    list.push(makeCandidate({ ...fields, url }))
  }

  function assignmentUrl(assignment, canvasAssignments, courseId) {
    const direct = assignment && (assignment.url || assignment.html_url)
    if (direct) return direct
    const id = String(assignment && (assignment.assignmentid || assignment.id) || '').trim()
    if (!id || !canvasAssignments) return ''
    const match = (canvasAssignments || []).find(row => (
      String(row.id || row.assignmentid || '') === id
    ))
    return match && (match.html_url || match.url) ? (match.html_url || match.url) : ''
  }

  function fileUrl(file) {
    return file && (file.url || file.canvaspreviewurl || file.downloadurl) || ''
  }

  function collectWeeklyCandidates(canvasData, focusCourseIds, nowMs) {
    const schedule = canvasData && canvasData.weekly_schedule ? canvasData.weekly_schedule : {}
    const assignmentsByCourse = canvasData && canvasData.assignments ? canvasData.assignments : {}
    const courseIds = focusCourseIds.length ? focusCourseIds : Object.keys(schedule)
    const out = []
    const seen = new Set()

    for (const courseId of courseIds) {
      const weeks = schedule[courseId] || schedule[String(courseId)]
      if (!Array.isArray(weeks) || !weeks.length) continue
      const { current, next } = pickWeeklyWeeks(weeks, nowMs)
      const canvasAssignments = assignmentsByCourse[courseId] || assignmentsByCourse[String(courseId)] || []

      const ingestWeek = (week, weekKind, itemCap) => {
        if (!week || typeof week !== 'object') return
        let added = 0
        const weekLabel = String(week.weekLabel || '')

        for (const assignment of week.assignments || []) {
          if (added >= itemCap) break
          const url = assignmentUrl(assignment, canvasAssignments, courseId)
          if (!url) continue
          pushCandidate(out, seen, {
            url,
            courseId,
            kind: 'assignment',
            source: 'weekly',
            weekLabel,
            dueAt: assignment.duedate || assignment.due_at || '',
            reason: `${weekKind}_week_assignment`
          })
          added += 1
        }

        for (const file of week.files || []) {
          if (added >= itemCap) break
          const url = fileUrl(file)
          if (!url) continue
          pushCandidate(out, seen, {
            url,
            courseId,
            kind: 'file',
            source: 'weekly',
            weekLabel,
            reason: `${weekKind}_week_file`
          })
          added += 1
        }

        for (const event of week.events || []) {
          if (added >= itemCap) break
          const nested = event && (event.event || event)
          const url = nested && (nested.url || nested.html_url)
          if (!url) continue
          pushCandidate(out, seen, {
            url,
            courseId,
            kind: 'event',
            source: 'weekly',
            weekLabel,
            dueAt: nested.startdate || nested.due_at || '',
            reason: `${weekKind}_week_event`
          })
          added += 1
        }
      }

      ingestWeek(current, 'current', MAX_PER_COURSE)
      ingestWeek(next, 'next', 4)
    }

    return out
  }

  function collectDueSoonCandidates(canvasData, focusCourseIds, nowMs) {
    const assignmentsByCourse = canvasData && canvasData.assignments ? canvasData.assignments : {}
    const horizon = nowMs + UPCOMING_MS
    const courseIds = focusCourseIds.length ? focusCourseIds : Object.keys(assignmentsByCourse)
    const out = []
    const seen = new Set()

    for (const courseId of courseIds) {
      for (const assignment of assignmentsByCourse[courseId] || assignmentsByCourse[String(courseId)] || []) {
        if (!assignment) continue
        const dueRaw = assignment.due_at || assignment.dueDate || ''
        const dueMs = Date.parse(dueRaw)
        if (Number.isNaN(dueMs) || dueMs < nowMs - 24 * 60 * 60 * 1000 || dueMs > horizon) continue
        const url = assignment.html_url || assignment.url || ''
        pushCandidate(out, seen, {
          url,
          courseId: String(courseId),
          kind: 'assignment',
          source: 'due_soon',
          dueAt: dueRaw,
          reason: 'due_soon_assignment'
        })
      }
    }

    return out
  }

  function collectPointerCandidates(pointerHints, focusCourseIds, activeUrl) {
    const out = []
    const seen = new Set()
    const active = normalizeCanvasUrl(activeUrl)
    const hints = Array.isArray(pointerHints) ? pointerHints : []

    for (const hint of hints) {
      const url = normalizeCanvasUrl(hint && hint.url)
      if (!url || url === active) continue
      const courseId = courseIdFromUrl(url)
      if (focusCourseIds.length && courseId && !focusCourseIds.includes(String(courseId))) {
        continue
      }
      pushCandidate(out, seen, {
        url,
        courseId: courseId || '',
        kind: 'page',
        source: 'pointer',
        reason: 'pointer_hint'
      })
    }

    return out
  }

  function collectDomCandidates(domLinks, focusCourseIds, activeUrl) {
    const out = []
    const seen = new Set()
    const active = normalizeCanvasUrl(activeUrl)
    const links = Array.isArray(domLinks) ? domLinks : []

    links.forEach((link, index) => {
      const url = normalizeCanvasUrl(link)
      if (!url || url === active) return
      const courseId = courseIdFromUrl(url)
      if (focusCourseIds.length && courseId && !focusCourseIds.includes(String(courseId))) {
        return
      }
      pushCandidate(out, seen, {
        url,
        courseId: courseId || '',
        kind: 'page',
        source: 'dom_link',
        reason: `dom_rank_${index}`
      })
    })

    return out
  }

  function taskUrlsFromEntry(task) {
    if (!task || typeof task !== 'object') return []
    return [
      ...(Array.isArray(task.urls) ? task.urls : []),
      task.assignmenturl,
      task.downloadurl,
      task.canvaspreviewurl
    ].map(url => String(url || '').trim()).filter(Boolean)
  }

  function normalizeTaskPriority(weight) {
    const value = Number(weight)
    if (!Number.isFinite(value) || value <= 0) return 0.45
    return Math.min(1, value / 10)
  }

  function buildTaskBoostByUrl(tasks) {
    const map = new Map()
    for (const task of tasks || []) {
      const boost = normalizeTaskPriority(task.priority_weight)
      for (const rawUrl of taskUrlsFromEntry(task)) {
        const url = normalizeCanvasUrl(rawUrl)
        if (!url) continue
        const existing = map.get(url) || 0
        map.set(url, Math.max(existing, boost))
      }
    }
    return map
  }

  function collectTaskCandidates(tasks, focusCourseIds) {
    const focus = new Set((focusCourseIds || []).map(String).filter(Boolean))
    const out = []
    const seen = new Set()

    for (const task of tasks || []) {
      const courseId = String(task.courseId || task.courseid || '').trim()
      if (focus.size && courseId && !focus.has(courseId)) continue

      for (const rawUrl of taskUrlsFromEntry(task)) {
        pushCandidate(out, seen, {
          url: rawUrl,
          courseId,
          kind: 'task',
          source: 'task',
          dueAt: task.due || '',
          reason: `task_${task.id || task.title || 'item'}`
        })
      }
    }

    return out
  }

  function siblingTabScore(courseId, siblingCourseCounts) {
    if (!courseId || !siblingCourseCounts) return 0
    const count = Number(siblingCourseCounts[String(courseId)] || 0)
    if (count >= 2) return WEIGHTS.siblingTab
    if (count >= 1) return WEIGHTS.siblingTab * 0.5
    return 0
  }

  function graphSourceScore(candidate, nowMs) {
    if (!candidate || !candidate.source || !String(candidate.source).startsWith('graph')) {
      return 0
    }
    const urgency = candidate.dueAt ? dueUrgencyScore(candidate.dueAt, nowMs) : 0.55
    return WEIGHTS.graphEvent * urgency
  }

  function scoreCandidates(candidates, options = {}) {
    const nowMs = options.nowMs == null ? Date.now() : options.nowMs
    const domLinks = Array.isArray(options.domLinks) ? options.domLinks : []
    const siblingCourseCounts = options.siblingCourseCounts || null
    const taskBoostByUrl = options.taskBoostByUrl || buildTaskBoostByUrl(options.tasks)
    const domRankByUrl = new Map()
    const pointerByUrl = new Map()
    domLinks.forEach((link, index) => {
      const url = normalizeCanvasUrl(link)
      if (url && !domRankByUrl.has(url)) domRankByUrl.set(url, index)
    })
    for (const hint of options.pointerHints || []) {
      const url = normalizeCanvasUrl(hint && hint.url)
      if (!url || pointerByUrl.has(url)) continue
      pointerByUrl.set(url, hint)
    }

    return (candidates || []).map(candidate => {
      let priority = 0
      if (candidate.reason && candidate.reason.startsWith('current_week')) {
        priority += weekAffinityScore('current')
      } else if (candidate.reason && candidate.reason.startsWith('next_week')) {
        priority += weekAffinityScore('next')
      }
      if (candidate.dueAt) {
        priority += WEIGHTS.dueUrgency * dueUrgencyScore(candidate.dueAt, nowMs)
      }
      if (candidate.source === 'due_soon') {
        priority += WEIGHTS.dueSoon
      }
      const domRank = domRankByUrl.has(candidate.url)
        ? domRankByUrl.get(candidate.url)
        : -1
      priority += domLinkScore(domRank)
      const pointerHint = pointerByUrl.get(candidate.url)
      if (pointerHint) {
        const combined = Number(pointerHint.combined)
        if (Number.isFinite(combined) && combined > 0) {
          priority += WEIGHTS.pointer * combined
        }
      }
      if (candidate.courseId) {
        priority += siblingTabScore(candidate.courseId, siblingCourseCounts)
      }
      priority += graphSourceScore(candidate, nowMs)
      if (candidate.source === 'module_sequence') {
        priority += WEIGHTS.moduleSequence * moduleSequenceScore(candidate)
      }
      if (taskBoostByUrl.has(candidate.url)) {
        priority += WEIGHTS.taskMatch * taskBoostByUrl.get(candidate.url)
      }
      return { ...candidate, priority: Number(priority.toFixed(4)) }
    }).sort((left, right) => right.priority - left.priority)
  }

  function collectCandidates(canvasData, options = {}) {
    const nowMs = options.nowMs == null ? Date.now() : options.nowMs
    const focusCourseIds = normalizeFocusCourseIds(options.focusCourseIds)
    const activeUrl = options.activeUrl || ''

    const weekly = collectWeeklyCandidates(canvasData, focusCourseIds, nowMs)
    const dueSoon = collectDueSoonCandidates(canvasData, focusCourseIds, nowMs)
    const dom = collectDomCandidates(options.domLinks, focusCourseIds, activeUrl)
    const pointer = collectPointerCandidates(options.pointerHints, focusCourseIds, activeUrl)
    const graph = collectGraphCandidates(options.graph, canvasData, {
      focusCourseIds,
      nowMs
    })
    const taskItems = collectTaskCandidates(options.tasks, focusCourseIds)
    const moduleSequence = collectModuleSequenceCandidates(canvasData, focusCourseIds, activeUrl)

    const merged = []
    const seen = new Set()
    for (const list of [weekly, dueSoon, dom, pointer, graph, taskItems, moduleSequence]) {
      for (const candidate of list) {
        if (!candidate.url || seen.has(candidate.url)) continue
        seen.add(candidate.url)
        merged.push(candidate)
      }
    }

    const taskBoostByUrl = buildTaskBoostByUrl(options.tasks)
    return scoreCandidates(merged, {
      nowMs,
      domLinks: options.domLinks || [],
      pointerHints: options.pointerHints || [],
      siblingCourseCounts: options.siblingCourseCounts || null,
      tasks: options.tasks || [],
      taskBoostByUrl
    })
  }

  function planPreloadUrls(canvasData, options = {}) {
    const limit = Math.max(1, Number(options.limit) || 3)
    const activeUrl = normalizeCanvasUrl(options.activeUrl || '')
    const ranked = collectCandidates(canvasData, options)
    return ranked
      .filter(candidate => candidate.url && candidate.url !== activeUrl)
      .slice(0, limit)
  }

  function summarizePlan(candidates) {
    return (candidates || []).map(candidate => ({
      url: candidate.url,
      courseId: candidate.courseId,
      kind: candidate.kind,
      source: candidate.source,
      priority: candidate.priority,
      weekLabel: candidate.weekLabel,
      dueAt: candidate.dueAt,
      reason: candidate.reason
    }))
  }

  return {
    WEIGHTS,
    MAX_PER_COURSE,
    normalizeCanvasUrl,
    collectCandidates,
    planPreloadUrls,
    summarizePlan,
    dueUrgencyScore,
    siblingTabScore,
    collectTaskCandidates,
    buildTaskBoostByUrl
  }
})
