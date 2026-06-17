const test = require('node:test')
const assert = require('node:assert/strict')
const StudySections = require('../study-sections')
const TaskOptimizer = require('../taskoptimizer')

test('buildStudySectionsFromTask splits long estimates into sessions', () => {
  const sections = StudySections.buildStudySectionsFromTask({
    title: 'Study for exam',
    estimate: '4h'
  })
  assert.equal(sections.length, 4)
  assert.equal(sections[0].source, 'estimate')
})

test('buildStudySectionsFromTask prefers learning blocks then concepts then files', () => {
  const fromBlocks = StudySections.buildStudySectionsFromTask({
    learningBlocks: [{ blockId: 'b1', order: 1, explanation: 'Limits' }],
    coveredConcepts: [{ conceptid: 'c1', name: 'Limits' }]
  })
  assert.equal(fromBlocks.length, 1)
  assert.equal(fromBlocks[0].source, 'learningBlock')

  const fromConcepts = StudySections.buildStudySectionsFromTask({
    coveredConcepts: [
      { conceptid: 'c1', name: 'Series' },
      { conceptid: 'c2', name: 'Sequences' }
    ]
  })
  assert.equal(fromConcepts.length, 2)
  assert.equal(fromConcepts[0].source, 'concept')
})

test('resolveStudySections merges studyProgress completed ids', () => {
  const sections = StudySections.resolveStudySections({
    studySections: [
      { id: 'a', label: 'A', status: 'pending' },
      { id: 'b', label: 'B', status: 'pending' }
    ],
    studyProgress: { completedSectionIds: ['a'] }
  })
  assert.deepEqual(
    sections.map(section => section.status),
    ['done', 'pending']
  )
})

test('markStudySectionComplete updates progress state', () => {
  const task = {
    studySections: [
      { id: 'a', label: 'A', status: 'pending' },
      { id: 'b', label: 'B', status: 'pending' }
    ]
  }
  const first = StudySections.markStudySectionComplete(task, 'a')
  assert.equal(first.ok, true)
  assert.deepEqual(first.studyProgress.completedSectionIds, ['a'])

  task.studySections = first.sections
  task.studyProgress = first.studyProgress
  const second = StudySections.markStudySectionComplete(task, 'b')
  assert.equal(second.isComplete, true)
})

test('TaskOptimizer lowers score as study sections are completed', () => {
  const referenceDate = new Date('2026-06-17T12:00:00.000-04:00')
  const cfg = { ...TaskOptimizer.Config, REFERENCE_DATE: referenceDate }
  const baseTask = {
    id: 'study-task',
    title: 'Study for exam',
    due: '2026-06-19T23:59:00.000-04:00',
    estimate: '4h',
    gradepercentage: 20,
    type: 'canvas-study-task',
    task_type: 'study',
    studySections: [
      { id: 'a', label: 'A', status: 'pending' },
      { id: 'b', label: 'B', status: 'pending' },
      { id: 'c', label: 'C', status: 'pending' },
      { id: 'd', label: 'D', status: 'pending' }
    ]
  }

  const fresh = TaskOptimizer.calcPriority(baseTask, cfg)
  const partial = TaskOptimizer.calcPriority({
    ...baseTask,
    studySections: [
      { id: 'a', label: 'A', status: 'done' },
      { id: 'b', label: 'B', status: 'done' },
      { id: 'c', label: 'C', status: 'done' },
      { id: 'd', label: 'D', status: 'pending' }
    ],
    studyProgress: { completedSectionIds: ['a', 'b', 'c'] }
  }, cfg)
  const complete = TaskOptimizer.calcPriority({
    ...baseTask,
    studySections: [
      { id: 'a', label: 'A', status: 'done' },
      { id: 'b', label: 'B', status: 'done' },
      { id: 'c', label: 'C', status: 'done' },
      { id: 'd', label: 'D', status: 'done' }
    ],
    studyProgress: { completedSectionIds: ['a', 'b', 'c', 'd'] }
  }, cfg)

  assert.ok(fresh.raw_score > partial.raw_score)
  assert.equal(complete.raw_score, 0)
})
