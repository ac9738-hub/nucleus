'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const vm = require('vm')
const fs = require('fs')
const { JSDOM } = require('jsdom')

const ROOT = path.resolve(__dirname, '../..')

function loadViewTransition(html) {
  const dom = new JSDOM(html || '<!DOCTYPE html><html><body><main id="view"><p>old</p></main></body></html>', {
    url: 'http://nucleus.local/',
    runScripts: 'dangerously'
  })
  const context = {
    document: dom.window.document,
    window: dom.window,
    localStorage: {
      _data: {},
      getItem(key) { return this._data[key] ?? null },
      setItem(key, value) { this._data[key] = String(value) }
    },
    requestAnimationFrame: cb => cb(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: clearTimeout,
    getComputedStyle: el => dom.window.getComputedStyle(el)
  }
  context.window.nucleusViewTransition = null
  const code = fs.readFileSync(path.join(ROOT, 'lib', 'view-transition.js'), 'utf8')
  vm.runInContext(code, vm.createContext(context))
  return { vt: context.nucleusViewTransition, document: dom.window.document }
}

test('smooth tabs enabled by default; localStorage 0 disables', () => {
  const { vt, document: doc } = loadViewTransition()
  assert.equal(vt.isSmoothTabsEnabled(), true)
  vt.setSmoothTabsEnabled(false)
  assert.equal(vt.isSmoothTabsEnabled(), false)
  assert.equal(doc.documentElement.dataset.smoothTabs, '0')
})

test('newCanvasTab does not await auth before returning', async () => {
  const { createHarness } = require('./harness')
  const harness = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: 'center:nucleus',
      activeTabByWorkspace: { nucleus: 'center:nucleus' },
      tabs: [{ id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' }]
    }
  })
  harness.loadRendererCore()
  const ctx = harness.context
  let authResolved = false
  ctx.ensureCanvasAuthBeforeOpening = () => new Promise(resolve => {
    setTimeout(() => {
      authResolved = true
      resolve(true)
    }, 50)
  })
  ctx.newWebContentTab = async () => ({ ok: true, tabId: 'canvas:1' })

  const started = Date.now()
  const result = await ctx.newCanvasTab('https://canvas.example/courses/1', 'nucleus', true)
  const elapsed = Date.now() - started

  assert.equal(result.ok, true)
  assert.ok(elapsed < 40, `newCanvasTab blocked ${elapsed}ms waiting for auth`)
  assert.equal(authResolved, false)
})

test('switchWorkspaceTab activates tab and clears view for engine shell', async () => {
  const { createHarness } = require('./harness')
  const harness = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: 'center:nucleus',
      activeTabByWorkspace: { nucleus: 'center:nucleus' },
      tabs: [
        { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
        { id: 'browser:1', type: 'browsertab', workspaceId: 'nucleus', label: 'Engine', url: 'nucleus://search' }
      ]
    }
  })
  harness.loadRendererCore()
  const ctx = harness.context
  ctx.syncActiveTab = async () => ({ ok: true })
  ctx.syncRenderContext = () => {}

  ctx.switchWorkspaceTab('browser:1')
  await new Promise(resolve => setTimeout(resolve, 20))

  assert.equal(ctx.state.activeTabId, 'browser:1')
  const view = harness.document.getElementById('view')
  assert.ok(view)
  assert.equal(view.innerHTML, '')
  assert.ok(view.classList.contains('view-is-ready'))
})

test('rapid tab switches end on the last selected tab', async () => {
  const { createHarness } = require('./harness')
  const harness = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: 'center:nucleus',
      activeTabByWorkspace: { nucleus: 'center:nucleus' },
      tabs: [
        { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
        { id: 'mail:nucleus', type: 'mailtab', workspaceId: 'nucleus', label: 'Mail' },
        { id: 'browser:1', type: 'browsertab', workspaceId: 'nucleus', label: 'Engine', url: 'nucleus://search' }
      ]
    }
  })
  harness.loadRendererCore()
  const ctx = harness.context
  ctx.syncActiveTab = async () => ({ ok: true })
  ctx.syncRenderContext = () => {}

  ctx.switchWorkspaceTab('mail:nucleus')
  ctx.switchWorkspaceTab('browser:1')
  ctx.switchWorkspaceTab('center:nucleus')
  await new Promise(resolve => setTimeout(resolve, 30))

  assert.equal(ctx.state.activeTabId, 'center:nucleus')
  const view = harness.document.getElementById('view')
  assert.match(view.innerHTML, /Control Center/)
})

test('superseded crossfade does not leave #view blank', async () => {
  const { vt, document: doc } = loadViewTransition()
  const view = doc.getElementById('view')
  vt.beginTransition()
  vt.paintView(view, '<p>first</p>', { generation: 1 })
  vt.beginTransition()
  vt.paintView(view, '<p>final</p>', { generation: 2 })
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.match(view.textContent, /final/)
  assert.equal(view.querySelector('.view-transition-layer'), null)
})
