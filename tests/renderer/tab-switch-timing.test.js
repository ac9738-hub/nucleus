'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { performance } = require('node:perf_hooks')
const { createHarness } = require('./harness')

const ROOT = path.resolve(__dirname, '../..')
const REPORT_PATH = path.join(ROOT, '.cache', 'ui_speed', 'tab_switch_timing.json')

function buildTabState() {
  return {
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
}

function stubFastPipeline(ctx) {
  ctx.renderWorkspaceSidebarCollapseState = () => {}
  ctx.renderPrimaryTabs = () => {}
  ctx.renderWorkspaceTabs = () => {}
  ctx.updateWorkspacePageTabs = () => {}
  ctx.renderBrowserToolbar = () => {}
  ctx.renderCanvasToolbar = () => {}
  ctx.syncRenderContext = () => {}
  ctx.demoteSiblingWebTabViewTiers = () => {}
}

test('tab switch paints before slow syncActiveTab returns', async () => {
  const harness = createHarness({ state: buildTabState() })
  harness.loadRendererCore()
  const ctx = harness.context
  stubFastPipeline(ctx)

  let paintedAt = 0
  let syncFinishedAt = 0
  const origPaint = ctx.paintActiveView.bind(ctx)
  ctx.paintActiveView = (options) => {
    paintedAt = performance.now()
    return origPaint(options)
  }
  ctx.syncActiveTab = () => new Promise(resolve => {
    setTimeout(() => {
      syncFinishedAt = performance.now()
      resolve({ ok: true })
    }, 80)
  })

  const started = performance.now()
  ctx.switchWorkspaceTab('mail:nucleus')

  assert.ok(paintedAt > 0, 'paintActiveView was not called synchronously')
  const paintLatencyMs = paintedAt - started
  assert.ok(paintLatencyMs < 80, `paint blocked ${paintLatencyMs.toFixed(2)}ms waiting on sync`)

  await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(syncFinishedAt > paintedAt, 'sync should finish after first paint')
  assert.equal(ctx.state.activeTabId, 'mail:nucleus')

  const report = {
    generatedAt: new Date().toISOString(),
    environment: 'jsdom',
    paintLatencyMs: Number(paintLatencyMs.toFixed(3)),
    syncAfterPaintMs: Number((syncFinishedAt - paintedAt).toFixed(3)),
    budgets: { paintBeforeSyncMs: 80 },
    pass: paintLatencyMs < 80 && syncFinishedAt > paintedAt
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
})

test('rapid tab switches stay within per-switch paint budget', () => {
  const harness = createHarness({ state: buildTabState() })
  harness.loadRendererCore()
  const ctx = harness.context
  stubFastPipeline(ctx)
  ctx.syncActiveTab = async () => ({ ok: true })

  const samples = []
  const origPaint = ctx.paintActiveView.bind(ctx)
  ctx.paintActiveView = (options) => {
    const start = performance.now()
    origPaint(options)
    samples.push(performance.now() - start)
  }

  const order = ['mail:nucleus', 'browser:1', 'center:nucleus', 'mail:nucleus']
  for (const tabId of order) {
    ctx.switchWorkspaceTab(tabId)
  }

  const p95 = samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)]
  assert.ok(p95 < 40, `tab switch paint p95 ${p95.toFixed(2)}ms exceeds 40ms jsdom budget`)
  assert.equal(ctx.state.activeTabId, 'mail:nucleus')
})
