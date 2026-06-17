// Study task section planner and progress tracking.
// Splits canvas study tasks into multi-session sections from learning blocks,
// covered concepts, or study files; tracks completion state for ranking.

function normalizeSectionStatus(value) {
  const status = String(value || 'pending').toLowerCase()
  return status === 'done' || status === 'complete' || status === 'completed'
    ? 'done'
    : 'pending'
}

function parseEstimateHours(task = {}) {
  const explicit = Number(task.estimated_hours ?? task.estimatedHours)
  if (Number.isFinite(explicit)) return explicit

  const estimate = task.estimate
  if (typeof estimate === 'number') return estimate
  if (typeof estimate === 'string') {
    const match = estimate.match(/(\d+(?:\.\d+)?)/)
    if (match) return Number(match[1])
  }

  return NaN
}

function buildStudySectionsFromTask(task = {}) {
  const learningBlocks = Array.isArray(task.learningBlocks) ? task.learningBlocks : []
  if (learningBlocks.length) {
    return learningBlocks
      .map((block, index) => ({
        id: String(block.blockId || block.block_id || `block-${index + 1}`),
        label: String(
          block.conceptName
          || block.conceptId
          || block.explanation
          || `Section ${index + 1}`
        ).slice(0, 120),
        source: 'learningBlock',
        sourceId: String(block.blockId || block.block_id || ''),
        order: Number(block.order) || index + 1,
        status: 'pending'
      }))
      .sort((left, right) => left.order - right.order)
  }

  const coveredConcepts = Array.isArray(task.coveredConcepts) ? task.coveredConcepts : []
  if (coveredConcepts.length) {
    return coveredConcepts.map((concept, index) => ({
      id: String(concept.conceptid || concept.id || `concept-${index + 1}`),
      label: String(concept.name || concept.title || `Concept ${index + 1}`),
      source: 'concept',
      sourceId: String(concept.conceptid || concept.id || ''),
      order: index + 1,
      status: 'pending'
    }))
  }

  const studyFiles = Array.isArray(task.studyFiles) ? task.studyFiles : []
  if (studyFiles.length) {
    return studyFiles.map((file, index) => ({
      id: String(file.id || file.fileid || `file-${index + 1}`),
      label: String(file.name || `Reading ${index + 1}`),
      source: 'file',
      sourceId: String(file.id || file.fileid || ''),
      order: index + 1,
      status: 'pending'
    }))
  }

  const sectionHours = Number(task.studySectionHours ?? task.study_section_hours) || 1.25
  const estimateHours = parseEstimateHours(task)
  if (Number.isFinite(estimateHours) && estimateHours > sectionHours * 1.5) {
    const sectionCount = Math.min(8, Math.max(2, Math.ceil(estimateHours / sectionHours)))
    return Array.from({ length: sectionCount }, (_, index) => ({
      id: `session-${index + 1}`,
      label: `Session ${index + 1}`,
      source: 'estimate',
      sourceId: '',
      order: index + 1,
      status: 'pending'
    }))
  }

  return [{
    id: 'study-all',
    label: String(task.title || task.name || 'Study session'),
    source: 'fallback',
    sourceId: '',
    order: 1,
    status: 'pending'
  }]
}

function applyStudyProgress(sections, task = {}) {
  const completedIds = new Set(
    (task.studyProgress?.completedSectionIds || [])
      .map(value => String(value))
  )

  return sections.map(section => {
    const status = completedIds.has(String(section.id))
      || normalizeSectionStatus(section.status) === 'done'
      ? 'done'
      : 'pending'
    return { ...section, status }
  })
}

function resolveStudySections(task = {}) {
  const baseSections = Array.isArray(task.studySections) && task.studySections.length
    ? task.studySections.map(section => ({ ...section }))
    : buildStudySectionsFromTask(task)

  return applyStudyProgress(baseSections, task)
}

function getStudyProgressStats(task = {}) {
  const sections = resolveStudySections(task)
  const total = sections.length
  const completed = sections.filter(section => section.status === 'done').length
  const remaining = Math.max(total - completed, 0)
  const remainingFraction = total ? remaining / total : 0
  const nextSection = sections.find(section => section.status !== 'done') || null

  return {
    sections,
    total,
    completed,
    remaining,
    remainingFraction,
    completedFraction: total ? completed / total : 0,
    nextSection,
    isComplete: remaining === 0 && total > 0
  }
}

function markStudySectionComplete(task, sectionId) {
  const sections = resolveStudySections(task)
  const target = sections.find(section => String(section.id) === String(sectionId))
  if (!target) {
    return { ok: false, error: 'Section not found', sections }
  }

  target.status = 'done'
  const completedSectionIds = sections
    .filter(section => section.status === 'done')
    .map(section => section.id)

  return {
    ok: true,
    sections,
    studyProgress: {
      completedSectionIds,
      updatedAt: new Date().toISOString()
    },
    isComplete: completedSectionIds.length === sections.length
  }
}

const StudySections = {
  normalizeSectionStatus,
  buildStudySectionsFromTask,
  applyStudyProgress,
  resolveStudySections,
  getStudyProgressStats,
  markStudySectionComplete
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StudySections
}

if (typeof window !== 'undefined') {
  window.StudySections = StudySections
}
