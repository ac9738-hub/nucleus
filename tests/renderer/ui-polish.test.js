'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { JSDOM } = require('jsdom')
const { createHarness } = require('./harness')

const ROOT = path.resolve(__dirname, '../..')
const THEME_CSS = path.join(ROOT, 'themes', 'default', 'styles.css')

function readThemeCss() {
  return fs.readFileSync(THEME_CSS, 'utf8')
}

test('default theme defines motion and elevation tokens', () => {
  const css = readThemeCss()
  assert.match(css, /--motion-fast:\s*120ms/)
  assert.match(css, /--radius-lg:\s*12px/)
  assert.match(css, /--shadow-sm:/)
  assert.match(css, /--weight-semibold:\s*600/)
})

test('task-card hover uses shadow not lift', () => {
  const css = readThemeCss()
  const block = css.match(/\.task-card:hover\s*\{[^}]+\}/)
  assert.ok(block, 'task-card:hover rule missing')
  assert.doesNotMatch(block[0], /translateY/)
  assert.match(block[0], /box-shadow/)
})

test('workspace sidebar tabs do not slide on hover', () => {
  const css = readThemeCss()
  const hover = css.match(/\.workspace-tabs button:hover\s*\{[^}]+\}/)
  assert.ok(hover, 'workspace-tabs hover rule missing')
  assert.doesNotMatch(hover[0], /translateX/)
})

test('reduced-motion zeroes motion tokens', () => {
  const css = readThemeCss()
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*--motion-fast:\s*0ms/)
})

test('patchWorkspacePageTabs toggles active without full tab bar rebuild', () => {
  const harness = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: 'center:nucleus',
      tabs: [
        { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
        { id: 'mail:nucleus', type: 'mailtab', workspaceId: 'nucleus', label: 'Mail' }
      ]
    }
  })
  harness.loadRendererCore()
  const ctx = harness.context
  const pageTabs = harness.document.getElementById('workspace-page-tabs')
  ctx.renderWorkspacePageTabs()
  const tabCount = pageTabs.querySelectorAll('.workspace-page-tab').length
  ctx.state.activeTabId = 'mail:nucleus'
  ctx.patchWorkspacePageTabs()
  assert.equal(pageTabs.querySelectorAll('.workspace-page-tab').length, tabCount)
  assert.ok(pageTabs.querySelector('[data-tab-id="mail:nucleus"]').classList.contains('active'))
  assert.ok(!pageTabs.querySelector('[data-tab-id="center:nucleus"]').classList.contains('active'))
})

test('patchOptimisticWorkspaceTabActive updates active class immediately', () => {
  const harness = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: 'center:nucleus',
      tabs: [
        { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
        { id: 'synapse:nucleus', type: 'synapsetab', workspaceId: 'nucleus', label: 'Synapse' }
      ]
    }
  })
  harness.document.body.innerHTML += '<div id="view"></div>'
  harness.loadRendererCore()
  const ctx = harness.context
  const pageTabs = harness.document.getElementById('workspace-page-tabs')
  pageTabs.innerHTML = `
    <button type="button" class="workspace-page-tab active" data-tab-id="center:nucleus">Center</button>
    <button type="button" class="workspace-page-tab" data-tab-id="synapse:nucleus">Synapse</button>
  `
  ctx.patchOptimisticWorkspaceTabActive('synapse:nucleus')
  assert.ok(pageTabs.querySelector('[data-tab-id="synapse:nucleus"]').classList.contains('active'))
  assert.ok(harness.document.getElementById('view').classList.contains('view-is-switching'))
})

test('openCanvasAppTab converts center tab in place instead of adding a tab', async () => {
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
  ctx.ensureCanvasAuthBeforeOpening = async () => true
  ctx.refreshCanvasNativeView = () => {
    ctx.renderView = ctx.renderView || (() => {})
  }
  ctx.queueTabSyncAfterRender = () => {}
  ctx.ensureCanvasAppBootstrapped = () => Promise.resolve({ ok: true })

  const result = await ctx.openCanvasAppTab('nucleus')
  assert.equal(result.ok, true)
  assert.equal(ctx.state.tabs.length, 1)
  assert.equal(ctx.state.tabs[0].id, 'center:nucleus')
  assert.equal(ctx.state.tabs[0].type, 'canvastab')
  assert.equal(ctx.state.tabs[0].canvasMode, 'native')
  assert.equal(ctx.state.activeTabId, 'center:nucleus')
})

test('mail and synapse compose buttons do not lift on hover', () => {
  const files = [
    path.join(ROOT, 'themes', 'default', 'mail.css'),
    path.join(ROOT, 'themes', 'default', 'synapse.css'),
    path.join(ROOT, 'app', 'mail', 'mail.css'),
    path.join(ROOT, 'app', 'synapse', 'synapse.css')
  ]
  for (const file of files) {
    const css = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(css, /translateY\(-1px\)/, `${path.basename(file)} still lifts on hover`)
  }
})

test('nucleus-ui defines shared card and segmented primitives', () => {
  const css = fs.readFileSync(path.join(ROOT, 'lib', 'nucleus-ui.css'), 'utf8')
  assert.match(css, /\.nui-card\s*\{/)
  assert.match(css, /\.nui-badge\s*\{/)
  assert.match(css, /\.nui-segmented\s*\{/)
})

test('default theme manifest loads feature-shell after mail css', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', 'default', 'manifest.json'), 'utf8'))
  const sheets = manifest.rendererStylesheets
  const mailIdx = sheets.indexOf('themes/default/mail.css')
  const shellIdx = sheets.indexOf('lib/feature-shell.css')
  assert.ok(mailIdx >= 0 && shellIdx >= 0)
  assert.ok(shellIdx > mailIdx)
})

test('applyThemeStylesheets swaps data-theme-style links', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'http://nucleus.local/',
    runScripts: 'dangerously'
  })
  const { window } = dom
  const context = dom.getInternalVMContext()
  const script = fs.readFileSync(path.join(ROOT, 'renderer', 'render.js'), 'utf8')
  const fnBlock = script.match(/function applyThemeStylesheets[\s\S]*?^}/m)
  assert.ok(fnBlock, 'applyThemeStylesheets not found')
  context.requestAnimationFrame = cb => cb()
  vm.createContext(context)
  vm.runInContext(`${fnBlock[0]}; globalThis.applyThemeStylesheets = applyThemeStylesheets;`, context)

  const head = window.document.head
  const old = window.document.createElement('link')
  old.rel = 'stylesheet'
  old.href = 'themes/default/styles.css'
  old.dataset.themeStyle = '1'
  head.appendChild(old)

  context.applyThemeStylesheets(['themes/dark/styles.css', 'lib/nucleus-ui.css'])
  const links = Array.from(head.querySelectorAll('link[data-theme-style]'))
  assert.equal(links.length, 2)
  assert.ok(links.some(link => link.href.includes('themes/dark/styles.css')))
})
