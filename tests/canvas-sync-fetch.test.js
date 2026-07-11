'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  isIgnorableCanvasFetchError,
  filterCoursesForSync,
  coursesWithWikiHomepage,
  extractSyllabiFromCourses,
  refreshWeeklyScheduleFromCompletedGraph
} = require('../app/canvas/api')

test('isIgnorableCanvasFetchError treats 403/404 as expected access denials', () => {
  assert.equal(isIgnorableCanvasFetchError(new Error('Canvas API request failed 403 Forbidden: /front_page')), true)
  assert.equal(isIgnorableCanvasFetchError(new Error('Canvas API request failed 404 Not Found: /syllabus')), true)
  assert.equal(isIgnorableCanvasFetchError(new Error('User not authorized to perform that action')), true)
  assert.equal(isIgnorableCanvasFetchError(new Error('Canvas API request failed 429 Too Many Requests')), false)
  assert.equal(isIgnorableCanvasFetchError(new Error('Canvas API request failed 500 Internal Server Error')), false)
})

test('filterCoursesForSync skips deleted and date-restricted courses', () => {
  const courses = [
    { id: 1, workflow_state: 'available' },
    { id: 2, workflow_state: 'deleted' },
    { id: 3, workflow_state: 'available', access_restricted_by_date: true },
    { id: 4, workflow_state: 'completed' }
  ]
  const filtered = filterCoursesForSync(courses)
  assert.deepEqual(filtered.map(course => course.id), [1, 4])
})

test('coursesWithWikiHomepage only keeps wiki-layout accessible courses', () => {
  const courses = [
    { id: 1, default_view: 'wiki', workflow_state: 'available' },
    { id: 2, default_view: 'modules', workflow_state: 'available' },
    { id: 3, default_view: 'wiki', access_restricted_by_date: true }
  ]
  assert.deepEqual(coursesWithWikiHomepage(courses).map(course => course.id), [1])
})

test('extractSyllabiFromCourses uses syllabus_body from course list', () => {
  const courses = [
    {
      id: 10,
      name: 'Bio',
      html_url: 'https://canvas.example/courses/10',
      syllabus_body: '<p>Welcome to the course.</p>',
      workflow_state: 'available'
    },
    {
      id: 11,
      name: 'Empty',
      syllabus_body: '',
      workflow_state: 'available'
    }
  ]
  const buckets = extractSyllabiFromCourses(courses)
  assert.equal(Object.keys(buckets).length, 1)
  assert.equal(buckets[10].name, 'Bio')
  assert.match(buckets[10].syllabus_text, /Welcome/)
})

test('refreshWeeklyScheduleFromCompletedGraph persists graph-enriched weekly schedule', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-weekly-refresh-'))
  const canvasDataPath = path.join(root, 'canvas_data.json')
  const initial = {
    courses: [{ id: 42, name: 'Chemistry' }],
    weekly_schedule: {
      42: [{ weekLabel: 'Week 1', events: [] }]
    }
  }
  fs.writeFileSync(path.join(root, 'canvas_graph.json'), '{"events":[]}', 'utf8')
  fs.writeFileSync(canvasDataPath, JSON.stringify(initial), 'utf8')

  let live = JSON.parse(JSON.stringify(initial))
  let notified = false
  const result = await refreshWeeklyScheduleFromCompletedGraph({
    canvasDataPath,
    rootDir: root,
    readCanvasData: () => live,
    writeCanvasData: next => {
      live = next
      fs.writeFileSync(canvasDataPath, JSON.stringify(next), 'utf8')
    },
    buildSchedule: async () => ({
      42: [{ weekLabel: 'Week 1', events: [{ event: { name: 'Exam 1' } }] }]
    }),
    onReady: () => { notified = true }
  })

  assert.equal(result.ok, true)
  assert.equal(notified, true)
  assert.equal(live.weekly_schedule[42][0].events[0].event.name, 'Exam 1')
  const persisted = JSON.parse(fs.readFileSync(canvasDataPath, 'utf8'))
  assert.equal(persisted.weekly_schedule[42][0].events[0].event.name, 'Exam 1')
  fs.rmSync(root, { recursive: true, force: true })
})

test('refreshWeeklyScheduleFromCompletedGraph skips superseded parser completions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-weekly-skip-'))
  const canvasDataPath = path.join(root, 'canvas_data.json')
  fs.writeFileSync(path.join(root, 'canvas_graph.json'), '{"events":[]}', 'utf8')

  let buildCalled = false
  const result = await refreshWeeklyScheduleFromCompletedGraph({
    canvasDataPath,
    rootDir: root,
    readCanvasData: () => ({ courses: [{ id: 1 }] }),
    writeCanvasData: () => {
      throw new Error('write should not run')
    },
    shouldSkip: () => true,
    buildSchedule: async () => {
      buildCalled = true
      return {}
    }
  })

  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'superseded')
  assert.equal(buildCalled, false)
  fs.rmSync(root, { recursive: true, force: true })
})
