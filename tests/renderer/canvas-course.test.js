const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createCourseHtmlTemplate,
  sanitizeCanvasHomepageHtml
} = require('../../app/canvas/course')
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

test('sanitizeCanvasHomepageHtml keeps safe course markup', () => {
  const html = sanitizeCanvasHomepageHtml(
    '<p>Welcome to <strong>ART 102</strong></p><a href="https://canvas.example.edu/courses/101">Canvas</a>'
  )
  assert.match(html, /<p>Welcome to <strong>ART 102<\/strong><\/p>/)
  assert.match(html, /<a href="https:\/\/canvas\.example\.edu\/courses\/101">Canvas<\/a>/)
})

test('createCourseHtmlTemplate sanitizes executable homepage content', () => {
  const data = sampleCanvasData()
  data.front_pages[101].body = [
    '<p onclick="window.nucleus.clearCanvasSyncData()">Click me</p>',
    '<img src="x" onerror="window.nucleus.deleteMail({ id: \'m1\' })">',
    '<a href="javascript:window.nucleus.logoutCanvas()">bad link</a>',
    '<script>window.nucleus.clearCanvasSyncData()</script>'
  ].join('')

  const course = data.courses[0]
  const html = createCourseHtmlTemplate(course, data, 'homepage')
  assert.match(html, /<p>Click me<\/p>/)
  assert.match(html, /<a href="#">bad link<\/a>/)
  assert.doesNotMatch(html, /onclick|onerror|javascript:|<script|clearCanvasSyncData|deleteMail|logoutCanvas/)
})
