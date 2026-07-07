// Graph-derived Canvas preload candidates (events, linked files, syllabus assignments).
// Pure functions — no Electron dependencies.

(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  if (typeof root !== 'undefined') {
    root.nucleusCanvasPreloadGraph = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCanvasPreloadGraph() {
  const UPCOMING_MS = 21 * 24 * 60 * 60 * 1000
  const PAST_MS = 3 * 24 * 60 * 60 * 1000
  const MAX_PER_COURSE = 6

  function fileNodeUrl(file) {
    if (!file || typeof file !== 'object') return ''
    return String(
      file.canvaspreviewurl
      || file.downloadurl
      || file.previewurl
      || file.url
      || ''
    ).trim()
  }

  function isCourseHomeUrl(url, courseId) {
    if (!url || !courseId) return false
    try {
      const parsed = new URL(url)
      const normalized = parsed.pathname.replace(/\/+$/, '')
      return normalized === `/courses/${courseId}`
    } catch (_error) {
      return false
    }
  }

  function eventCourseId(event) {
    return String(event && (event.courseid || event.courseId) || '').trim()
  }

  function eventInHorizon(event, nowMs) {
    const startRaw = event && (event.startdate || event.enddate)
    if (!startRaw) return false
    const startMs = Date.parse(startRaw)
    if (Number.isNaN(startMs)) return false
    return startMs >= nowMs - PAST_MS && startMs <= nowMs + UPCOMING_MS
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
  }

  function resolveEventConceptIds(event) {
    if (Array.isArray(event.coveredConcepts) && event.coveredConcepts.length) {
      return event.coveredConcepts.map(entry => String(
        entry && (entry.conceptid || entry.id) || entry || ''
      )).filter(Boolean)
    }
    return (event.dependencies || []).map(id => String(id || '')).filter(Boolean)
  }

  function courseFileMap(graph, courseId) {
    const files = graph && graph.files ? graph.files : {}
    return files[courseId] || files[String(courseId)] || {}
  }

  function collectEventLinkedFileUrls(event, graph, courseId) {
    const urls = []
    const seen = new Set()
    const eventId = String(event.eventid || '')
    const edges = Array.isArray(graph.edges) ? graph.edges : []

    for (const edge of edges) {
      if (edge.fromType !== 'event' || String(edge.fromId) !== eventId || edge.toType !== 'file') {
        continue
      }
      const file = courseFileMap(graph, courseId)[edge.toId] || courseFileMap(graph, courseId)[String(edge.toId)]
      const url = fileNodeUrl(file)
      if (!url || seen.has(url) || isCourseHomeUrl(url, courseId)) continue
      seen.add(url)
      urls.push(url)
    }

    const conceptIds = new Set(resolveEventConceptIds(event))
    if (conceptIds.size) {
      for (const file of Object.values(courseFileMap(graph, courseId))) {
        const fileConcepts = Array.isArray(file.concepts) ? file.concepts.map(String) : []
        if (!fileConcepts.some(id => conceptIds.has(id))) continue
        const url = fileNodeUrl(file)
        if (!url || seen.has(url) || isCourseHomeUrl(url, courseId)) continue
        seen.add(url)
        urls.push(url)
      }
    }

    return urls
  }

  function matchCanvasAssignmentUrl(event, canvasData, courseId) {
    const eventName = normalizeName(event.name)
    if (!eventName) return ''
    const assignments = (
      canvasData
      && canvasData.assignments
      && (canvasData.assignments[courseId] || canvasData.assignments[String(courseId)])
    ) || []

    for (const assignment of assignments) {
      const assignmentName = normalizeName(assignment.name)
      if (!assignmentName) continue
      if (assignmentName.includes(eventName) || eventName.includes(assignmentName)) {
        return assignment.html_url || assignment.url || ''
      }
    }
    return ''
  }

  function collectGraphEventCandidates(graph, canvasData, focusCourseIds, nowMs) {
    const events = Array.isArray(graph && graph.events) ? graph.events : []
    const focus = new Set((focusCourseIds || []).map(String).filter(Boolean))
    const out = []
    const perCourse = {}

    for (const event of events) {
      const courseId = eventCourseId(event)
      if (!courseId) continue
      if (focus.size && !focus.has(courseId)) continue
      if (!eventInHorizon(event, nowMs)) continue

      perCourse[courseId] = perCourse[courseId] || 0
      if (perCourse[courseId] >= MAX_PER_COURSE) continue

      const urls = collectEventLinkedFileUrls(event, graph, courseId)
      const assignmentUrl = matchCanvasAssignmentUrl(event, canvasData, courseId)
      if (assignmentUrl && !urls.includes(assignmentUrl)) {
        urls.unshift(assignmentUrl)
      }

      for (const url of urls) {
        if (perCourse[courseId] >= MAX_PER_COURSE) break
        out.push({
          url,
          courseId,
          kind: 'event',
          source: 'graph_event',
          dueAt: event.startdate || event.enddate || '',
          reason: `graph_event_${event.eventid || event.name || 'event'}`
        })
        perCourse[courseId] += 1
      }
    }

    return out
  }

  function collectGraphSyllabusCandidates(graph, canvasData, focusCourseIds) {
    const syllabi = graph && graph.syllabi ? graph.syllabi : {}
    const focus = new Set((focusCourseIds || []).map(String).filter(Boolean))
    const out = []
    const perCourse = {}

    for (const [courseId, syllabus] of Object.entries(syllabi)) {
      if (focus.size && !focus.has(String(courseId))) continue
      perCourse[courseId] = perCourse[courseId] || 0

      for (const assignment of syllabus.assignments || []) {
        if (perCourse[courseId] >= MAX_PER_COURSE) break
        let url = fileNodeUrl(assignment)
        if (!url) {
          url = matchCanvasAssignmentUrl({ name: assignment.name }, canvasData, courseId)
        }
        if (!url || isCourseHomeUrl(url, courseId)) continue
        out.push({
          url,
          courseId: String(courseId),
          kind: 'assignment',
          source: 'graph_syllabus',
          dueAt: assignment.duedate || assignment.due_at || '',
          reason: 'graph_syllabus_assignment'
        })
        perCourse[courseId] += 1
      }
    }

    return out
  }

  function collectGraphCandidates(graph, canvasData, options = {}) {
    if (!graph || typeof graph !== 'object') return []
    const nowMs = options.nowMs == null ? Date.now() : options.nowMs
    const focusCourseIds = options.focusCourseIds || []
    const events = collectGraphEventCandidates(graph, canvasData, focusCourseIds, nowMs)
    const syllabus = collectGraphSyllabusCandidates(graph, canvasData, focusCourseIds)
    const merged = []
    const seen = new Set()

    for (const list of [events, syllabus]) {
      for (const candidate of list) {
        const url = String(candidate.url || '').trim()
        if (!url || seen.has(url)) continue
        seen.add(url)
        merged.push(candidate)
      }
    }

    return merged
  }

  return {
    UPCOMING_MS,
    collectGraphCandidates,
    collectGraphEventCandidates,
    fileNodeUrl,
    eventInHorizon
  }
})
