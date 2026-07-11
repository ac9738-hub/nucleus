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

test('fetchCanvasPages preserves page metadata after body fetch cap', async () => {
  const originalLimit = process.env.CANVAS_MAX_PAGE_BODY_FETCHES
  const originalFetch = global.fetch
  process.env.CANVAS_MAX_PAGE_BODY_FETCHES = '1'
  delete require.cache[require.resolve('../app/canvas/api')]

  const { createCanvasApi } = require('../app/canvas/api')
  const requestedUrls = []
  global.fetch = async url => {
    requestedUrls.push(String(url))
    if (String(url).includes('/api/v1/courses/42/pages?')) {
      return new Response(JSON.stringify([
        {
          page_id: 1,
          url: 'intro',
          title: 'Intro',
          html_url: 'https://canvas.example/courses/42/pages/intro'
        },
        {
          page_id: 2,
          url: 'tail-page',
          title: 'Tail Page',
          html_url: 'https://canvas.example/courses/42/pages/tail-page'
        }
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    if (String(url).endsWith('/api/v1/courses/42/pages/intro')) {
      return new Response(JSON.stringify({
        page_id: 1,
        url: 'intro',
        title: 'Intro',
        body: '<p>Fetched body</p>',
        html_url: 'https://canvas.example/courses/42/pages/intro'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    throw new Error(`Unexpected fetch URL: ${url}`)
  }

  try {
    const api = createCanvasApi({
      canvasDataPath: '/tmp/nucleus-canvas-sync-fetch-test.json',
      getAuthState: () => ({
        canvasBaseUrl: 'https://canvas.example',
        canvasAuthCookie: 'cookie',
        canvasAuthCsrf: ''
      }),
      sendCanvasDataUpdate: () => {}
    })
    const errors = []
    const buckets = await api._fetchCanvasPagesForTest([{ id: 42 }], errors)

    assert.equal(buckets[42].length, 2)
    assert.equal(buckets[42][0].body, '<p>Fetched body</p>')
    assert.equal(buckets[42][1].title, 'Tail Page')
    assert.equal(buckets[42][1].url, 'tail-page')
    assert.equal(buckets[42][1].body, '')
    assert.equal(requestedUrls.some(url => url.endsWith('/api/v1/courses/42/pages/tail-page')), false)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /Page-body fetch cap reached/)
  } finally {
    global.fetch = originalFetch
    if (originalLimit === undefined) delete process.env.CANVAS_MAX_PAGE_BODY_FETCHES
    else process.env.CANVAS_MAX_PAGE_BODY_FETCHES = originalLimit
    delete require.cache[require.resolve('../app/canvas/api')]
  }
})
