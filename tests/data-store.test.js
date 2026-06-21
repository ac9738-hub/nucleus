const test = require('node:test')
const assert = require('node:assert/strict')
const { createDataStore } = require('../data-store')

function makeStore() {
  return createDataStore({
    sendToRenderer: () => {},
    getCanvasProjectGroups: () => [],
    readCanvasData: () => ({})
  })
}

test('canvas task refresh preserves completed study section progress', () => {
  const store = makeStore()
  const sections = [
    { id: 'intro', label: 'Intro', status: 'pending' },
    { id: 'practice', label: 'Practice', status: 'pending' }
  ]

  store.newTask(
    'Study for exam',
    5,
    'canvas-study-1',
    '',
    'Canvas',
    'Study the covered material',
    '2026-06-22T12:00:00.000Z',
    '',
    '#d85a30',
    [],
    {
      source: 'canvas',
      type: 'canvas-study-task',
      studySections: sections,
      studyProgress: { completedSectionIds: [], updatedAt: null }
    }
  )

  const progress = store.updateStudySectionProgress('canvas-study-1', 'intro')
  assert.equal(progress.ok, true)

  store.newTask(
    'Study for exam',
    5,
    'canvas-study-1',
    '',
    'Canvas',
    'Study the refreshed covered material',
    '2026-06-22T12:00:00.000Z',
    '',
    '#d85a30',
    [],
    {
      source: 'canvas',
      type: 'canvas-study-task',
      studySections: sections,
      studyProgress: { completedSectionIds: [], updatedAt: null }
    }
  )

  const task = store.getTasksSnapshot().find(item => item.id === 'canvas-study-1')
  assert.deepEqual(task.studyProgress.completedSectionIds, ['intro'])
  assert.deepEqual(
    task.studySections.map(section => section.status),
    ['done', 'pending']
  )
})
