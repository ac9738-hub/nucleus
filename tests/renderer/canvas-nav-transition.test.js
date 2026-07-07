const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { createCanvasNavTransition } = require('../../lib/canvas-nav-transition')

const ROOT_DIR = path.join(__dirname, '..', '..')

function createMockWebContents(url = 'about:blank') {
  const listeners = new Map()
  return {
    currentUrl: url,
    isDestroyed: () => false,
    getURL: () => this.currentUrl,
    on(event, handler) {
      const list = listeners.get(event) || []
      list.push(handler)
      listeners.set(event, list)
    },
    removeListener(event, handler) {
      const list = listeners.get(event) || []
      listeners.set(event, list.filter(item => item !== handler))
    },
    once(event, handler) {
      const wrapped = (...args) => {
        this.removeListener(event, wrapped)
        handler(...args)
      }
      this.on(event, wrapped)
    },
    emit(event, ...args) {
      for (const handler of listeners.get(event) || []) {
        handler(...args)
      }
    },
    executeJavaScript: async () => true
  }
}

function createHarness(initialUrl = 'https://canvas.example/courses/1') {
  const wc = createMockWebContents(initialUrl)
  wc.getURL = () => wc.currentUrl

  const view = {
    webContents: wc,
    visible: false,
    setVisible(value) {
      this.visible = Boolean(value)
    },
    getVisible() {
      return this.visible
    }
  }

  const tab = { id: 'tab-1', loading: false, type: 'canvastab', canvasMode: 'browser' }
  const window = { isDestroyed: () => false, contentView: { addChildView() {}, removeChildView() {} } }
  let activeTab = tab

  const nav = createCanvasNavTransition({
    rootDir: ROOT_DIR,
    injectAuthorThemeCss: async () => {},
    normalizeCanvasNavigationUrl: url => String(url || '').trim(),
    urlsLikelyMatchCanvas: (left, right) => String(left) === String(right),
    canvasBlankWarmUrl: 'data:text/html,warm',
    logSlateCover: () => {},
    setTabLoadingState: (target, loading) => {
      target.loading = Boolean(loading)
    },
    attachWebContentView: () => {},
    sendCanvasViewReady: () => {},
    getActiveTab: () => activeTab,
    getRendererOverlayDepth: () => 0,
    isCanvasBrowserTab: () => true,
    getBrowserBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    getSlate: () => {
      const slateWc = {
        isDestroyed: () => false,
        setBackgroundColor: () => {},
        loadFile: () => {},
        once: (event, handler) => {
          if (event === 'did-finish-load') {
            queueMicrotask(handler)
          }
        },
        executeJavaScript: async () => true
      }
      return {
        webContents: slateWc,
        _nucleusSlateLoaded: true,
        _nucleusCanvasCoverActive: false,
        _nucleusFadeInFlight: false,
        setVisible: () => {},
        setBounds: () => {}
      }
    },
    setSlateBounds: () => {},
    sameTabId: (left, right) => left === right,
    clearCanvasWebNavigationClaim: () => {}
  })

  return { nav, view, tab, window, wc }
}

test('waitForReveal completes when destination URL is already loaded', async () => {
  const dest = 'https://canvas.example/courses/1/pages/week-2'
  const { nav, view, tab, window, wc } = createHarness(dest)

  const coverResult = await nav.cover(window, tab, view, {
    sourceUrl: 'https://canvas.example/courses/1',
    destUrl: dest,
    reason: 'test_cover'
  })
  assert.ok(coverResult)

  wc.currentUrl = dest

  const revealed = await nav.waitForReveal(window, tab, view, dest, { maxWaitMs: 500 })
  assert.equal(revealed, true)
  assert.equal(tab.loading, false)
  assert.equal(view.visible, true)
})

test('armPaintWait syncs destUrl after in-page navigation', async () => {
  const initial = 'https://canvas.example/courses/1'
  const finalUrl = 'https://canvas.example/courses/1/discussion_topics/9'
  const { nav, view, tab, window, wc } = createHarness(initial)

  await nav.cover(window, tab, view, {
    sourceUrl: initial,
    destUrl: initial,
    reason: 'test_in_page'
  })

  const revealPromise = nav.waitForReveal(window, tab, view, initial, { maxWaitMs: 800 })
  wc.currentUrl = finalUrl
  wc.emit('did-navigate-in-page')
  nav.handleFirstPaint(view, { generation: 2, reason: 'test' })

  const revealed = await revealPromise
  assert.equal(revealed, true)
  assert.equal(tab.loading, false)
  assert.equal(view.visible, true)
})
