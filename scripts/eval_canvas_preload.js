#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const REPORT_PATH = path.join(ROOT, '.cache', 'canvas_preload', 'report.json')
const { planPreloadUrls, collectCandidates, summarizePlan } = require('../lib/canvas-preload-planner')
const { collectGraphCandidates } = require('../lib/canvas-preload-graph')
const { courseIdFromUrl } = require('../context-index')

function readCanvasGraph() {
  const filePath = path.join(ROOT, 'canvas_graph.json')
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    console.error('Unable to read canvas_graph.json:', error.message)
    return null
  }
}

function readCanvasData() {
  const filePath = path.join(ROOT, 'canvas_data.json')
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    console.error('Unable to read canvas_data.json:', error.message)
    return null
  }
}

function focusCourseIdsFromData(canvasData) {
  const courses = canvasData && Array.isArray(canvasData.courses) ? canvasData.courses : []
  return courses.map(course => String(course.id || '')).filter(Boolean).slice(0, 8)
}

function runUnitTests() {
  const result = spawnSync(process.execPath, [
    '--test',
    'tests/renderer/canvas-preload-planner.test.js',
    'tests/renderer/canvas-preload-dom.test.js',
    'tests/renderer/canvas-preload-native.test.js',
    'tests/renderer/canvas-preload-graph.test.js',
    'tests/renderer/canvas-preload-metrics.test.js',
    'tests/renderer/canvas-preload-modules.test.js'
  ], { cwd: ROOT, encoding: 'utf8' })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.status === 0
}

function main() {
  const started = performance.now()
  const testsPass = runUnitTests()
  const canvasData = readCanvasData()
  const canvasGraph = readCanvasGraph()
  const nowMs = Date.now()
  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: 0,
    testsPass,
    hasCanvasData: Boolean(canvasData),
    hasCanvasGraph: Boolean(canvasGraph),
    courses: [],
    totals: {
      candidates: 0,
      planned: 0,
      graphCandidates: 0
    }
  }

  if (canvasData) {
    const focusCourseIds = focusCourseIdsFromData(canvasData)
    const collectStarted = performance.now()
    const allCandidates = collectCandidates(canvasData, {
      focusCourseIds,
      graph: canvasGraph,
      activeUrl: '',
      domLinks: [],
      nowMs
    })
    const collectMs = performance.now() - collectStarted
    report.totals.graphCandidates = collectGraphCandidates(canvasGraph, canvasData, {
      focusCourseIds,
      nowMs
    }).length

    for (const courseId of focusCourseIds) {
      const planned = planPreloadUrls(canvasData, {
        focusCourseIds: [courseId],
        graph: canvasGraph,
        activeUrl: '',
        domLinks: [],
        nowMs,
        limit: 5
      })
      report.courses.push({
        courseId,
        plannedCount: planned.length,
        top: summarizePlan(planned).slice(0, 3)
      })
      report.totals.planned += planned.length
    }

    report.totals.candidates = allCandidates.length
    report.collectMs = Number(collectMs.toFixed(3))
    report.sampleFocusCourseId = focusCourseIds[0] || ''
    if (focusCourseIds[0]) {
      const sampleUrl = `https://canvas.example/courses/${focusCourseIds[0]}`
      report.sampleCourseIdFromUrl = courseIdFromUrl(sampleUrl)
    }
  }

  report.durationMs = Number((performance.now() - started).toFixed(1))
  report.hasWeeklySchedule = Boolean(
    canvasData && canvasData.weekly_schedule && Object.keys(canvasData.weekly_schedule).length
  )
  report.pass = testsPass

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

  console.log(`\nCanvas preload eval: ${REPORT_PATH}`)
  if (canvasData) {
    console.log(`Courses evaluated: ${report.courses.length}, candidates: ${report.totals.candidates}`)
  } else {
    console.log('No canvas_data.json — unit tests only.')
  }

  if (!report.pass) process.exit(1)
}

main()
