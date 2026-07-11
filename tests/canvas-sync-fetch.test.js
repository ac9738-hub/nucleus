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
  writeJsonFileAtomic
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

test('writeJsonFileAtomic preserves prior snapshot if temp write fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-canvas-data-'))
  const target = path.join(root, 'canvas_data.json')
  const previous = '{"courses":[{"id":1}]}'
  fs.writeFileSync(target, previous, 'utf8')

  const originalWrite = fs.writeFileSync
  fs.writeFileSync = function patchedWrite(file, ...args) {
    if (String(file).includes('.canvas_data.json.')) {
      throw new Error('simulated disk write failure')
    }
    return originalWrite.call(fs, file, ...args)
  }
  try {
    assert.throws(
      () => writeJsonFileAtomic(target, { courses: [{ id: 2 }] }),
      /simulated disk write failure/
    )
  } finally {
    fs.writeFileSync = originalWrite
  }

  assert.equal(fs.readFileSync(target, 'utf8'), previous)
})

test('writeJsonFileAtomic replaces snapshot with valid JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-canvas-data-'))
  const target = path.join(root, 'canvas_data.json')

  writeJsonFileAtomic(target, { courses: [{ id: 3 }] })

  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { courses: [{ id: 3 }] })
})
