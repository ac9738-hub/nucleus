const test = require('node:test')
const assert = require('node:assert/strict')
const { createCourseHtmlTemplate } = require('../../app/canvas/course')
const { escapeHtml } = require('../../lib/dom-utils')
const { sampleCanvasData } = require('./fixtures')

global.escapeHtml = escapeHtml

test('createCourseHtmlTemplate renders course header and section nav', () => {
  const course = sampleCanvasData().courses[0]
  const html = createCourseHtmlTemplate(course, sampleCanvasData(), 'assignments')
  assert.match(html, /Intro to Architecture/)
  assert.match(html, /data-course-section="assignments"/)
  assert.match(html, /data-course-section="modules"/)
})

test('createCourseHtmlTemplate lists assignments for the active course', () => {
  const course = sampleCanvasData().courses[0]
  const html = createCourseHtmlTemplate(course, sampleCanvasData(), 'assignments')
  assert.match(html, /Assignment 1/)
})

test('createCourseHtmlTemplate renders homepage section when selected', () => {
  const course = sampleCanvasData().courses[0]
  const html = createCourseHtmlTemplate(course, sampleCanvasData(), 'homepage')
  assert.match(html, /course-homepage-section/)
})
