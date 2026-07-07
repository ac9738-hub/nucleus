'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const {
  collectVisibleCourseLinks,
  isNativePreloadableHref,
  installNativeCoursePointerTracker
} = require('../../lib/canvas-preload-native-tracker')

test('isNativePreloadableHref rejects downloads but keeps assignment urls', () => {
  assert.equal(
    isNativePreloadableHref('https://canvas.example/courses/1/assignments/2'),
    true
  )
  assert.equal(
    isNativePreloadableHref('https://canvas.example/courses/1/files/3/download'),
    false
  )
  assert.equal(
    isNativePreloadableHref('https://canvas.example/courses/1/assignments'),
    false
  )
})

test('collectVisibleCourseLinks skips course tab chrome links', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <nav class="course-tabs">
      <a href="https://canvas.example/courses/1/assignments">Assignments</a>
    </nav>
    <section class="course-page">
      <a href="https://canvas.example/courses/1/assignments/2">HW 1</a>
    </section>
  </body></html>`, { url: 'http://nucleus.local/' })

  const { window } = dom
  const previousDocument = global.document
  const previousWindow = global.window
  global.document = window.document
  global.window = window
  globalThis.nucleusCanvasPreloadPointer = require('../../lib/canvas-preload-pointer')

  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })

  window.Element.prototype.getBoundingClientRect = function mockRect() {
    return {
      left: 10,
      top: 10,
      right: 200,
      bottom: 40,
      width: 190,
      height: 30
    }
  }

  try {
    const links = collectVisibleCourseLinks(window.document.body)
    assert.equal(links.length, 1)
    assert.equal(links[0].url, 'https://canvas.example/courses/1/assignments/2')
  } finally {
    global.document = previousDocument
    global.window = previousWindow
  }
})

test('collectVisibleCourseLinks returns viewport course-page anchors', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <section class="course-page">
      <a href="https://canvas.example/courses/1/assignments/2">HW 1</a>
      <a href="https://canvas.example/courses/1/files/3/download">Bad</a>
    </section>
  </body></html>`, { url: 'http://nucleus.local/' })

  const { window } = dom
  const previousDocument = global.document
  const previousWindow = global.window
  global.document = window.document
  global.window = window
  globalThis.nucleusCanvasPreloadPointer = require('../../lib/canvas-preload-pointer')

  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })

  window.Element.prototype.getBoundingClientRect = function mockRect() {
    return {
      left: 10,
      top: 10,
      right: 200,
      bottom: 40,
      width: 190,
      height: 30
    }
  }

  try {
    const links = collectVisibleCourseLinks(window.document.body)
    assert.equal(links.length, 1)
    assert.equal(links[0].url, 'https://canvas.example/courses/1/assignments/2')
  } finally {
    global.document = previousDocument
    global.window = previousWindow
  }
})

test('installNativeCoursePointerTracker sends ranked pointer hints on direction change', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <section class="course-page">
      <a href="https://canvas.example/courses/1/assignments/2">Near</a>
      <a href="https://canvas.example/courses/1/assignments/3">Far</a>
    </section>
  </body></html>`, { url: 'http://nucleus.local/' })

  const { window } = dom
  const previousDocument = global.document
  const previousWindow = global.window
  global.document = window.document
  global.window = window
  globalThis.nucleusCanvasPreloadPointer = require('../../lib/canvas-preload-pointer')
  globalThis.nucleusCanvasPreloadPointerInput = require('../../lib/canvas-preload-pointer-input')
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })

  window.Element.prototype.getBoundingClientRect = function mockRect() {
    const href = this.getAttribute('href') || ''
    if (href.includes('/assignments/2')) {
      return { left: 95, top: 100, right: 180, bottom: 120, width: 85, height: 20 }
    }
    return { left: 500, top: 100, right: 700, bottom: 120, width: 200, height: 20 }
  }

  const hints = []
  const teardown = installNativeCoursePointerTracker({
    root: window.document.body,
    getTabId() {
      return 'tab-native-1'
    },
    onPointerHints(links, meta = {}) {
      hints.push({ links, meta })
    },
    onLinkMousedown() {}
  })

  function move(x, y) {
    window.document.dispatchEvent(new window.MouseEvent('pointermove', {
      clientX: x,
      clientY: y,
      bubbles: true
    }))
  }

  try {
    assert.equal(hints.length, 1)
    move(620, 400)
    move(640, 400)
    assert.equal(hints.length, 1)
    move(640, 370)
    assert.equal(hints.length, 2)
    const latest = hints[hints.length - 1]
    assert.equal(latest.meta.emitReason, 'direction')
    assert.ok(latest.links.length > 0)
    assert.ok(latest.links[0].combined > 0)
    assert.equal(latest.meta.tabId, 'tab-native-1')
  } finally {
    teardown()
    global.document = previousDocument
    global.window = previousWindow
  }
})

test('installNativeCoursePointerTracker seeds pointer hints on mount', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <section class="course-page">
      <a href="https://canvas.example/courses/1/assignments/2">Near</a>
    </section>
  </body></html>`, { url: 'http://nucleus.local/' })

  const { window } = dom
  const previousDocument = global.document
  const previousWindow = global.window
  global.document = window.document
  global.window = window
  globalThis.nucleusCanvasPreloadPointer = require('../../lib/canvas-preload-pointer')
  globalThis.nucleusCanvasPreloadPointerInput = require('../../lib/canvas-preload-pointer-input')
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })

  window.Element.prototype.getBoundingClientRect = function mockRect() {
    return { left: 95, top: 100, right: 180, bottom: 120, width: 85, height: 20 }
  }

  const hints = []
  const teardown = installNativeCoursePointerTracker({
    root: window.document.body,
    getTabId() {
      return 'tab-native-1'
    },
    onPointerHints(links, meta = {}) {
      hints.push({ links, meta })
    },
    onLinkMousedown() {}
  })

  try {
    assert.equal(hints.length, 1)
    assert.equal(hints[0].links[0].url, 'https://canvas.example/courses/1/assignments/2')
    assert.equal(hints[0].meta.tabId, 'tab-native-1')
  } finally {
    teardown()
    global.document = previousDocument
    global.window = previousWindow
  }
})
