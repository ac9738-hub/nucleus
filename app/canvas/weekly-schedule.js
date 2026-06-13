// Weekly schedule date resolution and bucket helpers for Canvas course views.
const { startOfWeek, addWeeks, isSameWeek, differenceInCalendarWeeks } = require('date-fns')

const WEEK_OPTIONS = { weekStartsOn: 1 }

function startOfWeekMs(dateStr) {
  if (!dateStr) return null

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return null

  return startOfWeek(date, WEEK_OPTIONS).getTime()
}

function firstValidSchedulingDate(candidates) {
  for (const dateStr of candidates) {
    if (dateStr && startOfWeekMs(dateStr) != null) {
      return String(dateStr)
    }
  }
  return ''
}

function normalizeRegistryUrl(url) {
  const text = String(url || '').trim()
  if (!text) return ''

  try {
    const parsed = new URL(text)
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return text.replace(/\/$/, '')
  }
}

// Pass 1 — Canvas data: due_at → unlock_at → lock_at
function resolveCanvasSchedulingDate(canvasEntity) {
  if (!canvasEntity) return ''
  return firstValidSchedulingDate([
    canvasEntity.due_at,
    canvasEntity.unlock_at,
    canvasEntity.lock_at
  ])
}

function resolveCanvasWeekMs(canvasEntity) {
  const dateStr = resolveCanvasSchedulingDate(canvasEntity)
  return dateStr ? startOfWeekMs(dateStr) : null
}

// Pass 2 — Parsed assignment data: duedate → unlockdate → lockdate
function resolveParsedSchedulingDate(parsedAssignment) {
  if (!parsedAssignment) return ''
  return firstValidSchedulingDate([
    parsedAssignment.duedate,
    parsedAssignment.unlockdate,
    parsedAssignment.lockdate
  ])
}

function resolveParsedWeekMs(parsedAssignment) {
  const dateStr = resolveParsedSchedulingDate(parsedAssignment)
  return dateStr ? startOfWeekMs(dateStr) : null
}

function resolveSchedulingDate(loggedAssignment, canvasAssignment) {
  const canvasDate = resolveCanvasSchedulingDate(canvasAssignment)
  if (canvasDate) return canvasDate
  return resolveParsedSchedulingDate(loggedAssignment)
}

function resolveWeekStartMs(loggedAssignment, canvasAssignment, moduleAnchorWeekMs = null) {
  const canvasWeek = resolveCanvasWeekMs(canvasAssignment)
  if (canvasWeek != null) return canvasWeek

  const parsedWeek = resolveParsedWeekMs(loggedAssignment)
  if (parsedWeek != null) return parsedWeek

  if (moduleAnchorWeekMs != null) return moduleAnchorWeekMs
  return null
}

function isAssignmentModuleItem(item) {
  const type = String(item && item.type || '').toLowerCase()
  return type === 'assignment' || type === 'quiz' || type === 'discussion'
}

function buildParsedAssignmentLookup(loggedAssignments) {
  const lookup = new Map()
  ;(loggedAssignments || []).forEach(assignment => {
    const id = String(assignment.assignmentid || '').trim()
    if (id) lookup.set(id, assignment)
  })
  return lookup
}

function buildNormalizedUrlToNode(urlToNode) {
  const normalized = {}
  Object.entries(urlToNode || {}).forEach(([url, ref]) => {
    const key = normalizeRegistryUrl(url)
    if (key && ref) normalized[key] = ref
  })
  return normalized
}

function collectItemUrls(moduleItem, canvasAssignment, loggedAssignment, canvasFile) {
  const urls = []
  const push = value => {
    const normalized = normalizeRegistryUrl(value)
    if (normalized && !urls.includes(normalized)) urls.push(normalized)
  }

  push(moduleItem && moduleItem.html_url)
  push(moduleItem && moduleItem.url)
  push(canvasAssignment && canvasAssignment.html_url)
  push(loggedAssignment && loggedAssignment.canvaspreviewurl)
  push(loggedAssignment && loggedAssignment.downloadurl)
  push(canvasFile && canvasFile.url)
  push(canvasFile && canvasFile.previewurl)
  return urls
}

function findParsedAssignmentByUrls(urls, urlToNode, parsedById, courseId) {
  for (const url of urls || []) {
    const ref = urlToNode[normalizeRegistryUrl(url)]
    if (!ref || ref.type !== 'assignment') continue
    if (String(ref.courseid) !== String(courseId)) continue

    const assignment = parsedById.get(String(ref.nodeId))
    if (assignment) return assignment
  }
  return null
}

function createScheduleItem(data) {
  return {
    kind: data.kind,
    key: data.key,
    position: Number(data.position || 0),
    moduleId: String(data.moduleId || ''),
    modulePosition: Number(data.modulePosition || 0),
    weekStartMs: null,
    urls: data.urls || [],
    canvasEntity: data.canvasEntity || null,
    parsedAssignment: data.parsedAssignment || null,
    moduleItem: data.moduleItem || null,
    loggedAssignment: data.loggedAssignment || null,
    canvasAssignment: data.canvasAssignment || null,
    filePayload: data.filePayload || null,
    compactAssignment: data.compactAssignment || null
  }
}

