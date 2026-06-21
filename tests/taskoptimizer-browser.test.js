const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('TaskOptimizer loads in browser context without CommonJS require', () => {
  const context = vm.createContext({
    console,
    window: {}
  })
  const studySectionsSource = fs.readFileSync(path.join(__dirname, '..', 'study-sections.js'), 'utf8')
  const optimizerSource = fs.readFileSync(path.join(__dirname, '..', 'taskoptimizer.js'), 'utf8')

  vm.runInContext(studySectionsSource, context, { filename: 'study-sections.js' })
  vm.runInContext(optimizerSource, context, { filename: 'taskoptimizer.js' })

  assert.equal(typeof context.window.TaskOptimizer?.orderTasks, 'function')
  const score = context.window.TaskOptimizer.calcPriority({
    id: 'study-task',
    title: 'Study for final',
    type: 'canvas-study-task',
    due: '2026-06-22T12:00:00.000Z',
    studySections: [{ id: 'section-1', label: 'Section 1', status: 'pending' }]
  })
  assert.equal(score.task_id, 'study-task')
})
