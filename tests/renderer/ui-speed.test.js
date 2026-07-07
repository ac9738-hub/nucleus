'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { performance } = require('node:perf_hooks')
const { createHarness } = require('./harness')

const ROOT = path.resolve(__dirname, '../..')
const REPORT_PATH = path.join(ROOT, '.cache', 'ui_speed', 'report.json')

function buildTabs(count) {
  const tabs = [{ id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' }]
  for (let i = 0; i < count - 1; i += 1) {
    tabs.push({
      id: `browser:nucleus:${i}`,
      type: 'browsertab',
      workspaceId: 'nucleus',
      label: `Tab ${i}`,
      url: `https://example.com/${i}`
    })
  }
  return tabs
}

function bench(fn, iterations = 1) {
  const start = performance.now()
  for (let i = 0; i < iterations; i += 1) fn()
  return performance.now() - start
}

function stubRenderPipeline(ctx) {
  ctx.renderWorkspaceSidebarCollapseState = () => {}
  ctx.renderPrimaryTabs = () => {}
  ctx.renderWorkspaceTabs = () => {}
  ctx.updateWorkspacePageTabs = () => {}
  ctx.renderBrowserToolbar = () => {}
  ctx.renderCanvasToolbar = () => {}
  ctx.renderView = () => {}
  ctx.paintActiveView = () => {}
  ctx.syncRenderContext = () => {}
}

test('workspace tab bar patch stays faster than full rebuild', () => {
  const tabs = buildTabs(20)
  const harness = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: tabs[1].id,
      tabs
    }
  })
  harness.loadRendererCore()
  const ctx = harness.context

  const fullMs = bench(() => ctx.renderWorkspacePageTabs(), 1)
  ctx.renderWorkspacePageTabs()
  const patchTotalMs = bench(() => {
    ctx.state.activeTabId = tabs[(Math.floor(Math.random() * (tabs.length - 1)) + 1)].id
    ctx.patchWorkspacePageTabs()
  }, 100)
  const patchPerCallMs = patchTotalMs / 100

  const ratio = patchPerCallMs / fullMs
  const report = {
    generatedAt: new Date().toISOString(),
    environment: 'jsdom',
    tabCount: tabs.length,
    fullRebuildMs: Number(fullMs.toFixed(3)),
    patchPerCallMs: Number(patchPerCallMs.toFixed(4)),
    patchToFullRatio: Number(ratio.toFixed(4)),
    budgets: {
      patchRatioMax: 0.2
    },
    pass: ratio < 0.2
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

  assert.ok(ratio < 0.2, `patch/full ratio ${ratio.toFixed(3)} exceeds 0.2`)
})

test('render cycle stays within p95 budget with stubbed view', () => {
  const harness = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: 'center:nucleus',
      tabs: buildTabs(8)
    }
  })
  harness.loadRendererCore()
  const ctx = harness.context
  stubRenderPipeline(ctx)

  const samples = []
  for (let i = 0; i < 50; i += 1) {
    const start = performance.now()
    ctx.render({ reason: 'bench' })
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]
  assert.ok(p95 < 12, `render p95 ${p95.toFixed(2)}ms exceeds 12ms`)
})
