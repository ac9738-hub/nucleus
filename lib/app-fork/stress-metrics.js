// Peak + percentile resource sampling for app-fork stress scenarios.

const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { percentile } = require('./budgets')
const { POOL_LIMITS } = require('./mock-main-process')

const REPORT_DIR = path.join(__dirname, '../../.cache/app_fork')

function resolveStressBudget(profile) {
  const gpu = profile.gpu || {}
  return {
    preloadUrlBurst: 24,
    tabSwitchBurst: 60,
    workspaceSwitchBurst: 16,
    concurrentPreloadGenerations: 4,
    maxPeakLayerScore: Math.max(gpu.maxLayerScore || 12, 14),
    maxPeakEstimatedMb: Math.max(gpu.maxEstimatedMb || 384, 448),
    maxPeakPredictive: POOL_LIMITS.canvas.maxSize,
    maxPoolCanvasTotal: POOL_LIMITS.canvas.maxSize,
    maxPoolWebTotal: POOL_LIMITS.web.maxSize,
    maxTabSwitchP95Ms: (profile.tabSwitchPaintP95MaxMs || 40) * 2.5,
    maxWorkspaceSwitchP95Ms: (profile.workspaceSwitchMaxMs || 120) * 2,
    maxPaintPerSwitch: 3
  }
}

function createStressCollector(fork, label) {
  const started = performance.now()
  const samples = {
    gpu: [],
    switchMs: [],
    workspaceSwitchMs: [],
    paintMs: [],
    preloadAttempts: 0,
    preloadLoaded: 0,
    ipcByChannel: Object.create(null)
  }

  const peak = {
    layerScore: 0,
    estimatedMb: 0,
    predictiveCount: 0,
    poolCanvasTotal: 0,
    poolWebTotal: 0,
    poolCanvasInUse: 0,
    preloadPoolSize: 0
  }

  function refreshPeak(pressure, snap) {
    peak.layerScore = Math.max(peak.layerScore, pressure.layerScore)
    peak.estimatedMb = Math.max(peak.estimatedMb, pressure.estimatedMb)
    peak.predictiveCount = Math.max(peak.predictiveCount, pressure.predictiveCount)
    if (snap && snap.pool) {
      peak.poolCanvasTotal = Math.max(peak.poolCanvasTotal, snap.pool.canvas.total)
      peak.poolWebTotal = Math.max(peak.poolWebTotal, snap.pool.web.total)
      peak.poolCanvasInUse = Math.max(peak.poolCanvasInUse, snap.pool.canvas.inUse)
    }
    if (snap && snap.preload) {
      peak.preloadPoolSize = Math.max(peak.preloadPoolSize, snap.preload.poolSize)
    }
  }

  function sampleGpu(comment, process = 'stress:gpu') {
    const pressure = fork.gpuPressure()
    const snap = fork.mockMain.snapshot()
    refreshPeak(pressure, snap)
    samples.gpu.push({
      tMs: Number((performance.now() - started).toFixed(3)),
      layerScore: pressure.layerScore,
      estimatedMb: pressure.estimatedMb,
      predictiveCount: pressure.predictiveCount,
      withinBudget: pressure.withinBudget,
      poolCanvasTotal: snap.pool.canvas.total,
      preloadPoolSize: snap.preload.poolSize
    })
    fork.screen(comment, process)
    return pressure
  }

  function recordSwitchMs(ms) {
    if (Number.isFinite(ms)) samples.switchMs.push(ms)
  }

  function recordWorkspaceSwitchMs(ms) {
    if (Number.isFinite(ms)) samples.workspaceSwitchMs.push(ms)
  }

  function recordPaintMs(ms) {
    if (Number.isFinite(ms)) samples.paintMs.push(ms)
  }

  function recordPreloadResult(attempted, loaded) {
    samples.preloadAttempts += attempted
    samples.preloadLoaded += loaded
  }

  function snapshotIpcCounts() {
    samples.ipcByChannel = Object.create(null)
    for (const call of fork.ipcCalls) {
      const channel = call.channel || 'unknown'
      samples.ipcByChannel[channel] = (samples.ipcByChannel[channel] || 0) + 1
    }
  }

  function finalize(extra = {}) {
    snapshotIpcCounts()
    return {
      label,
      durationMs: Number((performance.now() - started).toFixed(1)),
      peak,
      samples: {
        switchCount: samples.switchMs.length,
        switchP50Ms: Number(percentile(samples.switchMs, 0.5).toFixed(3)),
        switchP95Ms: Number(percentile(samples.switchMs, 0.95).toFixed(3)),
        switchMaxMs: samples.switchMs.length
          ? Number(Math.max(...samples.switchMs).toFixed(3))
          : 0,
        workspaceSwitchCount: samples.workspaceSwitchMs.length,
        workspaceSwitchP95Ms: Number(percentile(samples.workspaceSwitchMs, 0.95).toFixed(3)),
        paintCount: samples.paintMs.length,
        paintP95Ms: Number(percentile(samples.paintMs, 0.95).toFixed(3)),
        gpuSampleCount: samples.gpu.length,
        preloadAttempts: samples.preloadAttempts,
        preloadLoaded: samples.preloadLoaded,
        ipcByChannel: { ...samples.ipcByChannel }
      },
      traceSummary: fork.trace.summarize(),
      ...extra
    }
  }

  function writeReport(filename, report) {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    fs.writeFileSync(path.join(REPORT_DIR, filename), JSON.stringify(report, null, 2))
    return path.join(REPORT_DIR, filename)
  }

  return {
    samples,
    peak,
    sampleGpu,
    recordSwitchMs,
    recordWorkspaceSwitchMs,
    recordPaintMs,
    recordPreloadResult,
    finalize,
    writeReport
  }
}

function assertStressBounds(report, stressBudget, assertFn) {
  const issues = []

  if (report.peak.layerScore > stressBudget.maxPeakLayerScore) {
    issues.push(`peak layerScore ${report.peak.layerScore} > ${stressBudget.maxPeakLayerScore}`)
  }
  if (report.peak.estimatedMb > stressBudget.maxPeakEstimatedMb) {
    issues.push(`peak estimatedMb ${report.peak.estimatedMb} > ${stressBudget.maxPeakEstimatedMb}`)
  }
  if (report.peak.poolCanvasTotal > stressBudget.maxPoolCanvasTotal) {
    issues.push(`pool canvas total ${report.peak.poolCanvasTotal} > ${stressBudget.maxPoolCanvasTotal}`)
  }
  if (report.peak.poolWebTotal > stressBudget.maxPoolWebTotal) {
    issues.push(`pool web total ${report.peak.poolWebTotal} > ${stressBudget.maxPoolWebTotal}`)
  }
  if (report.samples.switchP95Ms > stressBudget.maxTabSwitchP95Ms) {
    issues.push(`tab switch p95 ${report.samples.switchP95Ms}ms > ${stressBudget.maxTabSwitchP95Ms}ms`)
  }
  if (report.samples.workspaceSwitchP95Ms > stressBudget.maxWorkspaceSwitchP95Ms) {
    issues.push(`workspace switch p95 ${report.samples.workspaceSwitchP95Ms}ms > ${stressBudget.maxWorkspaceSwitchP95Ms}ms`)
  }

  assertFn(issues.length === 0, issues.join('; '))
  return issues
}

module.exports = {
  REPORT_DIR,
  resolveStressBudget,
  createStressCollector,
  assertStressBounds
}
