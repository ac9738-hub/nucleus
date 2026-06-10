// Canvas data API and task builder.
// Functionality: fetches Canvas data with saved auth, writes local snapshots,
// spawns parser.py, and converts parsed graph nodes into task cards.
// Dependencies: main.js provides auth state/update callbacks; parser.py consumes
// streamed Canvas records; data-store.js receives generated tasks.
const fs = require('fs')
const { spawn } = require('child_process')
const path = require('path')
const { startOfWeek, addWeeks, isSameWeek, differenceInCalendarWeeks } = require('date-fns')

// Monday-based weeks throughout the weekly schedule.
const WEEK_OPTIONS = { weekStartsOn: 1 }

const canvasCourseColors = ["#1d9e75", "#378add", "#7f77dd", "#d85a30", "#d4537e", "#c58d35"]

let parserProc = null
let parserAuthSignature = null

function decodeHtmlEntities(text) {
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }

  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase()
    if (key[0] === '#') {
      const isHex = key[1] === 'x'
      const codePoint = Number.parseInt(key.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return Object.prototype.hasOwnProperty.call(entities, key) ? entities[key] : match
  })
}

function stripHtmlToText(value) {
  if (value == null) return ''

  return decodeHtmlEntities(String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|section|article|header|footer|blockquote|ul|ol|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatEnvValue(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`
}

function saveCanvasAuthToEnv(envPath, { canvasAuthCookie, canvasAuthCsrf, canvasBaseUrl }) {
  const updates = {
    CANVAS_AUTH_COOKIE: canvasAuthCookie || '',
    CANVAS_AUTH_CSRF: canvasAuthCsrf || '',
    CANVAS_BASE_URL: canvasBaseUrl || ''
  }
  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    : []
  const seen = new Set()
  const nextLines = lines.map(line => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)
    if (!match || !(match[1] in updates)) return line
    seen.add(match[1])
    return `${match[1]}=${formatEnvValue(updates[match[1]])}`
  })

  Object.keys(updates).forEach(key => {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${formatEnvValue(updates[key])}`)
    }
  })

  fs.writeFileSync(envPath, nextLines.join('\n'))
}

function parseCanvasDate(value) {
  const timestamp = Date.parse(value || '')
  return Number.isNaN(timestamp) ? null : timestamp
}

function daysUntil(value) {
  const timestamp = parseCanvasDate(value)
  if (timestamp === null) return 30
  return (timestamp - Date.now()) / (1000 * 60 * 60 * 24)
}

function canvasStudyTaskImportance(event, coveredConcepts = []) {
  const type = String(event.type || '').toLowerCase()
  let score = type === 'test' ? 9 : 5

  const days = daysUntil(event.startdate || event.enddate)
  if (days <= 1) score += 3
  else if (days <= 3) score += 2
  else if (days <= 7) score += 1

  if (event.gradepercentage !== null && event.gradepercentage !== undefined && event.gradepercentage !== '') {
    const gradeWeight = Number(event.gradepercentage)
    if (Number.isFinite(gradeWeight)) {
      score += Math.min(3, Math.max(0, gradeWeight / 10))
    }
  }

  const problemCount = coveredConcepts.reduce((total, concept) => {
    return total + (Array.isArray(concept.problems) ? concept.problems.length : 0)
  }, 0)
  score += Math.min(2, coveredConcepts.length * 0.25)
  score += Math.min(2, problemCount * 0.15)

  return Math.max(1, Math.min(10, Math.round(score)))
}

function makeConceptLookup(allCanvasNodes) {
  const conceptsByCourse = new Map()
  ;(allCanvasNodes.concepts || []).forEach(concept => {
    const courseid = String(concept.courseid || '')
    if (!conceptsByCourse.has(courseid)) {
      conceptsByCourse.set(courseid, [])
    }
    conceptsByCourse.get(courseid).push(concept)
  })
  return conceptsByCourse
}

function makeProblemLookup(allCanvasNodes) {
  const problemsById = new Map()
  ;(allCanvasNodes.problems || []).forEach(problem => {
    if (problem.problemid) {
      problemsById.set(String(problem.problemid), problem)
    }
  })
  return problemsById
}

function compactStudyFile(file, courseid) {
  return {
    id: String(file.fileid || file.id || ''),
    name: file.name || '',
    courseid: String(file.courseid || courseid || ''),
    description: stripHtmlToText(file.description || file.content_type || file.mime_class || ''),
    url: file.canvaspreviewurl || file.downloadurl || file.previewurl || file.url || '',
    downloadurl: file.downloadurl || '',
    canvaspreviewurl: file.canvaspreviewurl || file.previewurl || ''
  }
}

function refsConceptChild(refs, kind, conceptid) {
  const prefix = `${kind}:${conceptid}:`
  return (Array.isArray(refs) ? refs : []).some(ref => String(ref || '').startsWith(prefix))
}

function fileTouchesConcept(file, concept) {
  const conceptid = String(concept.conceptid || '')
  if (!conceptid) return false

  const fileConcepts = Array.isArray(file.concepts) ? file.concepts.map(String) : []
  if (fileConcepts.includes(conceptid)) return true

  if (refsConceptChild(file.details, 'detail', conceptid)) return true
  if (refsConceptChild(file.examples, 'example', conceptid)) return true

  const conceptProblems = new Set((Array.isArray(concept.problems) ? concept.problems : []).map(problem => {
    return String(problem.problemid || problem)
  }))
  const fileProblems = Array.isArray(file.problems) ? file.problems.map(String) : []
  return fileProblems.some(problemid => conceptProblems.has(problemid))
}

function collectStudyFilesDepthOne(courseid, coveredConcepts, allCanvasNodes) {
  const courseFiles = allCanvasNodes.files && allCanvasNodes.files[courseid]
    ? Object.values(allCanvasNodes.files[courseid])
    : []
  const seen = new Set()
  const files = []

  for (const concept of coveredConcepts) {
    for (const file of courseFiles) {
      const fileid = String(file.fileid || file.id || file.name || '')
      if (!fileid || seen.has(fileid)) continue
      if (!fileTouchesConcept(file, concept)) continue

      seen.add(fileid)
      files.push(compactStudyFile(file, courseid))
    }
  }

  return files
}

