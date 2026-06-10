const fs = require('fs')
const path = require('path')
const { readGradescopeAuth } = require('./auth')
const { syncGradescopeCourses } = require('./client')

const GRADESCOPE_STATE_PATH = path.join(__dirname, '..', '..', '..', 'gradescope_state.json')

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function matchCanvasAssignmentToGradescope(canvasAssignment, gradescopeAssignments) {
  const canvasName = normalizeName(canvasAssignment.name || canvasAssignment.title)
  if (!canvasName) return null

  let best = null
  let bestScore = 0
  for (const candidate of gradescopeAssignments) {
    const candidateName = normalizeName(candidate.title)
    if (!candidateName) continue
    let score = 0
    if (candidateName === canvasName) score = 1
    else if (candidateName.includes(canvasName) || canvasName.includes(candidateName)) score = 0.8
    else {
      const canvasTokens = new Set(canvasName.split(' '))
      const overlap = candidateName.split(' ').filter(token => canvasTokens.has(token)).length
      score = overlap / Math.max(canvasTokens.size, 1)
    }
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return bestScore >= 0.5 ? best : null
}

async function syncGradescopeState(canvasData = {}) {
  const auth = readGradescopeAuth()
  if (!auth || !auth.cookie) {
    return { synced: false, reason: 'missing_auth' }
  }

  const remote = await syncGradescopeCourses(auth)
  const mappings = []

  const assignmentsByCourse = canvasData.assignments || {}
  Object.entries(assignmentsByCourse).forEach(([courseId, assignments]) => {
    if (!Array.isArray(assignments)) return
    assignments.forEach(assignment => {
      const gradescopeMatch = remote.courses
        .map(course => matchCanvasAssignmentToGradescope(assignment, course.assignments))
        .find(Boolean)
      if (!gradescopeMatch) return
      mappings.push({
        courseId: String(courseId),
        canvasAssignmentId: String(assignment.id),
        canvasAssignmentName: assignment.name || '',
        gradescopeAssignmentId: gradescopeMatch.id,
        gradescopeAssignmentTitle: gradescopeMatch.title,
        gradescopeUrl: gradescopeMatch.url,
        submissionStatus: gradescopeMatch.status,
        dueText: gradescopeMatch.dueText
      })
    })
  })

  const state = {
    synced_at: remote.synced_at,
    courses: remote.courses,
    mappings
  }
  fs.writeFileSync(GRADESCOPE_STATE_PATH, JSON.stringify(state, null, 2))
  return { synced: true, state }
}

module.exports = {
  GRADESCOPE_STATE_PATH,
  syncGradescopeState,
  matchCanvasAssignmentToGradescope
}
