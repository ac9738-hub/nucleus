'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isIgnorableCanvasFetchError,
  filterCoursesForSync,
  coursesWithWikiHomepage,
  extractSyllabiFromCourses
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
