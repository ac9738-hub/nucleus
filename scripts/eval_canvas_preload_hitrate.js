#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const REPORT_PATH = path.join(ROOT, '.cache', 'canvas_preload', 'hitrate_report.json')
const {
  loadEventsFromSources,
  aggregateHitRate,
  resolveEventsPath
} = require('../lib/canvas-preload-metrics')

function parseArgs(argv) {
  const options = {
    diagPath: '',
    noDiag: false,
    minNavigations: 0
  }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--diag' && argv[i + 1]) {
      options.diagPath = path.resolve(argv[i + 1])
      i += 1
    } else if (arg === '--no-diag') {
      options.noDiag = true
    } else if (arg === '--min-navigations' && argv[i + 1]) {
      options.minNavigations = Number(argv[i + 1]) || 0
      i += 1
    }
  }
  return options
}

function runUnitTests() {
  const result = spawnSync(process.execPath, [
    '--test',
    'tests/renderer/canvas-preload-metrics.test.js'
  ], { cwd: ROOT, encoding: 'utf8' })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.status === 0
}

function main() {
  const started = performance.now()
  const cli = parseArgs(process.argv)
  const testsPass = runUnitTests()
  const events = loadEventsFromSources(ROOT, {
    diagPath: cli.diagPath || '',
    includeDiagnostics: !cli.noDiag
  })
  const summary = aggregateHitRate(events)
  const eventsPath = resolveEventsPath(ROOT)

  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: Number((performance.now() - started).toFixed(1)),
    testsPass,
    eventsPath,
    eventsLoaded: events.length,
    ...summary,
    pass: testsPass && (cli.minNavigations <= 0 || summary.navigations >= cli.minNavigations)
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

  console.log(`\nCanvas preload hit-rate eval: ${REPORT_PATH}`)
  console.log(`Events: ${report.eventsLoaded}, navigations: ${report.navigations}, hit rate: ${report.hitRate == null ? 'n/a' : `${(report.hitRate * 100).toFixed(1)}%`}`)

  if (!report.pass) process.exit(1)
}

main()
