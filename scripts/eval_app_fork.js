#!/usr/bin/env node
'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { resolveScenarioTests, listScenarioIds, SCENARIOS } = require('../lib/app-fork/scenarios')
const { resolveBudgetProfile } = require('../lib/app-fork/budgets')

const ROOT = path.resolve(__dirname, '..')
const REPORT_DIR = path.join(ROOT, '.cache', 'app_fork')
const SUMMARY_PATH = path.join(REPORT_DIR, 'report.json')
const TRACE_PATH = path.join(REPORT_DIR, 'last_trace.json')

function parseArgs(argv) {
  const options = {
    scenario: 'all',
    profile: 'jsdom',
    writeTrace: true
  }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--scenario' && argv[i + 1]) {
      options.scenario = argv[i + 1]
      i += 1
    } else if (arg === '--profile' && argv[i + 1]) {
      options.profile = argv[i + 1]
      i += 1
    } else if (arg === '--no-trace') {
      options.writeTrace = false
    } else if (arg === '--list') {
      options.list = true
    }
  }
  return options
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (_error) {
    return null
  }
}

function collectStressReports() {
  const names = [
    'stress_preload.json',
    'stress_preload_generations.json',
    'stress_preload_ipc.json',
    'stress_tabs.json',
    'stress_tab_open.json',
    'stress_tabs_render.json',
    'stress_workspaces.json',
    'stress_workspace_memory.json',
    'stress_section_workspace.json'
  ]
  const stress = {}
  for (const name of names) {
    const data = readJsonIfExists(path.join(REPORT_DIR, name))
    if (data) stress[name.replace('.json', '')] = data
  }
  return Object.keys(stress).length ? stress : null
}

function main() {
  const cli = parseArgs(process.argv)
  if (cli.list) {
    console.log('App-fork scenarios:')
    for (const id of listScenarioIds()) {
      console.log(`  ${id} — ${SCENARIOS[id].label}`)
    }
    console.log('  all — run every scenario module')
    return
  }

  const started = performance.now()
  const tests = ['tests/app-fork/framework.test.js', ...resolveScenarioTests(cli.scenario)]
  const budget = resolveBudgetProfile(cli.profile)

  const result = spawnSync(process.execPath, ['--test', ...tests], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NUCLEUS_APP_FORK_PROFILE: cli.profile
    }
  })

  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  const pass = result.status === 0
  const durationMs = Number((performance.now() - started).toFixed(1))

  let loadTiming = readJsonIfExists(path.join(REPORT_DIR, 'load_timing.json'))
  const stress = collectStressReports()

  const report = {
    generatedAt: new Date().toISOString(),
    scenario: cli.scenario,
    profile: cli.profile,
    pass,
    exitCode: result.status,
    durationMs,
    testsRun: tests,
    budget,
    loadTiming,
    stress,
    scenarios: listScenarioIds()
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(report, null, 2))

  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)

  console.log(`\nApp-fork eval: ${SUMMARY_PATH}`)
  console.log(`Scenario: ${cli.scenario}, profile: ${cli.profile}, pass: ${pass}`)

  if (!pass) process.exit(result.status || 1)
}

main()