function collectAssignmentChildFiles(courseid, assignment, allCanvasNodes) {
  const courseFiles = allCanvasNodes.files && allCanvasNodes.files[courseid]
    ? allCanvasNodes.files[courseid]
    : {}
  const childIds = Array.isArray(assignment.filechildren) ? assignment.filechildren.map(String) : []
  return childIds
    .map(fileid => courseFiles[fileid])
    .filter(Boolean)
    .map(file => compactStudyFile(file, courseid))
}

function resolveEventConcepts(event, courseid, conceptsByCourse, problemsById) {
  if (Array.isArray(event.coveredConcepts) && event.coveredConcepts.length) {
    return event.coveredConcepts.map(compactCoveredConcept)
  }

  const concepts = conceptsByCourse.get(String(courseid)) || []
  const dependencies = Array.isArray(event.dependencies) ? event.dependencies : []
  return dependencies.map(dependency => {
    const lowered = String(dependency || '').trim().toLowerCase()
    const concept = concepts.find(item => {
      return String(item.conceptid || '').toLowerCase() === lowered
        || String(item.name || '').toLowerCase() === lowered
    })
    if (!concept) return null
    return {
      name: concept.name || '',
      conceptid: concept.conceptid || '',
      description: concept.description || '',
      examples: (Array.isArray(concept.examples) ? concept.examples : []).map(example => ({
        name: example.name || '',
        description: stripHtmlToText(example.description || '')
      })),
      problems: (Array.isArray(concept.problems) ? concept.problems : [])
        .map(problemid => problemsById.get(String(problemid)))
        .filter(Boolean)
        .map(problem => ({
          name: problem.name || '',
          problemid: problem.problemid || '',
          steps: Array.isArray(problem.steps) ? problem.steps : [],
          answer: stripHtmlToText(problem.answer || '')
        }))
    }
  }).filter(Boolean)
}

function compactCoveredConcept(concept) {
  return {
    name: concept.name || '',
    conceptid: concept.conceptid || '',
    description: stripHtmlToText(concept.description || ''),
    examples: (Array.isArray(concept.examples) ? concept.examples : []).map(example => ({
      name: example.name || '',
      description: stripHtmlToText(example.description || '')
    })),
    problems: (Array.isArray(concept.problems) ? concept.problems : []).map(problem => ({
      name: problem.name || '',
      problemid: problem.problemid || '',
      steps: Array.isArray(problem.steps) ? problem.steps : [],
      answer: stripHtmlToText(problem.answer || '')
    }))
  }
}

function formatEventTaskDetails(event, coveredConcepts, studyFiles = []) {
  const parts = [stripHtmlToText(event.description || '')].filter(Boolean)
  if (coveredConcepts.length) {
    const conceptLines = coveredConcepts.slice(0, 8).map(concept => {
      const examples = Array.isArray(concept.examples) ? concept.examples : []
      const problems = Array.isArray(concept.problems) ? concept.problems : []
      const childBits = [
        examples.length ? `${examples.length} examples` : '',
        problems.length ? `${problems.length} problems` : ''
      ].filter(Boolean).join(', ')
      const description = stripHtmlToText(concept.description || '').slice(0, 160)
      return `- ${concept.name || concept.conceptid}${childBits ? ` (${childBits})` : ''}${description ? `: ${description}` : ''}`
    })
    parts.push(`Covered concepts:\n${conceptLines.join('\n')}`)
  }
  if (studyFiles.length) {
    const fileLines = studyFiles.slice(0, 12).map(file => {
      return `- ${file.name || file.id}`
    })
    parts.push(`Study files:\n${fileLines.join('\n')}`)
  }
  return parts.join('\n\n')
}

function normalizeLookupText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function uniqueUrls(values) {
  const seen = new Set()
  const urls = []
  ;(values || []).forEach(value => {
    const url = String(value || '').trim()
    if (url.includes('/api/v1/')) return
    if (!url || seen.has(url)) return
    seen.add(url)
    urls.push(url)
  })
  return urls
}

function readCanvasDataFromRoot(rootDir) {
  const canvasDataPath = path.join(rootDir, 'canvas_data.json')
  if (!fs.existsSync(canvasDataPath)) {
    return {}
  }

  try {
    const raw = fs.readFileSync(canvasDataPath, 'utf8')
    return raw.trim() ? JSON.parse(raw) : {}
  } catch (error) {
    console.error("Unable to read Canvas data for tasks:", error)
    return {}
  }
}

function writeJsonFileAtomic(targetPath, data) {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tempPath, targetPath)
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    } catch (_) {}
    throw error
  }
}