function applyPass1CanvasDates(items) {
  items.forEach(item => {
    if (item.weekStartMs != null) return
    item.weekStartMs = resolveCanvasWeekMs(item.canvasEntity)
  })
}

function applyPass2ParsedDates(items, urlToNode, parsedById, courseId) {
  items.forEach(item => {
    if (item.weekStartMs != null) return

    const urlResolved = findParsedAssignmentByUrls(item.urls, urlToNode, parsedById, courseId)
    const parsedCandidates = []
    if (item.parsedAssignment) parsedCandidates.push(item.parsedAssignment)
    if (urlResolved && urlResolved !== item.parsedAssignment) parsedCandidates.push(urlResolved)
    if (!parsedCandidates.length && urlResolved) parsedCandidates.push(urlResolved)

    for (const parsed of parsedCandidates) {
      const weekMs = resolveParsedWeekMs(parsed)
      if (weekMs != null) {
        item.weekStartMs = weekMs
        break
      }
    }
  })
}

function applyPass3ModuleClustering(modules, itemsByModule) {
  modules.forEach(module => {
    const moduleId = String(module.id)
    const items = (itemsByModule.get(moduleId) || [])
      .slice()
      .sort((left, right) => left.position - right.position)

    let anchorWeekMs = null
    for (const item of items) {
      if (item.kind === 'assignment' && item.weekStartMs != null) {
        anchorWeekMs = item.weekStartMs
        break
      }
    }
    if (anchorWeekMs == null) {
      for (const item of items) {
        if (item.kind === 'file' && item.weekStartMs != null) {
          anchorWeekMs = item.weekStartMs
          break
        }
      }
    }
    if (anchorWeekMs == null) return

    items.forEach(item => {
      if (item.weekStartMs == null) item.weekStartMs = anchorWeekMs
    })
  })
}

const WEEK_NAME_PATTERNS = [
  /^week\s*(\d+)\b/i,
  /\bweek\s*(\d+)\b/i,
  /^wk\s*(\d+)\b/i,
  /^module\s*(\d+)\b/i,
  /^unit\s*(\d+)\b/i,
  /^(\d+)\s*[-–—]\s*week\b/i
]

function normalizeWeekLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-–—]/g, ' ')
    .replace(/\s+/g, ' ')
}

function extractWeekNumberFromName(name) {
  const normalized = normalizeWeekLabel(name)
  if (!normalized) return null

  for (const pattern of WEEK_NAME_PATTERNS) {
    const match = normalized.match(pattern)
    if (match) {
      const weekNumber = Number.parseInt(match[1], 10)
      if (Number.isFinite(weekNumber) && weekNumber > 0) return weekNumber
    }
  }

  const fuzzyWeekMatch = normalized.match(/\b(?:week|wk)\b.*?(\d+)\b/)
  if (fuzzyWeekMatch) {
    const weekNumber = Number.parseInt(fuzzyWeekMatch[1], 10)
    if (Number.isFinite(weekNumber) && weekNumber > 0) return weekNumber
  }

  return null
}

function weekStartFromSetPoint(targetWeekNumber, setPoints) {
  if (!setPoints.length) return null

  const exact = setPoints.find(point => point.weekNumber === targetWeekNumber)
  if (exact) return exact.weekStartMs

  const nearest = setPoints.reduce((best, point) => {
    const bestDistance = Math.abs(best.weekNumber - targetWeekNumber)
    const pointDistance = Math.abs(point.weekNumber - targetWeekNumber)
    return pointDistance < bestDistance ? point : best
  })

  const weekDiff = targetWeekNumber - nearest.weekNumber
  return startOfWeek(addWeeks(new Date(nearest.weekStartMs), weekDiff), WEEK_OPTIONS).getTime()
}

function applyPass4WeekNameMatching(modules, itemsByModule) {
  const setPoints = []

  modules.forEach(module => {
    const weekNumber = extractWeekNumberFromName(module.name)
    if (weekNumber == null) return

    const items = itemsByModule.get(String(module.id)) || []
    for (const item of items) {
      if (item.kind !== 'assignment' || item.weekStartMs == null) continue
      setPoints.push({
        weekNumber,
        weekStartMs: item.weekStartMs,
        moduleId: String(module.id)
      })
      break
    }
  })

  if (!setPoints.length) return

  setPoints.sort((left, right) => left.weekNumber - right.weekNumber)

  modules.forEach(module => {
    const weekNumber = extractWeekNumberFromName(module.name)
    if (weekNumber == null) return

    const items = itemsByModule.get(String(module.id)) || []
    const targetWeekMs = weekStartFromSetPoint(weekNumber, setPoints)
    if (targetWeekMs == null) return

    items.forEach(item => {
      if (item.weekStartMs == null) item.weekStartMs = targetWeekMs
    })
  })
}

