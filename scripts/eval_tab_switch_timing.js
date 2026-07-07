#!/usr/bin/env node
'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const REPORT_DIR = path.join(ROOT, '.cache', 'ui_speed')
const TIMING_REPORT = path.join(REPORT_DIR, 'tab_switch_timing.json')
const SUMMARY_REPORT = path.join(REPORT_DIR, 'tab_switch_eval_summary.json')

const tests = [
  'tests/renderer/tab-switch-timing.test.js',
  'tests/renderer/tab-switch-races.test.js',
  'tests/renderer/view-transition.test.js'
]

const started = Date.now()
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: ROOT,
  encoding: 'utf8'
})

const finished = Date.now()
const stdout = result.stdout || ''
const stderr = result.stderr || ''
const pass = result.status === 0

let timing = null
if (fs.existsSync(TIMING_REPORT)) {
  try {
    timing = JSON.parse(fs.readFileSync(TIMING_REPORT, 'utf8'))
  } catch (_error) {
    timing = null
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  durationMs: finished - started,
  pass,
  exitCode: result.status,
  timing,
  budgets: {
    paintBeforeSyncMs: 80,
    tabSwitchPaintP95MaxMs: 40
  }
}

fs.mkdirSync(REPORT_DIR, { recursive: true })
fs.writeFileSync(SUMMARY_REPORT, JSON.stringify(summary, null, 2))

if (stdout) process.stdout.write(stdout)
if (stderr) process.stderr.write(stderr)

if (!pass) {
  process.exit(result.status || 1)
}

if (timing) {
  console.log(`\nTab switch paint latency: ${timing.paintLatencyMs}ms (must paint before ${summary.budgets.paintBeforeSyncMs}ms sync)`)
}
console.log(`Eval summary: ${SUMMARY_REPORT}`)
