'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { createAppFork } = require('./harness')
const { percentile } = require('../../lib/app-fork/budgets')

const REPORT_PATH = path.join(__dirname, '../../.cache/app_fork/load_timing.json')

test('load: tab switch paints before slow syncActiveTab', async () => {
  const fork = createAppFork({ profile: 'jsdom' })
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)

  let paintedAt = 0
  let syncFinishedAt = 0
  const origPaint = ctx.paintActiveView.bind(ctx)
  ctx.paintActiveView = (options) => {
    paintedAt = performance.now()
    fork.screen('paintActiveView synchronous', 'renderer:paint')
    return origPaint(options)
  }
  ctx.syncActiveTab = () => new Promise(resolve => {
    setTimeout(() => {
      syncFinishedAt = performance.now()
      fork.screen('syncActiveTab resolved', 'renderer:ipc')
      resolve({ ok: true })
    }, fork.budget.paintBeforeSyncMs)
  })

  const started = performance.now()
  fork.screen('before switchWorkspaceTab mail', 'renderer:action')
  ctx.switchWorkspaceTab('mail:nucleus')
  fork.screen('after switchWorkspaceTab mail', 'renderer:action')

  const paintLatencyMs = paintedAt - started
  assert.ok(paintedAt > 0)
  assert.ok(paintLatencyMs < fork.budget.paintBeforeSyncMs)

  await new Promise(resolve => setTimeout(resolve, fork.budget.paintBeforeSyncMs + 30))
  assert.ok(syncFinishedAt > paintedAt)

  const report = {
    generatedAt: new Date().toISOString(),
    environment: 'app-fork-jsdom',
    paintLatencyMs: Number(paintLatencyMs.toFixed(3)),
    syncAfterPaintMs: Number((syncFinishedAt - paintedAt).toFixed(3)),
    budget: fork.budget,
    traceSummary: fork.trace.summarize(),
    pass: paintLatencyMs < fork.budget.paintBeforeSyncMs
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
})

test('load: rapid tab switches stay within paint p95 budget', () => {
  const fork = createAppFork({ profile: 'jsdom' })
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)
  ctx.syncActiveTab = async () => ({ ok: true })

  const samples = []
  const origPaint = ctx.paintActiveView.bind(ctx)
  ctx.paintActiveView = (options) => {
    const start = performance.now()
    origPaint(options)
    samples.push(performance.now() - start)
    fork.screen(`paint sample ${samples.length}`, 'renderer:paint')
  }

  const order = ['mail:nucleus', 'browser:1', 'canvas:nucleus', 'center:nucleus', 'mail:nucleus']
  for (const tabId of order) {
    fork.screen(`switch to ${tabId}`, 'renderer:action')
    ctx.switchWorkspaceTab(tabId)
  }

  const p95 = percentile(samples, 0.95)
  fork.screen('after rapid switches', 'renderer:assert')
  assert.ok(p95 < fork.budget.tabSwitchPaintP95MaxMs, `p95 ${p95.toFixed(2)}ms`)
  assert.equal(ctx.state.activeTabId, 'mail:nucleus')
})
