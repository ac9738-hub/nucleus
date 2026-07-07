'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const {
  collectVisiblePreloadLinks,
  installCanvasPageTracker
} = require('../../lib/canvas-preload-page-tracker')

test('collectVisiblePreloadLinks skips chrome nav and hidden links', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <nav id="global_nav">
      <a href="https://canvas.example/courses/1/assignments/99">Hidden</a>
    </nav>
    <main>
      <a href="https://canvas.example/courses/1/assignments">Shell</a>
      <a href="https://canvas.example/courses/1/assignments/2">HW 1</a>
      <a href="https://community.canvaslms.com/help">External</a>
    </main>
  </body></html>`, { url: 'https://canvas.example/courses/1/pages/home' })

  const { window } = dom
  const previousDocument = global.document
  const previousWindow = global.window
  global.document = window.document
  global.window = window

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
    const links = collectVisiblePreloadLinks()
    assert.equal(links.length, 1)
    assert.equal(links[0].url, 'https://canvas.example/courses/1/assignments/2')
  } finally {
    global.document = previousDocument
    global.window = previousWindow
  }
})

test('installCanvasPageTracker emits force seed and direction hints', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <main>
      <a href="https://canvas.example/courses/1/assignments/2">HW 1</a>
    </main>
  </body></html>`, { url: 'https://canvas.example/courses/1/pages/home' })

  const { window } = dom
  const previousDocument = global.document
  const previousWindow = global.window
  global.document = window.document
  global.window = window

  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })

  window.Element.prototype.getBoundingClientRect = function mockRect() {
    return {
      left: 600,
      top: 400,
      right: 700,
      bottom: 430,
      width: 100,
      height: 30
    }
  }

  const sent = []
  const ipcRenderer = {
    send(channel, payload) {
      sent.push({ channel, payload })
    }
  }

  try {
    installCanvasPageTracker(ipcRenderer)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].channel, 'canvas:pointer_hints')
    assert.equal(sent[0].payload.emitReason, 'force')
    assert.equal(sent[0].payload.source, 'canvas_webview')

    sent.length = 0
    function move(x, y) {
      window.document.dispatchEvent(new window.MouseEvent('pointermove', {
        clientX: x,
        clientY: y,
        bubbles: true
      }))
    }

    move(620, 400)
    move(640, 400)
    assert.equal(sent.length, 0)
    move(640, 370)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].payload.emitReason, 'direction')
  } finally {
    global.document = previousDocument
    global.window = previousWindow
  }
})