function resolveModuleAnchorWeekMs(items, courseId, loggedAssignments, lookup, matchLoggedAssignment) {
  const parsedById = buildParsedAssignmentLookup(loggedAssignments)

  for (const item of items) {
    if (!isAssignmentModuleItem(item)) continue

    const canvasAssignment = lookup.assignmentByCourseAndId.get(`${courseId}:${String(item.content_id || '')}`)
    const loggedAssignment = matchLoggedAssignment(loggedAssignments, item, canvasAssignment)

    const canvasWeek = resolveCanvasWeekMs(canvasAssignment)
    if (canvasWeek != null) return canvasWeek

    const parsedWeek = resolveParsedWeekMs(loggedAssignment)
    if (parsedWeek != null) return parsedWeek
  }

  for (const item of items) {
    if (String(item.type || '').toLowerCase() !== 'file') continue

    const canvasFile = lookup.fileByCourseAndId
      && lookup.fileByCourseAndId.get(`${courseId}:${String(item.content_id || '')}`)
    const canvasWeek = resolveCanvasWeekMs(canvasFile)
    if (canvasWeek != null) return canvasWeek
  }

  return null
}

function formatWeekDateRange(weekStartMs) {
  if (weekStartMs == null) return ''

  const start = new Date(weekStartMs)
  const end = new Date(weekStartMs + 6 * 24 * 60 * 60 * 1000)
  const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startLabel} – ${endLabel}`
}

function createWeeklyBucket(weekStartMs) {
  return {
    weekStartMs: weekStartMs == null ? null : weekStartMs,
    sortKey: weekStartMs == null ? Number.MAX_SAFE_INTEGER : weekStartMs,
    files: [],
    assignments: [],
    events: [],
    moduleGroups: [],
    seenFileIds: new Set(),
    seenAssignmentIds: new Set(),
    seenEventIds: new Set(),
    seenModuleGroupIds: new Set()
  }
}

function getPlacedItemId(value) {
  return String(value || '').trim()
}

function addWeeklyFile(bucket, file) {
  if (!file) return
  const fileId = getPlacedItemId(file.id || file.name)
  if (!fileId || bucket.seenFileIds.has(fileId)) return
  bucket.seenFileIds.add(fileId)
  bucket.files.push(file)
}

function addWeeklyAssignment(bucket, assignment) {
  if (!assignment) return
  const assignmentId = String(assignment.assignmentid || assignment.name || '').trim()
  if (!assignmentId || bucket.seenAssignmentIds.has(assignmentId)) return
  bucket.seenAssignmentIds.add(assignmentId)
  bucket.assignments.push(assignment)
}

function getOrCreateModuleGroup(bucket, module) {
  const moduleId = String(module.id)
  if (!bucket.seenModuleGroupIds.has(moduleId)) {
    bucket.seenModuleGroupIds.add(moduleId)
    bucket.moduleGroups.push({
      moduleId,
      moduleName: module.name || '',
      modulePosition: Number(module.position || 0),
      files: [],
      assignments: [],
      seenFileIds: new Set(),
      seenAssignmentIds: new Set()
    })
  }
  return bucket.moduleGroups.find(group => group.moduleId === moduleId)
}

function addModuleGroupFile(group, file) {
  if (!file) return
  const fileId = getPlacedItemId(file.id || file.name)
  if (!fileId || group.seenFileIds.has(fileId)) return
  group.seenFileIds.add(fileId)
  group.files.push(file)
}

function addModuleGroupAssignment(group, assignment) {
  if (!assignment) return
  const assignmentId = getPlacedItemId(assignment.assignmentid || assignment.name)
  if (!assignmentId || group.seenAssignmentIds.has(assignmentId)) return
  group.seenAssignmentIds.add(assignmentId)
  group.assignments.push(assignment)
}

function addWeeklyEvent(bucket, eventEntry) {
  if (!eventEntry || !eventEntry.event) return
  const eventId = getPlacedItemId(eventEntry.event.eventid || eventEntry.event.name)
  if (!eventId || bucket.seenEventIds.has(eventId)) return
  bucket.seenEventIds.add(eventId)
  bucket.events.push(eventEntry)
}

function finalizeWeeklyBucket(bucket, weekNumber) {
  const scheduled = bucket.weekStartMs != null
  const moduleGroups = (bucket.moduleGroups || [])
    .slice()
    .sort((left, right) => left.modulePosition - right.modulePosition)
    .map(group => ({
      moduleId: group.moduleId,
      moduleName: group.moduleName,
      modulePosition: group.modulePosition,
      files: group.files,
      assignments: group.assignments
    }))

  return {
    weekNumber: scheduled ? weekNumber : null,
    weekLabel: scheduled ? `Week ${weekNumber}` : 'Unscheduled',
    dateRange: formatWeekDateRange(bucket.weekStartMs),
    weekStart: scheduled ? new Date(bucket.weekStartMs).toISOString() : '',
    weekEnd: scheduled ? new Date(bucket.weekStartMs + 6 * 24 * 60 * 60 * 1000).toISOString() : '',
    isCurrentWeek: scheduled && isSameWeek(bucket.weekStartMs, Date.now(), WEEK_OPTIONS),
    sortKey: bucket.sortKey,
    files: bucket.files,
    assignments: bucket.assignments,
    events: bucket.events || [],
    moduleGroups
  }
}

function formatEventDateRange(startdate, enddate) {
  const startLabel = startdate ? new Date(startdate).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }) : ''
  const endLabel = enddate ? new Date(enddate).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }) : ''

  if (startLabel && endLabel && startLabel !== endLabel) return `${startLabel} – ${endLabel}`
  return startLabel || endLabel || ''
}

function eventSortKey(event) {
  const dateStr = event.startdate || event.enddate || ''
  const weekMs = startOfWeekMs(dateStr)
  return weekMs == null ? Number.MAX_SAFE_INTEGER - 1 : weekMs
}

function compactWeeklyEvent(event) {
  return {
    eventid: event.eventid || '',
    name: event.name || 'Untitled event',
    description: event.description || '',
    startdate: event.startdate || '',
    enddate: event.enddate || '',
    type: event.type || '',
    gradepercentage: event.gradepercentage ?? null
  }
}

function buildConceptLookup(concepts) {
  const conceptsByCourse = new Map()
  ;(concepts || []).forEach(concept => {
    const courseId = String(concept.courseid || '')
    if (!conceptsByCourse.has(courseId)) conceptsByCourse.set(courseId, [])
    conceptsByCourse.get(courseId).push(concept)
  })
  return conceptsByCourse
}

function buildProblemLookup(problems) {
  const problemsById = new Map()
  ;(problems || []).forEach(problem => {
    const problemId = String(problem.problemid || '').trim()
    if (problemId) problemsById.set(problemId, problem)
  })
  return problemsById
}

function compactWeeklyConcept(concept) {
  return {
    name: concept.name || '',
    conceptid: concept.conceptid || '',
    description: concept.description || ''
  }
}

function resolveEventConcepts(event, courseId, conceptsByCourse, problemsById) {
  if (Array.isArray(event.coveredConcepts) && event.coveredConcepts.length) {
    return event.coveredConcepts.map(compactWeeklyConcept)
  }

  const concepts = conceptsByCourse.get(String(courseId)) || []
  const dependencies = Array.isArray(event.dependencies) ? event.dependencies : []
  return dependencies.map(dependency => {
    const lowered = String(dependency || '').trim().toLowerCase()
    const concept = concepts.find(item => {
      return String(item.conceptid || '').toLowerCase() === lowered
        || String(item.name || '').toLowerCase() === lowered
    })
    if (!concept) return null
    return compactWeeklyConcept(concept)
  }).filter(Boolean)
}

function refsConceptChild(refs, kind, conceptId) {
  const prefix = `${kind}:${conceptId}:`
  return (Array.isArray(refs) ? refs : []).some(ref => String(ref || '').startsWith(prefix))
}

function fileTouchesConcept(file, concept) {
  const conceptId = String(concept.conceptid || '')
  if (!conceptId) return false

  const fileConcepts = Array.isArray(file.concepts) ? file.concepts.map(String) : []
  if (fileConcepts.includes(conceptId)) return true
  if (refsConceptChild(file.details, 'detail', conceptId)) return true
  if (refsConceptChild(file.examples, 'example', conceptId)) return true

  const conceptProblems = new Set((Array.isArray(concept.problems) ? concept.problems : []).map(String))
  const fileProblems = Array.isArray(file.problems) ? file.problems.map(String) : []
  return fileProblems.some(problemId => conceptProblems.has(problemId))
}

function inferStudyMaterialTargetFromFilename(filename) {
  const text = String(filename || '').toLowerCase()
  if (!text) return ''
  if (/\bmidterm\b/.test(text)) return 'Midterm'
  if (/\bfinal\s+(?:exam|test|examination)\b/.test(text) || (/\bfinal\b/.test(text) && !/\bfinal\s+(?:project|paper|report|presentation|portfolio|essay|draft|submission)\b/.test(text))) {
    return 'Final'
  }
  if (/\bquiz\b/.test(text)) return 'Quiz'
  if (/\b(?:exam|test)\b/.test(text)) return 'Exam'
  return ''
}

function isStudyMaterialFile(file) {
  const fileType = String(file.type || '').toLowerCase()
  if (fileType === 'study_material') return true
  const name = String(file.name || file.fileid || '')
  return Boolean(inferStudyMaterialTargetFromFilename(name) || /\breview\b/.test(name.toLowerCase()))
}

function eventNamesMatch(left, right) {
  const leftText = String(left || '').trim().toLowerCase()
  const rightText = String(right || '').trim().toLowerCase()
  if (!leftText || !rightText) return false
  if (leftText === rightText) return true
  return leftText.includes(rightText) || rightText.includes(leftText)
}

function collectEventStudyFiles(courseId, event, coveredConcepts, conceptsByCourse, graphFiles, graphEdges, resolveWeeklyFile, placedFileIds) {
  const courseFileMap = graphFiles[courseId] || graphFiles[String(courseId)] || {}
  const courseFiles = Object.values(courseFileMap)
  const courseConcepts = conceptsByCourse.get(String(courseId)) || []
  const files = []
  const seen = new Set()
  const eventId = String(event.eventid || '')
  const eventName = String(event.name || '')

  const addFile = file => {
    const fileId = getPlacedItemId(file.fileid || file.id || file.name)
    if (!fileId || seen.has(fileId) || placedFileIds.has(fileId)) return
    seen.add(fileId)
    const compactFile = resolveWeeklyFile(courseId, fileId, [])
    if (compactFile) files.push(compactFile)
  }

  ;(graphEdges || []).forEach(edge => {
    if (edge.relation !== 'requires_reading') return
    if (String(edge.fromType || '') !== 'event') return
    if (String(edge.toType || '') !== 'file') return
    if (eventId && String(edge.fromId || '') !== eventId) return
    const linkedFile = courseFiles.find(file => String(file.fileid || file.id || '') === String(edge.toId || ''))
    if (linkedFile) addFile(linkedFile)
  })

  for (const coveredConcept of coveredConcepts) {
    const concept = courseConcepts.find(item => {
      return String(item.conceptid || '') === String(coveredConcept.conceptid || '')
        || String(item.name || '') === String(coveredConcept.name || '')
    }) || coveredConcept

    for (const file of courseFiles) {
      if (!fileTouchesConcept(file, concept)) continue
      addFile(file)
    }
  }

  for (const file of courseFiles) {
    if (!isStudyMaterialFile(file)) continue
    const target = inferStudyMaterialTargetFromFilename(file.name || file.fileid || '')
    if (!target) continue
    if (!eventNamesMatch(eventName, target)) continue
    addFile(file)
  }

  return files
}

function assignmentTouchesEvent(assignment, event, coveredConcepts) {
  const conceptIds = new Set(coveredConcepts.map(concept => String(concept.conceptid || '').toLowerCase()).filter(Boolean))
  const conceptNames = new Set(coveredConcepts.map(concept => String(concept.name || '').toLowerCase()).filter(Boolean))
  const dependencies = new Set((Array.isArray(event.dependencies) ? event.dependencies : [])
    .map(value => String(value || '').toLowerCase())
    .filter(Boolean))

  const requirements = Array.isArray(assignment.conceptRequirements) ? assignment.conceptRequirements : []
  for (const requirement of requirements) {
    const normalized = String(requirement || '').toLowerCase()
    if (conceptIds.has(normalized) || conceptNames.has(normalized) || dependencies.has(normalized)) {
      return true
    }
  }

  const eventName = String(event.name || '').trim().toLowerCase()
  const assignmentName = String(assignment.name || '').trim().toLowerCase()
  if (eventName && assignmentName && (assignmentName.includes(eventName) || eventName.includes(assignmentName))) {
    return true
  }

  return false
}

function collectEventAssignments(
  event,
  courseId,
  loggedAssignments,
  coveredConcepts,
  placedAssignmentIds,
  findCanvasAssignment,
  lookup,
  compactWeeklyAssignment,
  graphEdges = []
) {
  const assignments = []
  const seen = new Set()
  const eventId = String(event.eventid || '')

  const addAssignment = assignment => {
    const assignmentId = getPlacedItemId(assignment.assignmentid || assignment.name)
    if (!assignmentId || seen.has(assignmentId) || placedAssignmentIds.has(assignmentId)) return
    seen.add(assignmentId)
    const canvasAssignment = findCanvasAssignment(lookup, courseId, assignment)
    assignments.push(compactWeeklyAssignment(assignment, canvasAssignment))
  }

  ;(graphEdges || []).forEach(edge => {
    if (edge.relation !== 'requires') return
    if (String(edge.fromType || '') !== 'event') return
    if (String(edge.toType || '') !== 'assignment') return
    if (eventId && String(edge.fromId || '') !== eventId) return
    const linkedAssignment = loggedAssignments.find(assignment => {
      return String(assignment.assignmentid || '') === String(edge.toId || '')
        || String(assignment.name || '') === String(edge.toId || '')
    })
    if (linkedAssignment) addAssignment(linkedAssignment)
  })

  loggedAssignments.forEach(assignment => {
    if (!assignmentTouchesEvent(assignment, event, coveredConcepts)) return
    addAssignment(assignment)
  })

  return assignments
}

function resolveEventWeekMs(event) {
  return startOfWeekMs(event.startdate || event.enddate || '')
}

function buildCourseEventSections(courseContext) {
  const {
    courseId,
    graphEvents = [],
    loggedEvents = [],
    concepts = [],
    graphFiles = {},
    graphEdges = [],
    loggedAssignments = [],
    placedFileIds,
    placedAssignmentIds,
    lookup,
    findCanvasAssignment,
    compactWeeklyAssignment,
    resolveWeeklyFile
  } = courseContext

  const conceptsByCourse = buildConceptLookup(concepts)
  const problemsById = buildProblemLookup(courseContext.problems || [])
  const parserEvents = graphEvents.filter(event => String(event.courseid || '') === String(courseId))
  const existingNames = new Set(parserEvents.map(event => String(event.name || '').toLowerCase()))

  if (Array.isArray(loggedEvents) && loggedEvents.length) {
    loggedEvents.forEach(entry => {
      const eventName = entry.eventname || 'Untitled event'
      const lowered = String(eventName).toLowerCase()
      const duplicate = parserEvents.some(event => eventNamesMatch(event.name, eventName))
      if (duplicate || existingNames.has(lowered)) return
      existingNames.add(lowered)
      parserEvents.push({
        courseid: courseId,
        eventid: `${eventName}-logged`,
        name: eventName,
        startdate: entry.startdate || '',
        enddate: entry.enddate || '',
        description: entry.description || '',
        type: entry.type || '',
        gradepercentage: entry.gradepercentage ?? null,
        dependencies: entry.dependencies || []
      })
    })
  }

  return parserEvents
    .slice()
    .sort((left, right) => eventSortKey(left) - eventSortKey(right))
    .map(event => {
      const compactEvent = compactWeeklyEvent(event)
      const coveredConcepts = resolveEventConcepts(event, courseId, conceptsByCourse, problemsById)
      const files = collectEventStudyFiles(
        courseId,
        event,
        coveredConcepts,
        conceptsByCourse,
        graphFiles,
        graphEdges,
        resolveWeeklyFile,
        placedFileIds
      )
      const assignments = collectEventAssignments(
        event,
        courseId,
        loggedAssignments,
        coveredConcepts,
        placedAssignmentIds,
        findCanvasAssignment,
        lookup,
        compactWeeklyAssignment,
        graphEdges
      )

      files.forEach(file => {
        const fileId = getPlacedItemId(file.id || file.name)
        if (fileId) placedFileIds.add(fileId)
      })
      assignments.forEach(assignment => {
        const assignmentId = getPlacedItemId(assignment.assignmentid || assignment.name)
        if (assignmentId) placedAssignmentIds.add(assignmentId)
      })

      return {
        weekStartMs: resolveEventWeekMs(event),
        event: compactEvent,
        eventType: compactEvent.type,
        concepts: coveredConcepts,
        files,
        assignments
      }
    })
}

function addParserEventsToWeekBuckets(weekBuckets, orphanBucket, courseContext) {
  const eventEntries = buildCourseEventSections(courseContext)
  const datedWeekStarts = []

  eventEntries.forEach(entry => {
    if (entry.weekStartMs != null) {
      const key = String(entry.weekStartMs)
      if (!weekBuckets.has(key)) {
        weekBuckets.set(key, createWeeklyBucket(entry.weekStartMs))
      }
      addWeeklyEvent(weekBuckets.get(key), entry)
      datedWeekStarts.push(entry.weekStartMs)
      return
    }

    addWeeklyEvent(orphanBucket, entry)
  })

  return datedWeekStarts
}

function collectPlacedIdsFromBucket(bucket, placedFileIds, placedAssignmentIds) {
  bucket.files.forEach(file => {
    const fileId = getPlacedItemId(file.id || file.name)
    if (fileId) placedFileIds.add(fileId)
  })
  bucket.assignments.forEach(assignment => {
    const assignmentId = getPlacedItemId(assignment.assignmentid || assignment.name)
    if (assignmentId) placedAssignmentIds.add(assignmentId)
  })
  ;(bucket.moduleGroups || []).forEach(group => {
    group.files.forEach(file => {
      const fileId = getPlacedItemId(file.id || file.name)
      if (fileId) placedFileIds.add(fileId)
    })
    group.assignments.forEach(assignment => {
      const assignmentId = getPlacedItemId(assignment.assignmentid || assignment.name)
      if (assignmentId) placedAssignmentIds.add(assignmentId)
    })
  })
}

function groupItemsByModule(items) {
  const itemsByModule = new Map()
  items.forEach(item => {
    if (!item.moduleId) return
    if (!itemsByModule.has(item.moduleId)) itemsByModule.set(item.moduleId, [])
    itemsByModule.get(item.moduleId).push(item)
  })
  return itemsByModule
}

function resolveItemWeeks(items, modules, urlToNode, parsedById, courseId) {
  applyPass1CanvasDates(items)
  applyPass2ParsedDates(items, urlToNode, parsedById, courseId)
  applyPass3ModuleClustering(modules, groupItemsByModule(items))
  applyPass4WeekNameMatching(modules, groupItemsByModule(items))
}

function buildCourseWeeklySchedule(courseContext) {
  const {
    courseId,
    modules,
    moduleItems,
    canvasFiles,
    loggedAssignments,
    lookup,
    matchLoggedAssignment,
    resolveWeeklyFile,
    findCanvasAssignment,
    compactWeeklyAssignment,
    urlToNode = {},
    graphEvents = [],
    loggedEvents = [],
    concepts = [],
    problems = [],
    graphFiles = {},
    graphEdges = []
  } = courseContext

  const parsedById = buildParsedAssignmentLookup(loggedAssignments)
  const normalizedUrlToNode = buildNormalizedUrlToNode(urlToNode)
  const scheduleItems = []
  const placedAssignmentIds = new Set()

  modules.forEach(module => {
    const items = (moduleItems[module.id] || moduleItems[String(module.id)] || [])
      .slice()
      .sort((left, right) => (left.position || 0) - (right.position || 0))

    items.forEach(item => {
      const itemType = String(item.type || '').toLowerCase()
      const moduleMeta = {
        moduleId: String(module.id),
        modulePosition: Number(module.position || 0),
        position: Number(item.position || 0)
      }

      if (itemType === 'file') {
        const canvasFile = (canvasFiles || []).find(file => String(file.id) === String(item.content_id))
        const file = resolveWeeklyFile(courseId, item.content_id, canvasFiles)
        const filePayload = file || {
          id: String(item.id || item.content_id || item.title || ''),
          name: item.title || 'Untitled file',
          courseid: courseId,
          description: item.type || 'File',
          url: item.html_url || item.url || '',
          downloadurl: item.url || '',
          canvaspreviewurl: item.html_url || ''
        }

        scheduleItems.push(createScheduleItem({
          kind: 'file',
          key: `file:${moduleMeta.moduleId}:${item.id || item.content_id || item.title}`,
          ...moduleMeta,
          canvasEntity: canvasFile || null,
          urls: collectItemUrls(item, null, null, canvasFile),
          filePayload
        }))
        return
      }

      if (!isAssignmentModuleItem(item)) return

      const canvasAssignment = lookup.assignmentByCourseAndId.get(`${courseId}:${String(item.content_id || '')}`)
      const loggedAssignment = matchLoggedAssignment(loggedAssignments, item, canvasAssignment)
      if (!loggedAssignment) return

      const compactAssignment = compactWeeklyAssignment(loggedAssignment, canvasAssignment)
      scheduleItems.push(createScheduleItem({
        kind: 'assignment',
        key: `assignment:${loggedAssignment.assignmentid || loggedAssignment.name}`,
        ...moduleMeta,
        canvasEntity: canvasAssignment || null,
        parsedAssignment: loggedAssignment,
        loggedAssignment,
        canvasAssignment,
        urls: collectItemUrls(item, canvasAssignment, loggedAssignment, null),
        compactAssignment
      }))
      placedAssignmentIds.add(String(loggedAssignment.assignmentid || loggedAssignment.name || ''))
    })
  })

  const orphanItems = []
  loggedAssignments.forEach(assignment => {
    const assignmentKey = String(assignment.assignmentid || assignment.name || '').trim()
    if (!assignmentKey || placedAssignmentIds.has(assignmentKey)) return

    const canvasAssignment = findCanvasAssignment(lookup, courseId, assignment)
    orphanItems.push(createScheduleItem({
      kind: 'assignment',
      key: `assignment:${assignmentKey}`,
      position: 0,
      moduleId: '',
      modulePosition: Number.MAX_SAFE_INTEGER,
      canvasEntity: canvasAssignment || null,
      parsedAssignment: assignment,
      loggedAssignment: assignment,
      canvasAssignment,
      urls: collectItemUrls(null, canvasAssignment, assignment, null),
      compactAssignment: compactWeeklyAssignment(assignment, canvasAssignment)
    }))
  })

  resolveItemWeeks(scheduleItems, modules, normalizedUrlToNode, parsedById, courseId)
  resolveItemWeeks(orphanItems, modules, normalizedUrlToNode, parsedById, courseId)

  const weekBuckets = new Map()
  const orphanBucket = createWeeklyBucket(null)
  const moduleById = new Map(modules.map(module => [String(module.id), module]))

  const getWeekBucket = weekStartMs => {
    const key = String(weekStartMs)
    if (!weekBuckets.has(key)) {
      weekBuckets.set(key, createWeeklyBucket(weekStartMs))
    }
    return weekBuckets.get(key)
  }

  const placeScheduleItem = item => {
    if (item.weekStartMs != null) {
      const bucket = getWeekBucket(item.weekStartMs)
      if (item.kind === 'file') {
        addWeeklyFile(bucket, item.filePayload)
        return
      }
      if (item.compactAssignment) {
        item.compactAssignment.filechildren.forEach(fileId => {
          const file = resolveWeeklyFile(courseId, fileId, canvasFiles)
          if (file) addWeeklyFile(bucket, file)
        })
        addWeeklyAssignment(bucket, item.compactAssignment)
      }
      return
    }

    const module = item.moduleId ? moduleById.get(String(item.moduleId)) : null
    const targetBucket = orphanBucket
    if (module) {
      const group = getOrCreateModuleGroup(targetBucket, module)
      if (item.kind === 'file') {
        addModuleGroupFile(group, item.filePayload)
        return
      }
      if (item.compactAssignment) {
        item.compactAssignment.filechildren.forEach(fileId => {
          const file = resolveWeeklyFile(courseId, fileId, canvasFiles)
          if (file) addModuleGroupFile(group, file)
        })
        addModuleGroupAssignment(group, item.compactAssignment)
      }
      return
    }

    if (item.kind === 'file') {
      addWeeklyFile(targetBucket, item.filePayload)
      return
    }
    if (item.compactAssignment) {
      item.compactAssignment.filechildren.forEach(fileId => {
        const file = resolveWeeklyFile(courseId, fileId, canvasFiles)
        if (file) addWeeklyFile(targetBucket, file)
      })
      addWeeklyAssignment(targetBucket, item.compactAssignment)
    }
  }

  scheduleItems.forEach(placeScheduleItem)

  orphanItems.forEach(item => {
    if (item.weekStartMs == null) return
    placeScheduleItem(item)
  })

  const placedFileIds = new Set()
  const placedAssignmentSnapshot = new Set(placedAssignmentIds)
  weekBuckets.forEach(bucket => collectPlacedIdsFromBucket(bucket, placedFileIds, placedAssignmentSnapshot))

  const eventWeekStarts = addParserEventsToWeekBuckets(weekBuckets, orphanBucket, {
    courseId,
    graphEvents,
    loggedEvents,
    concepts,
    problems,
    graphFiles,
    graphEdges,
    loggedAssignments,
    placedFileIds,
    placedAssignmentIds: placedAssignmentSnapshot,
    lookup,
    findCanvasAssignment,
    compactWeeklyAssignment,
    resolveWeeklyFile: (cid, fileId) => resolveWeeklyFile(cid, fileId, canvasFiles)
  })

  orphanItems.forEach(item => {
    if (item.weekStartMs != null) return
    if (item.compactAssignment) {
      const assignmentId = getPlacedItemId(item.compactAssignment.assignmentid || item.compactAssignment.name)
      if (assignmentId && placedAssignmentSnapshot.has(assignmentId)) return
    }
    placeScheduleItem(item)
  })

  collectPlacedIdsFromBucket(orphanBucket, placedFileIds, placedAssignmentSnapshot)

  const scheduledStarts = Array.from(weekBuckets.values())
    .map(bucket => bucket.weekStartMs)
    .filter(weekStartMs => weekStartMs != null)

  eventWeekStarts.forEach(weekStartMs => {
    if (!scheduledStarts.includes(weekStartMs)) scheduledStarts.push(weekStartMs)
  })

  const courseWeeks = []
  if (scheduledStarts.length) {
    const firstWeek = startOfWeek(Math.min(...scheduledStarts), WEEK_OPTIONS)
    const lastWeek = startOfWeek(Math.max(...scheduledStarts), WEEK_OPTIONS)
    const totalWeeks = differenceInCalendarWeeks(lastWeek, firstWeek, WEEK_OPTIONS) + 1

    for (let index = 0; index < totalWeeks; index += 1) {
      const weekStartMs = startOfWeek(addWeeks(firstWeek, index), WEEK_OPTIONS).getTime()
      const bucket = weekBuckets.get(String(weekStartMs)) || createWeeklyBucket(weekStartMs)
      courseWeeks.push(finalizeWeeklyBucket(bucket, index + 1))
    }
  }

  const hasOrphanContent = orphanBucket.files.length
    || orphanBucket.assignments.length
    || orphanBucket.events.length
    || orphanBucket.moduleGroups.some(group => group.files.length || group.assignments.length)

  if (hasOrphanContent) {
    courseWeeks.push(finalizeWeeklyBucket(orphanBucket, null))
  }

  return courseWeeks
}

function buildWeeklyScheduleFromCanvasData(canvasData, helpers) {
  const graph = helpers.readCanvasGraph()
  const syllabi = graph.syllabi || {}
  const schedule = {}
  const courses = Array.isArray(canvasData && canvasData.courses) ? canvasData.courses : []

  courses.forEach(course => {
    if (!course || !course.id) return
    const courseId = String(course.id)
    const syllabus = syllabi[courseId] || syllabi[course.id]
    const loggedAssignments = syllabus && Array.isArray(syllabus.assignments) ? syllabus.assignments : []
    const loggedEvents = (graph.logged_events && graph.logged_events[courseId])
      || (graph.logged_events && graph.logged_events[course.id])
      || []
    const modules = helpers.getCourseArrayBucket(canvasData, 'modules', courseId)
      .slice()
      .sort((left, right) => (left.position || 0) - (right.position || 0))
    const moduleItems = helpers.getCourseObjectBucket(canvasData, 'module_items', courseId)
    const canvasFiles = helpers.getCourseArrayBucket(canvasData, 'file', courseId)

    schedule[courseId] = buildCourseWeeklySchedule({
      courseId,
      modules,
      moduleItems,
      canvasFiles,
      loggedAssignments,
      lookup: helpers.lookup,
      matchLoggedAssignment: helpers.matchLoggedAssignment,
      resolveWeeklyFile: (cid, fileId, files) => helpers.resolveWeeklyFile(cid, fileId, files),
      findCanvasAssignment: helpers.findCanvasAssignment,
      compactWeeklyAssignment: helpers.compactWeeklyAssignment,
      urlToNode: graph.url_to_node || helpers.urlToNode || {},
      graphEvents: Array.isArray(graph.events) ? graph.events : [],
      loggedEvents,
      concepts: Array.isArray(graph.concepts) ? graph.concepts : [],
      problems: Array.isArray(graph.problems) ? graph.problems : [],
      graphFiles: graph.files || {},
      graphEdges: Array.isArray(graph.edges) ? graph.edges : []
    })
  })

  return schedule
}

module.exports = {
  WEEK_OPTIONS,
  startOfWeekMs,
  resolveCanvasSchedulingDate,
  resolveParsedSchedulingDate,
  resolveSchedulingDate,
  resolveWeekStartMs,
  resolveModuleAnchorWeekMs,
  extractWeekNumberFromName,
  isAssignmentModuleItem,
  formatWeekDateRange,
  createWeeklyBucket,
  addWeeklyFile,
  addWeeklyAssignment,
  finalizeWeeklyBucket,
  buildCourseWeeklySchedule,
  buildWeeklyScheduleFromCanvasData,
  startOfWeek,
  addWeeks,
  differenceInCalendarWeeks
}