function findCanvasBaseUrl(canvasData) {
  const serialized = JSON.stringify(canvasData || {})
  const match = serialized.match(/https?:\/\/[^/"']+(?=\/(?:api\/v1\/)?courses\/)/)
  return match ? match[0] : ''
}

function makeCanvasTaskLookup(rootDir) {
  const canvasData = readCanvasDataFromRoot(rootDir)
  const canvasBaseUrl = findCanvasBaseUrl(canvasData)
  const courseNameById = new Map()
  const courseHomeUrlById = new Map()
  const assignmentByCourseAndId = new Map()
  const assignmentByCourseAndName = new Map()

  ;(Array.isArray(canvasData.courses) ? canvasData.courses : []).forEach(course => {
    if (!course || !course.id) return
    courseNameById.set(
      String(course.id),
      course.name || course.course_code || `Canvas course ${course.id}`
    )
  })

  Object.entries(canvasData.front_pages || {}).forEach(([courseid, page]) => {
    if (page && page.html_url) {
      courseHomeUrlById.set(String(courseid), page.html_url)
    }
  })

  Object.entries(canvasData.assignments || {}).forEach(([courseid, assignments]) => {
    if (!Array.isArray(assignments)) return
    assignments.forEach(assignment => {
      if (!assignment) return
      const courseKey = String(courseid)
      if (assignment.id) {
        assignmentByCourseAndId.set(`${courseKey}:${String(assignment.id)}`, assignment)
      }
      const nameKey = normalizeLookupText(assignment.name)
      if (nameKey) {
        assignmentByCourseAndName.set(`${courseKey}:${nameKey}`, assignment)
      }
      if (!courseHomeUrlById.has(courseKey) && assignment.html_url) {
        const match = String(assignment.html_url).match(/^(https?:\/\/[^/]+\/courses\/[^/]+)/)
        if (match) {
          courseHomeUrlById.set(courseKey, match[1])
        }
      }
    })
  })

  return {
    canvasBaseUrl,
    courseNameById,
    courseHomeUrlById,
    assignmentByCourseAndId,
    assignmentByCourseAndName
  }
}

function getCourseTaskName(lookup, courseid) {
  return lookup.courseNameById.get(String(courseid || '')) || `Canvas ${courseid || 'course'}`
}

function getCourseHomeUrl(lookup, courseid) {
  const courseKey = String(courseid || '')
  return lookup.courseHomeUrlById.get(courseKey)
    || (lookup.canvasBaseUrl && courseKey ? `${lookup.canvasBaseUrl}/courses/${courseKey}` : '')
}

function findCanvasAssignment(lookup, courseid, assignment) {
  const courseKey = String(courseid || '')
  const assignmentId = String(assignment.assignmentid || '').trim()
  if (assignmentId && lookup.assignmentByCourseAndId.has(`${courseKey}:${assignmentId}`)) {
    return lookup.assignmentByCourseAndId.get(`${courseKey}:${assignmentId}`)
  }

  const nameKey = normalizeLookupText(assignment.name)
  if (nameKey && lookup.assignmentByCourseAndName.has(`${courseKey}:${nameKey}`)) {
    return lookup.assignmentByCourseAndName.get(`${courseKey}:${nameKey}`)
  }

  return null
}

function readCanvasGraphFromRoot(rootDir) {
  const parsedStatePath = path.join(rootDir, 'canvas_graph.json')
  if (!fs.existsSync(parsedStatePath)) {
    return {}
  }

  try {
    const raw = fs.readFileSync(parsedStatePath, 'utf8')
    return raw.trim() ? JSON.parse(raw) : {}
  } catch (error) {
    console.error('Unable to read Canvas graph for weekly schedule:', error)
    return {}
  }
}

// Snaps a date to the Monday 00:00 that starts its calendar week. Returns the
// epoch ms of that Monday, or null when the date is missing/unparseable. Weekly
// buckets are keyed purely on this value so grouping is date-driven only.
function startOfWeekMs(dateStr) {
  if (!dateStr) return null

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return null

  return startOfWeek(date, WEEK_OPTIONS).getTime()
}

// Earliest week-start among a list of date strings (skips undated entries).
function earliestWeekStartMs(dateStrings) {
  let earliest = null
  dateStrings.forEach(dateStr => {
    const ms = startOfWeekMs(dateStr)
    if (ms != null && (earliest == null || ms < earliest)) earliest = ms
  })
  return earliest
}

// Universal "Mon D – Mon D, YYYY" range for a week-start ms.
function formatWeekDateRange(weekStartMs) {
  if (weekStartMs == null) return ''

  const start = new Date(weekStartMs)
  const end = new Date(weekStartMs + 6 * 24 * 60 * 60 * 1000)
  const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startLabel} – ${endLabel}`
}

function getCourseArrayBucket(canvasData, bucketName, courseId) {
  const bucket = canvasData && canvasData[bucketName]
  if (!bucket) return []

  const value = bucket[courseId] || bucket[String(courseId)]
  return Array.isArray(value) ? value : []
}

function getCourseObjectBucket(canvasData, bucketName, courseId) {
  const bucket = canvasData && canvasData[bucketName]
  if (!bucket) return {}

  const value = bucket[courseId] || bucket[String(courseId)]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function resolveWeeklyFile(graphFiles, courseId, fileId, canvasFiles) {
  const courseFileMap = graphFiles[courseId] || graphFiles[String(courseId)] || {}
  const graphFile = courseFileMap[fileId] || courseFileMap[String(fileId)]
  if (graphFile) {
    return compactStudyFile(graphFile, courseId)
  }

  const canvasFile = (canvasFiles || []).find(file => String(file.id) === String(fileId))
  if (!canvasFile) return null

  return {
    id: String(canvasFile.id || ''),
    name: canvasFile.display_name || canvasFile.filename || canvasFile.name || 'Untitled file',
    courseid: String(courseId),
    description: canvasFile['content-type'] || canvasFile.mime_class || '',
    url: canvasFile.previewurl || canvasFile.url || '',
    downloadurl: canvasFile.url || '',
    canvaspreviewurl: canvasFile.previewurl || ''
  }
}

function matchLoggedAssignment(loggedAssignments, moduleItem, canvasAssignment) {
  const contentId = String(moduleItem && moduleItem.content_id || '').trim()
  if (contentId) {
    const byId = loggedAssignments.find(assignment => String(assignment.assignmentid || '').trim() === contentId)
    if (byId) return byId
  }

  const titleKey = normalizeLookupText(moduleItem && moduleItem.title)
  if (titleKey) {
    const byTitle = loggedAssignments.find(assignment => normalizeLookupText(assignment.name) === titleKey)
    if (byTitle) return byTitle
  }

  if (canvasAssignment) {
    const canvasNameKey = normalizeLookupText(canvasAssignment.name)
    if (canvasNameKey) {
      return loggedAssignments.find(assignment => normalizeLookupText(assignment.name) === canvasNameKey) || null
    }
  }

  return null
}

function compactWeeklyAssignment(assignment, canvasAssignment) {
  return {
    assignmentid: assignment.assignmentid || '',
    name: assignment.name || 'Untitled assignment',
    description: stripHtmlToText(assignment.description || ''),
    duedate: assignment.duedate || '',
    unlockdate: assignment.unlockdate || '',
    url: (canvasAssignment && canvasAssignment.html_url)
      || assignment.canvaspreviewurl
      || assignment.downloadurl
      || '',
    points_possible: canvasAssignment && canvasAssignment.points_possible,
    filechildren: Array.isArray(assignment.filechildren) ? assignment.filechildren.map(String) : []
  }
}

function createWeeklyBucket(weekStartMs) {
  return {
    weekStartMs: weekStartMs == null ? null : weekStartMs,
    sortKey: weekStartMs == null ? Number.MAX_SAFE_INTEGER : weekStartMs,
    files: [],
    assignments: [],
    seenFileIds: new Set(),
    seenAssignmentIds: new Set()
  }
}

function addWeeklyFile(bucket, file) {
  if (!file) return
  const fileId = String(file.id || file.name || '').trim()
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

function finalizeWeeklyBucket(bucket, weekNumber) {
  const scheduled = bucket.weekStartMs != null
  return {
    weekNumber: scheduled ? weekNumber : null,
    weekLabel: scheduled ? `Week ${weekNumber}` : 'Unscheduled',
    dateRange: formatWeekDateRange(bucket.weekStartMs),
    weekStart: scheduled ? new Date(bucket.weekStartMs).toISOString() : '',
    weekEnd: scheduled ? new Date(bucket.weekStartMs + 6 * 24 * 60 * 60 * 1000).toISOString() : '',
    isCurrentWeek: scheduled && isSameWeek(bucket.weekStartMs, Date.now(), WEEK_OPTIONS),
    sortKey: bucket.sortKey,
    files: bucket.files,
    assignments: bucket.assignments
  }
}

function buildWeeklySchedule(canvasData, rootDir) {
  const graph = readCanvasGraphFromRoot(rootDir)
  const graphFiles = graph.files || {}
  const syllabi = graph.syllabi || {}
  const lookup = makeCanvasTaskLookup(rootDir)
  const schedule = {}
  const courses = Array.isArray(canvasData && canvasData.courses) ? canvasData.courses : []

  courses.forEach(course => {
    if (!course || !course.id) return

    const courseId = String(course.id)
    const syllabus = syllabi[courseId] || syllabi[course.id]
    const loggedAssignments = syllabus && Array.isArray(syllabus.assignments) ? syllabus.assignments : []
    const modules = getCourseArrayBucket(canvasData, 'modules', courseId)
      .slice()
      .sort((left, right) => (left.position || 0) - (right.position || 0))
    const moduleItems = getCourseObjectBucket(canvasData, 'module_items', courseId)
    const canvasFiles = getCourseArrayBucket(canvasData, 'file', courseId)

    // All weekly grouping is keyed on the Monday that starts a calendar week.
    // null keys an "Unscheduled" bucket for objects that carry no usable date.
    const weekBuckets = new Map()
    const placedAssignmentIds = new Set()

    const getWeekBucket = weekStartMs => {
      const key = weekStartMs == null ? 'unscheduled' : String(weekStartMs)
      if (!weekBuckets.has(key)) {
        weekBuckets.set(key, createWeeklyBucket(weekStartMs))
      }
      return weekBuckets.get(key)
    }

    // Module pass: keep a module's materials together. Its files inherit the
    // earliest dated assignment in the module (files have no date of their own),
    // while each assignment lands in the week of its own due/unlock date.
    modules.forEach(module => {
      const items = (moduleItems[module.id] || moduleItems[String(module.id)] || [])
        .slice()
        .sort((left, right) => (left.position || 0) - (right.position || 0))
      const fileItems = items.filter(item => String(item.type || '').toLowerCase() === 'file')
      const assignmentItems = items.filter(item => {
        const type = String(item.type || '').toLowerCase()
        return type === 'assignment' || type === 'quiz' || type === 'discussion'
      })

      const resolvedAssignments = []
      assignmentItems.forEach(item => {
        const canvasAssignment = lookup.assignmentByCourseAndId.get(`${courseId}:${String(item.content_id || '')}`)
        const loggedAssignment = matchLoggedAssignment(loggedAssignments, item, canvasAssignment)
        if (!loggedAssignment) return
        resolvedAssignments.push({ loggedAssignment, canvasAssignment })
      })

      const moduleWeekMs = earliestWeekStartMs(
        resolvedAssignments.map(entry => entry.loggedAssignment.duedate || entry.loggedAssignment.unlockdate)
      )

      // Date-only: a module with no datable assignment has nowhere to anchor its
      // (dateless) files, so it is skipped rather than dumped into a week.
      if (moduleWeekMs != null) {
        const fileBucket = getWeekBucket(moduleWeekMs)
        fileItems.forEach(item => {
          const file = resolveWeeklyFile(graphFiles, courseId, item.content_id, canvasFiles)
          if (file) {
            addWeeklyFile(fileBucket, file)
            return
          }

          addWeeklyFile(fileBucket, {
            id: String(item.id || item.content_id || item.title || ''),
            name: item.title || 'Untitled file',
            courseid: courseId,
            description: item.type || 'File',
            url: item.html_url || item.url || '',
            downloadurl: item.url || '',
            canvaspreviewurl: item.html_url || ''
          })
        })
      }

      resolvedAssignments.forEach(({ loggedAssignment, canvasAssignment }) => {
        const weekStartMs = startOfWeekMs(loggedAssignment.duedate || loggedAssignment.unlockdate) ?? moduleWeekMs
        const bucket = getWeekBucket(weekStartMs)
        const compactAssignment = compactWeeklyAssignment(loggedAssignment, canvasAssignment)
        compactAssignment.filechildren.forEach(fileId => {
          addWeeklyFile(bucket, resolveWeeklyFile(graphFiles, courseId, fileId, canvasFiles))
        })
        addWeeklyAssignment(bucket, compactAssignment)
        placedAssignmentIds.add(String(loggedAssignment.assignmentid || loggedAssignment.name || ''))
      })
    })

    // Remaining logged assignments (not reached through any module).
    loggedAssignments.forEach(assignment => {
      const assignmentKey = String(assignment.assignmentid || assignment.name || '').trim()
      if (!assignmentKey || placedAssignmentIds.has(assignmentKey)) return

      const bucket = getWeekBucket(startOfWeekMs(assignment.duedate || assignment.unlockdate))
      const canvasAssignment = findCanvasAssignment(lookup, courseId, assignment)
      const compactAssignment = compactWeeklyAssignment(assignment, canvasAssignment)
      compactAssignment.filechildren.forEach(fileId => {
        addWeeklyFile(bucket, resolveWeeklyFile(graphFiles, courseId, fileId, canvasFiles))
      })
      addWeeklyAssignment(bucket, compactAssignment)
      placedAssignmentIds.add(assignmentKey)
    })

    const unscheduledBucket = weekBuckets.get('unscheduled') || null
    const scheduledStarts = Array.from(weekBuckets.values())
      .filter(bucket => bucket.weekStartMs != null)
      .map(bucket => bucket.weekStartMs)

    const courseWeeks = []
    if (scheduledStarts.length) {
      // Build a contiguous run of calendar weeks from the earliest object's week
      // through the latest, materializing empty weeks so none are skipped.
      const firstWeek = startOfWeek(Math.min(...scheduledStarts), WEEK_OPTIONS)
      const lastWeek = startOfWeek(Math.max(...scheduledStarts), WEEK_OPTIONS)
      const totalWeeks = differenceInCalendarWeeks(lastWeek, firstWeek, WEEK_OPTIONS) + 1

      for (let index = 0; index < totalWeeks; index += 1) {
        const weekStartMs = startOfWeek(addWeeks(firstWeek, index), WEEK_OPTIONS).getTime()
        const bucket = weekBuckets.get(String(weekStartMs)) || createWeeklyBucket(weekStartMs)
        courseWeeks.push(finalizeWeeklyBucket(bucket, index + 1))
      }
    }

    // "Unscheduled" (dateless objects) always sorts last and stays unnumbered.
    if (unscheduledBucket) {
      courseWeeks.push(finalizeWeeklyBucket(unscheduledBucket, null))
    }

    schedule[courseId] = courseWeeks
  })

  return schedule
}

function make_canvas_tasks(rootDir) {
  const parsedStatePath = path.join(rootDir, 'canvas_graph.json')
  if (!fs.existsSync(parsedStatePath)) {
    return []
  }

  let allCanvasNodes = {}
  try {
    const raw = fs.readFileSync(parsedStatePath, 'utf8')
    allCanvasNodes = raw.trim() ? JSON.parse(raw) : {}
  } catch (error) {
    console.error("Unable to read parsed Canvas task state:", error)
    return []
  }
  const canvasSyllabi = allCanvasNodes.syllabi || {}
  const canvasEvents = Array.isArray(allCanvasNodes.events) ? allCanvasNodes.events : []
  const conceptsByCourse = makeConceptLookup(allCanvasNodes)
  const problemsById = makeProblemLookup(allCanvasNodes)
  const canvasLookup = makeCanvasTaskLookup(rootDir)
  const tasks = []

  Object.entries(canvasSyllabi).forEach(([courseid, syllabus]) => {
    const assignments = Array.isArray(syllabus.assignments) ? syllabus.assignments : []
    assignments.forEach(assignment => {
      const assignmentId = assignment.assignmentid || `${courseid}-${assignment.name || 'assignment'}`
      const title = assignment.name || `Canvas assignment ${assignmentId}`
      const canvasAssignment = findCanvasAssignment(canvasLookup, syllabus.courseid || courseid, assignment)
      const assignmentFiles = collectAssignmentChildFiles(String(syllabus.courseid || courseid), assignment, allCanvasNodes)
      let assignmentUrls = uniqueUrls([
        canvasAssignment && canvasAssignment.html_url,
        assignment.canvaspreviewurl,
        ...assignmentFiles.map(file => file.url)
      ])
      if (!assignmentUrls.length) {
        assignmentUrls = uniqueUrls([
          assignment.downloadurl,
          canvasAssignment && canvasAssignment.url
        ])
      }
      if (!assignmentUrls.length) {
        assignmentUrls = uniqueUrls([
          getCourseHomeUrl(canvasLookup, syllabus.courseid || courseid)
        ])
      }
      tasks.push({
        id: `canvas-assignment-${courseid}-${assignmentId}`,
        workspaceId: '',
        course: getCourseTaskName(canvasLookup, syllabus.courseid || courseid),
        title,
        details: stripHtmlToText(assignment.description || ''),
        due: assignment.duedate || 'No due date',
        estimate: '',
        color: '#7f77dd',
        source: 'canvas',
        courseId: syllabus.courseid || courseid,
        type: 'canvas-assignment',
        assignmentId,
        unlockdate: assignment.unlockdate || '',
        gradepercentage: assignment.gradepercentage ?? null,
        downloadurl: assignment.downloadurl || '',
        canvaspreviewurl: assignment.canvaspreviewurl || '',
        assignmenturl: canvasAssignment && canvasAssignment.html_url || '',
        urls: assignmentUrls,
        problems: Array.isArray(assignment.problems) ? assignment.problems : [],
        filechildren: Array.isArray(assignment.filechildren) ? assignment.filechildren : [],
        assignmentFiles
      })
    })
  })

  canvasEvents.forEach(event => {
    const courseid = String(event.courseid || '')
    const eventType = String(event.type || '').toLowerCase()
    if (eventType !== 'test') return

    const eventId = event.eventid || `${courseid}-${event.name || 'event'}`
    const coveredConcepts = resolveEventConcepts(event, courseid, conceptsByCourse, problemsById)
    const studyFiles = collectStudyFilesDepthOne(courseid, coveredConcepts, allCanvasNodes)
    let studyUrls = uniqueUrls(studyFiles.map(file => file.url))
    if (!studyUrls.length) {
      studyUrls = uniqueUrls([getCourseHomeUrl(canvasLookup, courseid)])
    }
    tasks.push({
      id: `canvas-study-${courseid}-${eventId}`,
      workspaceId: '',
      course: getCourseTaskName(canvasLookup, courseid),
      title: `Study for ${event.name || `Canvas test ${eventId}`}`,
      details: formatEventTaskDetails(event, coveredConcepts, studyFiles),
      due: event.startdate || event.enddate || 'No due date',
      estimate: '',
      color: '#d85a30',
      source: 'canvas',
      courseId: courseid,
      type: 'canvas-study-task',
      parentEventId: eventId,
      parentEventName: event.name || '',
      parentEventType: event.type || '',
      eventType: event.type || '',
      gradepercentage: event.gradepercentage ?? null,
      urls: studyUrls,
      priority_weight: canvasStudyTaskImportance(event, coveredConcepts),
      coveredConcepts,
      studyFiles
    })
  })

  return tasks
}

function getParserProcess(authState, rootDir, onCanvasTasks) {
  const authSignature = JSON.stringify({
    cookie: authState.canvasAuthCookie || '',
    csrf: authState.canvasAuthCsrf || '',
    baseUrl: authState.canvasBaseUrl || ''
  })

  if (parserProc && !parserProc.killed && parserAuthSignature === authSignature) {
    return parserProc
  }

  if (parserProc && !parserProc.killed) {
    parserProc.kill()
    parserProc = null
  }

  parserProc = spawn('python', [path.join(rootDir, "parser.py")], {
    cwd: rootDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      CANVAS_AUTH_COOKIE: authState.canvasAuthCookie || '',
      CANVAS_AUTH_CSRF: authState.canvasAuthCsrf || '',
      CANVAS_BASE_URL: authState.canvasBaseUrl || ''
    }
  })
  let stdoutBuffer = ''
  let handledCompletion = false
  parserProc.on('error', error => {
    console.error('parser process error:', error && error.message ? error.message : error)
  })
  parserProc.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`parser exited with code ${code}${signal ? ` signal ${signal}` : ''}`)
    }
  })
  parserProc.stdout.on('data', chunk => {
    const text = chunk.toString()
    console.log(text)
    stdoutBuffer += text
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim().startsWith("parser task update assignment")) {
        onCanvasTasks(make_canvas_tasks(rootDir))
      }
      if (line.trim() === "parser completed__________________________________________________" && !handledCompletion) {
        handledCompletion = true
        onCanvasTasks(make_canvas_tasks(rootDir))
      }
      if (line.trim() === "parser local summaries completed__________________________________________________") {
        onCanvasTasks(make_canvas_tasks(rootDir))
      }
    }
  })
  parserProc.stderr.on('data', chunk => {
    console.error('parser:', chunk.toString())
  })
  parserProc.on('close', () => {
    parserProc = null
    parserAuthSignature = null
  })

  parserAuthSignature = authSignature
  return parserProc
}

function createCanvasApi({ canvasDataPath, getAuthState, sendCanvasDataUpdate, rootDir, onCanvasTasks = () => {} }) {
  const canvasRootDir = rootDir || path.resolve(__dirname, '..', '..')
  const envPath = path.join(canvasRootDir, '.env')
  function readCanvasData() {
    if (!fs.existsSync(canvasDataPath)) {
      return null
    }

    try {
      const raw = fs.readFileSync(canvasDataPath, 'utf8')
      if (!raw.trim()) return null
      const data = JSON.parse(raw)
      data.weekly_schedule = buildWeeklySchedule(data, canvasRootDir)
      return data
    } catch (error) {
      console.error("Unable to read Canvas data:", error)
      return null
    }
  }

  function getCanvasProjectGroups() {
    const canvasData = readCanvasData()
    if (!canvasData || !Array.isArray(canvasData.courses)) {
      return []
    }

    const assignmentsByCourse = canvasData.assignments || {}
    const filesByCourse = canvasData.file || {}
    const modulesByCourse = canvasData.modules || {}
    const canvasCourses = canvasData.courses
      .filter(course => course && course.id && course.workflow_state !== "deleted")
      .map((course, index) => {
        const courseAssignments = Array.isArray(assignmentsByCourse[course.id])
          ? assignmentsByCourse[course.id]
          : []
        const courseFiles = Array.isArray(filesByCourse[course.id])
          ? filesByCourse[course.id]
          : []
        const courseModules = Array.isArray(modulesByCourse[course.id])
          ? modulesByCourse[course.id]
          : []
        const assignmentLabel = courseAssignments.length === 1 ? "assignment" : "assignments"
        const fileLabel = courseFiles.length === 1 ? "file" : "files"
        const moduleLabel = courseModules.length === 1 ? "module" : "modules"

        return {
          id: `canvas-${course.id}`,
          name: course.name || course.course_code || `Canvas course ${course.id}`,
          meta: course.course_code || "Canvas",
          details: `${courseAssignments.length} ${assignmentLabel}, ${courseFiles.length} ${fileLabel}, ${courseModules.length} ${moduleLabel}. Default view: ${course.default_view || "unknown"}.`,
          color: canvasCourseColors[index % canvasCourseColors.length],
          source: "canvas",
          courseId: course.id
        }
      })

    if (canvasCourses.length === 0) {
      return []
    }

    return [{
      id: "canvas-courses",
      label: "Canvas Courses",
      items: canvasCourses
    }]
  }

  const CANVAS_MAX_CONCURRENT = 4
  let canvasInFlight = 0
  const canvasWaitQueue = []

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function acquireCanvasSlot() {
    if (canvasInFlight < CANVAS_MAX_CONCURRENT) {
      canvasInFlight += 1
      return
    }
    await new Promise(resolve => canvasWaitQueue.push(resolve))
    canvasInFlight += 1
  }

  function releaseCanvasSlot() {
    canvasInFlight = Math.max(0, canvasInFlight - 1)
    const next = canvasWaitQueue.shift()
    if (next) next()
  }

  async function mapWithConcurrency(items, mapper, concurrency = CANVAS_MAX_CONCURRENT) {
    if (!items.length) return []
    const results = new Array(items.length)
    let index = 0
    const limit = Math.max(1, Math.min(concurrency, items.length))

    async function worker() {
      while (index < items.length) {
        const current = index
        index += 1
        results[current] = await mapper(items[current], current)
      }
    }

    await Promise.all(Array.from({ length: limit }, () => worker()))
    return results
  }

  function formatCanvasError(error) {
    const message = error && error.message ? error.message : String(error)
    return message.split('\n')[0]
  }

  function getCanvasApiHeaders() {
    const { canvasAuthCookie, canvasAuthCsrf } = getAuthState()
    const headers = {
      'Cookie': canvasAuthCookie
    }
    if (canvasAuthCsrf) {
      headers['X-CSRF-Token'] = canvasAuthCsrf
    }
    return headers
  }

  async function fetchCanvasJson(url) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await acquireCanvasSlot()
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: getCanvasApiHeaders()
        })

        if (response.status === 429 && attempt < 4) {
          const retryAfterHeader = Number(response.headers.get('retry-after'))
          const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
            ? retryAfterHeader * 1000
            : (attempt + 1) * 1500
          await sleep(waitMs)
          continue
        }

        if (!response.ok) {
          const body = await response.text()
          const detail = response.status === 429
            ? 'Rate limit exceeded'
            : body.slice(0, 200)
          throw new Error(`Canvas API request failed ${response.status} ${response.statusText}: ${url}${detail ? ` (${detail})` : ''}`)
        }

        return response.json()
      } finally {
        releaseCanvasSlot()
      }
    }

    throw new Error(`Canvas API request failed 429 Too Many Requests: ${url} (Rate limit exceeded)`)
  }

  async function fetchCanvasJsonOrEmpty(url, context, errors) {
    try {
      return await fetchCanvasJson(url)
    } catch (error) {
      const message = formatCanvasError(error)
      errors.push({
        context,
        url,
        message
      })
      return []
    }
  }

  async function fetchCanvasJsonOrNull(url, context, errors) {
    try {
      return await fetchCanvasJson(url)
    } catch (error) {
      const message = formatCanvasError(error)
      if (!message.includes('404')) {
        errors.push({
          context,
          url,
          message
        })
      }
      return null
    }
  }

  async function fetchCanvasCourseBuckets(courses, pathName, errors) {
    const { canvasBaseUrl } = getAuthState()
    const buckets = {}

    await mapWithConcurrency(courses, async tcourse => {
      const url = canvasBaseUrl + '/api/v1/courses/' + tcourse.id + `/${pathName}?per_page=100`
      buckets[tcourse.id] = await fetchCanvasJsonOrEmpty(url, `course ${tcourse.id} ${pathName}`, errors)
    })

    return buckets
  }

  function withCanvasPerPage(url) {
    return url.includes('?') ? `${url}&per_page=100` : `${url}?per_page=100`
  }

  async function fetchCanvasModuleItemBuckets(modulesByCourse, errors) {
    const buckets = {}
    const jobs = []

    Object.entries(modulesByCourse).forEach(([courseId, modules]) => {
      buckets[courseId] = {}
      if (!Array.isArray(modules)) return

      modules.forEach(module => {
        if (!module || !module.id || !module.items_url) return
        jobs.push({ courseId, module })
      })
    })

    await mapWithConcurrency(jobs, async ({ courseId, module }) => {
      const items = await fetchCanvasJsonOrEmpty(
        withCanvasPerPage(module.items_url),
        `course ${courseId} module ${module.id} items`,
        errors
      )
      buckets[courseId][module.id] = items
    })

    return buckets
  }

  async function fetchCanvasFrontPages(courses, errors) {
    const { canvasBaseUrl } = getAuthState()
    const buckets = {}

    await mapWithConcurrency(courses, async tcourse => {
      const url = canvasBaseUrl + '/api/v1/courses/' + tcourse.id + '/front_page'
      const page = await fetchCanvasJsonOrNull(url, `course ${tcourse.id} front page`, errors)
      if (page) {
        buckets[tcourse.id] = page
      }
    })

    return buckets
  }

  async function fetchCanvasCourseSyllabi(courses, errors) {
    const { canvasBaseUrl } = getAuthState()
    const buckets = {}

    await mapWithConcurrency(courses, async tcourse => {
      const url = canvasBaseUrl + '/api/v1/courses/' + tcourse.id + '?include[]=syllabus_body'
      const course = await fetchCanvasJsonOrNull(url, `course ${tcourse.id} syllabus`, errors)
      const syllabusBody = course && stripHtmlToText(course.syllabus_body || '')
      if (syllabusBody) {
        buckets[tcourse.id] = {
          id: tcourse.id,
          name: tcourse.name || course.name || '',
          html_url: course.html_url || tcourse.html_url || '',
          syllabus_body: course.syllabus_body || '',
          syllabus_text: syllabusBody
        }
      }
    })

    return buckets
  }

  function summarizeCanvasErrors(errors) {
    if (!Array.isArray(errors) || !errors.length) return

    const rateLimited = errors.filter(error => String(error.message || '').includes('429')).length
    const contexts = {}
    errors.forEach(error => {
      const key = String(error.context || 'unknown').replace(/\s+\d+$/, '')
      contexts[key] = (contexts[key] || 0) + 1
    })
    const breakdown = Object.entries(contexts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([label, count]) => `${label} (${count})`)
      .join(', ')

    console.warn(
      `Canvas sync finished with ${errors.length} skipped requests` +
      `${rateLimited ? `, ${rateLimited} rate-limited` : ''}` +
      `${breakdown ? `: ${breakdown}` : ''}`
    )
  }

  function saveCanvasHomepages(courses, frontPages) {
    const homepagesRoot = path.join(__dirname, 'canvas_homepages')
    fs.mkdirSync(homepagesRoot, { recursive: true })

    courses.forEach(course => {
      const frontPage = frontPages[course.id] || frontPages[String(course.id)]
      if (!frontPage || course.default_view !== 'wiki' || !frontPage.body) return

      fs.writeFileSync(path.join(homepagesRoot, String(course.id) + '.html'), withNucleusHomepageTheme(frontPage.body), 'utf8')
    })
  }

  function withNucleusHomepageTheme(html) {
    const theme = `
<style id="nucleus-canvas-homepage-theme">
  :root {
    color-scheme: dark;
    --nucleus-bg: #0f1117;
    --nucleus-surface: #171a21;
    --nucleus-surface-2: #1d212b;
    --nucleus-border: #262b36;
    --nucleus-text: #e7e9ee;
    --nucleus-text-dim: #b7c0d4;
    --nucleus-accent: #7f77dd;
  }

  html,
  body {
    background: var(--nucleus-bg) !important;
    color: var(--nucleus-text) !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }

  body {
    margin: 0;
    padding: 28px;
  }

  a {
    color: #9eb6ff !important;
  }

  p,
  li,
  td,
  th,
  div,
  span {
    color: inherit;
  }

  table {
    background: var(--nucleus-surface) !important;
    border-collapse: collapse;
    color: var(--nucleus-text) !important;
  }

  th,
  td {
    border-color: var(--nucleus-border) !important;
  }

  img,
  iframe,
  video {
    max-width: 100%;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    color: #ffffff !important;
  }
</style>
`
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head[^>]*>/i, match => match + theme)
    }

    return `<!doctype html>
<html>
<head>${theme}</head>
<body>
${html}
</body>
</html>`
  }

  async function setupCanvasData() {
    const authState = getAuthState()
    const { canvasAuthCookie, canvasBaseUrl } = authState
    if (!fs.existsSync(canvasDataPath)) {
      fs.writeFileSync(canvasDataPath, '')
    }
    if (!canvasAuthCookie || !canvasBaseUrl) {
      throw new Error("Canvas auth is missing cookie or base URL.")
    }
    const profileresponse = fetchCanvasJson(canvasBaseUrl + '/api/v1/users/self')
    const coursesresponse = fetchCanvasJson(canvasBaseUrl + '/api/v1/courses?per_page=100')
    const responses = await Promise.all([
      profileresponse,
      coursesresponse
    ])
    saveCanvasAuthToEnv(envPath, authState)
    const proc = getParserProcess(authState, canvasRootDir, onCanvasTasks)
    const prof = responses[0]
    const course = responses[1]
    if (!Array.isArray(course)) {
      throw new Error("Canvas courses response was not an array: " + JSON.stringify(course).slice(0, 500))
    }
    const canvasErrors = []
    let filecount = 0
    const data1 = { profile: prof, courses: course }
    data1.front_pages = await fetchCanvasFrontPages(course, canvasErrors)
    data1.syllabi = await fetchCanvasCourseSyllabi(course, canvasErrors)
    saveCanvasHomepages(course, data1.front_pages)
    const parsingSyllabi = []
    Object.entries(data1.syllabi).forEach(([courseid, syllabus]) => {
      if (!syllabus || !syllabus.syllabus_text) return
      parsingSyllabi.push({
        id: `course-syllabus-${courseid}`,
        url: syllabus.html_url || `${canvasBaseUrl}/courses/${courseid}/assignments/syllabus`,
        previewurl: syllabus.html_url || `${canvasBaseUrl}/courses/${courseid}/assignments/syllabus`,
        courseid,
        name: `${syllabus.name || 'Course'} syllabus`,
        content: JSON.stringify({
          documenttype: 'syllabus',
          coursename: syllabus.name || '',
          html_url: syllabus.html_url || '',
          syllabus: syllabus.syllabus_text
        }, null, 2)
      })
    })
    function writeParserLine(payload) {
      if (!proc || proc.killed || !proc.stdin || proc.stdin.destroyed || proc.stdin.writableEnded) {
        console.warn('parser stdin unavailable; skipped parser payload')
        return false
      }
      const line = payload === 'None' ? 'None' : JSON.stringify(payload)
      proc.stdin.write(`${line}\n`, 'utf8')
      return true
    }

    if (parsingSyllabi.length) {
      writeParserLine({ type: "syllabus", content: parsingSyllabi })
    }
    data1.assignments = await fetchCanvasCourseBuckets(course, 'assignments', canvasErrors)
    for (const [courseid, assignments] of Object.entries(data1.assignments)) {
      if (!Array.isArray(assignments)) continue
      const parsingAssignments = []
      for (const assignment of assignments) {
        if (assignment.id && assignment.name) {
          parsingAssignments.push({
            id: assignment.id,
            url: assignment.html_url || '',
            previewurl: assignment.html_url || '',
            courseid,
            name: assignment.name,
            content: JSON.stringify({
              documenttype: 'assignment',
              assignmentname: assignment.name,
              description: stripHtmlToText(assignment.description || ''),
              duedate: assignment.due_at || '',
              unlockdate: assignment.unlock_at || '',
              lockdate: assignment.lock_at || '',
              points_possible: assignment.points_possible ?? '',
              html_url: assignment.html_url || ''
            }, null, 2)
          })
        }
      }
      if (parsingAssignments.length) {
        writeParserLine({ type: "assignment", content: parsingAssignments })
      }
    }
    data1.file = await fetchCanvasCourseBuckets(course, 'files', canvasErrors)
    Object.keys(data1.file).forEach(courseid => {
      let parseingfiles = []
      data1.file[courseid].forEach(file => {
        if (file.id && file["content-type"] && file["mime_class"]) {
          file.previewurl = `${canvasBaseUrl}/courses/${courseid}/files?preview=${file.id}`
          if (file["content-type"] === 'application/pdf') {
            parseingfiles.push({url: file.url, previewurl: file.previewurl, id: file.id, name: file.display_name || file.filename || file.name || '', courseid:courseid})
          }
        } else {
          file.previewurl = null
        }
      })
      writeParserLine({ type: "file", content: parseingfiles })
    })

    data1.modules = await fetchCanvasCourseBuckets(course, 'modules', canvasErrors)
    data1.module_items = await fetchCanvasModuleItemBuckets(data1.modules, canvasErrors)
    if (canvasErrors.length) {
      data1.errors = canvasErrors
      summarizeCanvasErrors(canvasErrors)
    } else {
      delete data1.errors
    }
    data1.weekly_schedule = buildWeeklySchedule(data1, canvasRootDir)
    writeJsonFileAtomic(canvasDataPath, data1)
    if (!writeParserLine('None')) {
      console.warn('Canvas parser did not receive completion signal; parsing may not start.')
    }
    sendCanvasDataUpdate()
  }


  return {
    getCanvasTasksFromDisk: () => make_canvas_tasks(canvasRootDir),
    getCanvasProjectGroups,
    readCanvasData,
    setupCanvasData
  }
}

module.exports = {
  createCanvasApi
}
