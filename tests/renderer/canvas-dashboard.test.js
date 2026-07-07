const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')
const { sampleCanvasData } = require('./fixtures')

global.escapeHtml = require('../../lib/dom-utils').escapeHtml
const {
  canvasCourseCardColor,
  canvasCourseCardInitials,
  renderCanvasAppDashboard,
  renderCanvasCourseDashboard
} = require('../../app/canvas/dashboard')

test('canvasCourseCardInitials uses two-letter initials from course code', () => {
  assert.equal(canvasCourseCardInitials({ course_code: 'ART 102' }), 'A1')
  assert.equal(canvasCourseCardInitials({ name: 'Biology' }), 'BI')
})

test('canvasCourseCardColor is stable for a course id', () => {
  const first = canvasCourseCardColor({ id: 101 })
  const second = canvasCourseCardColor({ id: 101 })
  assert.equal(first, second)
  assert.match(first, /^#[0-9A-F]{6}$/i)
})

test('renderCanvasAppDashboard omits deleted courses', () => {
  const html = renderCanvasAppDashboard(sampleCanvasData())
  assert.match(html, /Intro to Architecture/)
  assert.doesNotMatch(html, /Deleted Course/)
  assert.match(html, /1 courses loaded/)
})

test('renderCanvasAppDashboard shows connect prompt when empty', () => {
  const html = renderCanvasAppDashboard({ courses: [] })
  assert.match(html, /Connect Canvas/)
})

test('renderCanvasCourseDashboard renders missing course state', () => {
  const html = renderCanvasCourseDashboard('999', sampleCanvasData())
  assert.match(html, /not found/)
  assert.match(html, /data-back-to-canvas-app/)
})

test('renderCanvasApp routes to course dashboard when tab has courseId', () => {
  const harness = createHarness({ canvasData: sampleCanvasData() })
  harness.loadCanvasStack()
  const html = harness.window.nucleusCanvasApp.renderCanvasApp(
    { courseId: '101', courseSection: 'assignments' },
    sampleCanvasData()
  )
  assert.match(html, /data-back-to-canvas-app/)
  assert.match(html, /Assignment 1/)
})
