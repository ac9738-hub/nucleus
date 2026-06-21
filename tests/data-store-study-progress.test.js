const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createDataStore } = require('../data-store')
const StudySections = require('../study-sections')

function createTestStore(progressByTask = {}) {
  const updates = []
  const writes = {}
  const store = createDataStore({
    sendToRenderer: (channel, payload) => updates.push({ channel, payload }),
    getCanvasProjectGroups: () => [],
    readCanvasData: () => null,
    readStudyTaskProgress: taskId => progressByTask[taskId] || null,
    writeStudyTaskProgress: (taskId, progress) => {
      writes[taskId] = progress
    }
  })
  return { store, updates, writes }
}

function addCanvasStudyTask(store, overrides = {}) {
  const sections = overrides.studySections || [
    { id: 'a', label: 'A', status: 'pending' },
    { id: 'b', label: 'B', status: 'pending' }
  ]
  store.newTask(
    overrides.title || 'Study for midterm',
    1,
    overrides.id || 'canvas-study-course-midterm',
    '',
    'Course',
    '',
    '2026-06-22T23:59:00.000-04:00',
    '',
    '#d85a30',
    [],
    {
      source: 'canvas',
      type: 'canvas-study-task',
      studySections: sections,
      studyProgress: overrides.studyProgress || { completedSectionIds: [], updatedAt: null }
    }
  )
}

test('Canvas study progress survives regenerated task refreshes', () => {
  const { store, writes } = createTestStore()
  addCanvasStudyTask(store)

  const result = store.updateStudySectionProgress('canvas-study-course-midterm', 'a')
  assert.equal(result.ok, true)
  assert.deepEqual(writes['canvas-study-course-midterm'].completedSectionIds, ['a'])

  addCanvasStudyTask(store, {
    studySections: [
      { id: 'a', label: 'A refreshed', status: 'pending' },
      { id: 'b', label: 'B refreshed', status: 'pending' }
    ],
    studyProgress: { completedSectionIds: [], updatedAt: null }
  })

  const task = store.getTasksSnapshot().find(entry => entry.id === 'canvas-study-course-midterm')
  assert.deepEqual(task.studyProgress.completedSectionIds, ['a'])
  assert.deepEqual(
    task.studySections.map(section => section.status),
    ['done', 'pending']
  )
})

test('persisted Canvas study progress is applied after restart regeneration', () => {
  const { store } = createTestStore({
    'canvas-study-course-midterm': {
      completedSectionIds: ['b'],
      updatedAt: '2026-06-21T10:00:00.000Z'
    }
  })

  addCanvasStudyTask(store)

  const task = store.getTasksSnapshot().find(entry => entry.id === 'canvas-study-course-midterm')
  assert.deepEqual(task.studyProgress.completedSectionIds, ['b'])
  assert.deepEqual(
    task.studySections.map(section => section.status),
    ['pending', 'done']
  )
})

test('TaskOptimizer browser script initializes without CommonJS require', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'taskoptimizer.js'), 'utf8')
  const context = {
    window: { StudySections },
    Date,
    Math,
    Number,
    String,
    Array,
    Set,
    Object,
    console
  }
  vm.createContext(context)

  vm.runInContext(source, context)

  assert.equal(typeof context.window.TaskOptimizer.orderTasks, 'function')
})
