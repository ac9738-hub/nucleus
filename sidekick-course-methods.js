// Poll the Canvas graph for course-specific concepts, formulas, and problem-solving methods.

const METHOD_FILE_TYPES = new Set([
  'reference_sheet',
  'textbook_chapter',
  'lecture_slides',
  'lecture_notes',
  'problem_set',
  'review_sheet'
])

const ROW_TEXT_KEYS = [
  'title', 'name', 'term', 'topic', 'objective', 'summary', 'text', 'statement',
  'definition', 'question', 'theme', 'policyType', 'method', 'symbol'
]

const MAX_METHOD_ROWS_PER_FILE = 24
const MAX_METHODS_CONTEXT_CHARS = 8000
const MAX_CONCEPTS = 12
const MAX_FORMULAS = 24
const MAX_PROBLEMS = 8

function queryTerms(query) {
  return String(query || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []
}

function scoreText(text, terms) {
  if (!terms.length) return 0
  const hay = String(text || '').toLowerCase()
  let score = 0
  for (const term of terms) {
    if (term.length >= 3 && hay.includes(term)) score += 1
  }
  return score
}

function courseIdFromUrl(value) {
  try {
    const match = new URL(String(value || '')).pathname.match(/\/courses\/([^/]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  } catch (_error) {
    return ''
  }
}

const { buildVectorRetrievalScope } = require('./lib/workspace-retrieval-policy')

function resolveSidekickFocusCourseIds(contextSnapshot, screenSlice) {
  const packet = contextSnapshot && contextSnapshot.workspaceContext
  if (packet && packet.pruneOptions) {
    return Array.isArray(packet.pruneOptions.focusCourseIds)
      ? [...packet.pruneOptions.focusCourseIds]
      : []
  }

  const ids = new Set()
  const index = contextSnapshot && contextSnapshot.index
  if (index && Array.isArray(index.focusCourseIds)) {
    index.focusCourseIds.forEach(id => {
      if (id) ids.add(String(id))
    })
  }
  const session = contextSnapshot && contextSnapshot.workspaceSession
  if (session && session.focus && session.focus.courseId) {
    ids.add(String(session.focus.courseId))
  }
  if (session && session.courseScope && Array.isArray(session.courseScope.primaryCourseIds)) {
    session.courseScope.primaryCourseIds.forEach(id => {
      if (id) ids.add(String(id))
    })
  }
  const canvas = screenSlice && screenSlice.canvas
  if (canvas && canvas.courseid) ids.add(String(canvas.courseid))
  const activeTab = contextSnapshot && contextSnapshot.activeTab
  if (activeTab && activeTab.courseId) ids.add(String(activeTab.courseId))
  if (activeTab && activeTab.url) {
    const fromUrl = courseIdFromUrl(activeTab.url)
    if (fromUrl) ids.add(fromUrl)
  }
  return [...ids]
}

function compactMethodRows(typeExtractions, sourceName = '', maxRows = MAX_METHOD_ROWS_PER_FILE) {
  if (!typeExtractions || typeof typeExtractions !== 'object') return []
  const rows = []
  const seen = new Set()

  const addRow = (category, label, text) => {
    const body = String(text || '').replace(/\s+/g, ' ').trim()
    const title = String(label || category || '').trim()
    if (!body && !title) return
    const key = `${title}:${body.slice(0, 96)}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    rows.push({
      category: String(category || ''),
      label: title,
      text: body.slice(0, 280),
      source: String(sourceName || '')
    })
  }

  for (const categories of Object.values(typeExtractions)) {
    if (!categories || typeof categories !== 'object') continue
    for (const [category, list] of Object.entries(categories)) {
      if (!Array.isArray(list)) continue
      for (const row of list) {
        if (!row || typeof row !== 'object') continue
        const label = ROW_TEXT_KEYS.map(key => row[key]).find(value => value) || category
        const parts = []
        for (const key of ROW_TEXT_KEYS) {
          const value = row[key]
          if (Array.isArray(value)) parts.push(...value.map(String))
          else if (value != null && value !== '') parts.push(String(value))
        }
        addRow(category, label, parts.join(' '))
        if (rows.length >= maxRows) return rows
      }
    }
  }
  return rows
}

function compactMethodRowsForFile(file) {
  if (!file || typeof file !== 'object') return []
  const fileType = String(file.academicFileType || '').trim()
  if (fileType && !METHOD_FILE_TYPES.has(fileType)) return []
  return compactMethodRows(file.typeExtractions, file.name || file.fileid || '')
}

function inCourseScope(courseid, courseIds) {
  if (!courseIds || !courseIds.length) return true
  return courseIds.includes(String(courseid || ''))
}

function collectVisibleNodes(screenSlice) {
  const canvas = screenSlice && screenSlice.canvas
  if (!canvas || typeof canvas !== 'object') {
    return { concepts: [], details: [], examples: [], problems: [] }
  }
  return {
    concepts: Array.isArray(canvas.concepts) ? canvas.concepts : [],
    details: Array.isArray(canvas.details) ? canvas.details : [],
    examples: Array.isArray(canvas.examples) ? canvas.examples : [],
    problems: Array.isArray(canvas.problems) ? canvas.problems : []
  }
}

function nodeKey(node) {
  return String(
    (node && (node.problemid || node.conceptid || node.id || node.name)) || ''
  ).trim()
}

function formatProblemSteps(steps) {
  const formatted = []
  for (const [index, step] of (steps || []).entries()) {
    let text = ''
    if (step && typeof step === 'object') {
      text = String(step.text || step.description || step.step || '').trim()
    } else {
      text = String(step || '').trim()
    }
    if (text) formatted.push(`${index + 1}. ${text}`)
  }
  return formatted
}

function pollCourseProblemSolvingContext({
  graph,
  query = '',
  courseIds = [],
  visibleNodes = {}
}) {
  if (!graph || typeof graph !== 'object') {
    return { concepts: [], formulas: [], problems: [], learningBlocks: [], assignmentNotes: [] }
  }

  const terms = queryTerms(query)
  const conceptById = new Map()
  for (const concept of graph.concepts || []) {
    if (!concept || !inCourseScope(concept.courseid, courseIds)) continue
    const id = nodeKey(concept)
    if (id) conceptById.set(id, concept)
    if (concept.name) conceptById.set(String(concept.name), concept)
  }

  const visibleProblemIds = new Set(
    (visibleNodes.problems || []).map(node => nodeKey(node)).filter(Boolean)
  )
  const visibleConceptIds = new Set(
    [...(visibleNodes.concepts || []), ...(visibleNodes.details || []), ...(visibleNodes.examples || [])]
      .map(node => nodeKey(node))
      .filter(Boolean)
  )

  const problemCandidates = []
  for (const problem of graph.problems || []) {
    if (!problem || !inCourseScope(problem.courseid, courseIds)) continue
    const id = nodeKey(problem)
    let score = scoreText(`${problem.name || ''} ${problem.description || ''}`, terms)
    if (visibleProblemIds.has(id)) score += 8
    if (score > 0 || visibleProblemIds.has(id)) {
      problemCandidates.push({ problem, score })
    }
  }
  problemCandidates.sort((a, b) => b.score - a.score)

  const selectedProblems = []
  const linkedConceptIds = new Set()
  for (const entry of problemCandidates.slice(0, MAX_PROBLEMS)) {
    const problem = entry.problem
    const related = []
    for (const conceptId of [
      ...(problem.incomingConceptNodeIds || []),
      ...(problem.outgoingConceptNodeIds || [])
    ]) {
      const concept = conceptById.get(String(conceptId))
      if (concept) {
        linkedConceptIds.add(nodeKey(concept))
        related.push(String(concept.name || ''))
      }
    }
    selectedProblems.push({
      name: String(problem.name || ''),
      description: String(problem.description || '').slice(0, 240),
      steps: formatProblemSteps(problem.steps),
      relatedConcepts: related.filter(Boolean)
    })
  }

  for (const concept of visibleNodes.concepts || []) {
    const id = nodeKey(concept)
    if (id) linkedConceptIds.add(id)
  }

  const conceptCandidates = []
  for (const concept of graph.concepts || []) {
    if (!concept || !inCourseScope(concept.courseid, courseIds)) continue
    const id = nodeKey(concept)
    let score = scoreText(`${concept.name || ''} ${concept.description || ''}`, terms)
    if (linkedConceptIds.has(id)) score += 10
    if (visibleConceptIds.has(id)) score += 6
    if (score > 0 || linkedConceptIds.has(id) || visibleConceptIds.has(id)) {
      const details = (concept.details || [])
        .map(detail => ({
          name: String(detail.name || ''),
          description: String(detail.description || '').slice(0, 220)
        }))
        .filter(item => item.name || item.description)
        .slice(0, 3)
      const examples = (concept.examples || [])
        .map(example => ({
          name: String(example.name || ''),
          description: String(example.description || '').slice(0, 220)
        }))
        .filter(item => item.name || item.description)
        .slice(0, 2)
      conceptCandidates.push({
        concept,
        score,
        details,
        examples
      })
    }
  }
  conceptCandidates.sort((a, b) => b.score - a.score)

  const selectedConcepts = conceptCandidates.slice(0, MAX_CONCEPTS).map(entry => ({
    name: String(entry.concept.name || ''),
    description: String(entry.concept.description || '').slice(0, 260),
    details: entry.details,
    examples: entry.examples
  }))

  const formulaCandidates = []
  for (const courseFiles of Object.values(graph.files || {})) {
    if (!courseFiles || typeof courseFiles !== 'object') continue
    for (const file of Object.values(courseFiles)) {
      if (!file || !inCourseScope(file.courseid, courseIds)) continue
      for (const row of compactMethodRowsForFile(file)) {
        const score = scoreText(`${row.label} ${row.text}`, terms)
        if (score > 0 || linkedConceptIds.size || visibleProblemIds.size) {
          formulaCandidates.push({ ...row, score: score + (row.category.includes('theorem') ? 1 : 0) })
        }
      }
    }
  }
  formulaCandidates.sort((a, b) => b.score - a.score)
  let formulas = formulaCandidates.slice(0, MAX_FORMULAS).map(row => ({
    label: row.label,
    text: row.text,
    category: row.category,
    source: row.source
  }))
  if (!formulas.length && linkedConceptIds.size && queryTerms.length) {
    const fallback = []
    for (const courseFiles of Object.values(graph.files || {})) {
      if (!courseFiles || typeof courseFiles !== 'object') continue
      for (const file of Object.values(courseFiles)) {
        if (!file || !inCourseScope(file.courseid, courseIds)) continue
        for (const row of compactMethodRowsForFile(file)) {
          if (scoreText(`${row.label} ${row.text}`, queryTerms) > 0) fallback.push(row)
        }
        if (fallback.length >= MAX_FORMULAS) break
      }
      if (fallback.length >= MAX_FORMULAS) break
    }
    formulas = fallback.slice(0, MAX_FORMULAS).map(row => ({
      label: row.label,
      text: row.text,
      category: row.category,
      source: row.source
    }))
  }

  const learningBlocks = []
  for (const [courseId, blocks] of Object.entries(graph.learningBlocks || {})) {
    if (!inCourseScope(courseId, courseIds)) continue
    for (const block of blocks || []) {
      if (!block) continue
      const conceptId = String(block.conceptId || '')
      if (!linkedConceptIds.has(conceptId) && scoreText(block.explanation || '', terms) === 0) continue
      learningBlocks.push({
        conceptId,
        explanation: String(block.explanation || '').slice(0, 260),
        practiceProblems: (block.practiceProblems || []).slice(0, 3).map(String)
      })
      if (learningBlocks.length >= 4) break
    }
  }

  const assignmentNotes = []
  for (const assignment of graph.assignments || []) {
    if (!assignment || !inCourseScope(assignment.courseid, courseIds)) continue
    const lookingfor = (assignment.lookingfor || []).map(String).filter(Boolean)
    const conceptRequirements = (assignment.conceptRequirements || []).map(String).filter(Boolean)
    const score = scoreText(`${assignment.name || ''} ${lookingfor.join(' ')}`, terms)
    if (!score && !lookingfor.length && !conceptRequirements.length) continue
    assignmentNotes.push({
      name: String(assignment.name || ''),
      lookingfor: lookingfor.slice(0, 4),
      conceptRequirements: conceptRequirements.slice(0, 6)
    })
    if (assignmentNotes.length >= 3) break
  }

  return {
    concepts: selectedConcepts,
    formulas,
    problems: selectedProblems,
    learningBlocks,
    assignmentNotes
  }
}

function formatCourseMethodsContext(poll, { maxChars = MAX_METHODS_CONTEXT_CHARS } = {}) {
  if (!poll || typeof poll !== 'object') return ''
  const lines = [
    'Course graph (concepts, formulas, and problem-solving methods for this course):'
  ]
  let chars = lines[0].length

  const appendLine = line => {
    const text = String(line || '').trim()
    if (!text) return false
    if (chars + text.length + 1 > maxChars) return false
    lines.push(text)
    chars += text.length + 1
    return true
  }

  for (const problem of poll.problems || []) {
    if (!appendLine(`Problem: ${problem.name}`)) break
    if (problem.description) appendLine(`  Statement: ${problem.description}`)
    if (problem.relatedConcepts && problem.relatedConcepts.length) {
      appendLine(`  Linked concepts: ${problem.relatedConcepts.join(', ')}`)
    }
    for (const step of problem.steps || []) {
      if (!appendLine(`  Step ${step}`)) break
    }
  }

  for (const concept of poll.concepts || []) {
    if (!appendLine(`Concept: ${concept.name}`)) break
    if (concept.description) appendLine(`  ${concept.description}`)
    for (const detail of concept.details || []) {
      if (!appendLine(`  Detail — ${detail.name}: ${detail.description}`)) break
    }
    for (const example of concept.examples || []) {
      if (!appendLine(`  Example — ${example.name}: ${example.description}`)) break
    }
  }

  for (const formula of poll.formulas || []) {
    const source = formula.source ? ` (${formula.source})` : ''
    if (!appendLine(`Formula/definition${source}: ${formula.label} — ${formula.text}`)) break
  }

  for (const block of poll.learningBlocks || []) {
    if (!appendLine(`Lesson block${block.conceptId ? ` [${block.conceptId}]` : ''}: ${block.explanation}`)) break
  }

  for (const assignment of poll.assignmentNotes || []) {
    if (!appendLine(`Assignment expectations — ${assignment.name}`)) break
    if (assignment.lookingfor && assignment.lookingfor.length) {
      appendLine(`  Looking for: ${assignment.lookingfor.join('; ')}`)
    }
    if (assignment.conceptRequirements && assignment.conceptRequirements.length) {
      appendLine(`  Required concepts: ${assignment.conceptRequirements.join(', ')}`)
    }
  }

  if (lines.length <= 1) return ''
  lines.push(
    'When helping with this problem, explain using these course-specific concepts and formulas. '
    + 'Match lecture notation and grading expectations; cite retrieved [R#] or on-screen [C#] labels when quoting sources.'
  )
  return lines.join('\n')
}

function buildVectorRetrievalOptions({
  hints = {},
  answerMode,
  contextSnapshot,
  screenSlice,
  k
}) {
  const options = { mode: 'agent', k: k || undefined }
  const groundedMode = String(answerMode || '').trim().toLowerCase() !== 'general'
  if (!groundedMode) return options

  const packet = contextSnapshot && contextSnapshot.workspaceContext
  if (packet) {
    if (packet.restrictToFocus && packet.focusCourseIds.length) {
      options.focusCourseIds = [...packet.focusCourseIds]
    } else if (packet.preferFocus && packet.preferFocus.length) {
      options.focusCourseIds = [...packet.preferFocus]
    }
  } else {
    const session = contextSnapshot && contextSnapshot.workspaceSession
    if (session) {
      Object.assign(options, buildVectorRetrievalScope(session, {
        tabs: contextSnapshot.tabs || [],
        activeTab: contextSnapshot.activeTab,
        allCourseIds: (contextSnapshot.index && contextSnapshot.index.courses || [])
          .map(course => course.id)
      }))
    } else {
      const focusCourseIds = resolveSidekickFocusCourseIds(contextSnapshot, screenSlice)
      if (focusCourseIds.length) options.focusCourseIds = focusCourseIds
    }
  }

  if (hints.problemQuery || hints.academicQuery) options.grounded = true
  if (hints.problemQuery) options.problemQuery = true
  return options
}

function shouldPollCourseMethods(hints = {}, answerMode, screenSlice) {
  const groundedMode = String(answerMode || '').trim().toLowerCase() !== 'general'
  if (!groundedMode) return false
  if (hints.problemQuery) return true
  const visible = collectVisibleNodes(screenSlice)
  return Boolean((visible.problems || []).length)
}

module.exports = {
  METHOD_FILE_TYPES,
  compactMethodRows,
  compactMethodRowsForFile,
  resolveSidekickFocusCourseIds,
  collectVisibleNodes,
  pollCourseProblemSolvingContext,
  formatCourseMethodsContext,
  buildVectorRetrievalOptions,
  shouldPollCourseMethods
}
