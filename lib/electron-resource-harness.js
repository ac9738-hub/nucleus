// Electron process + system resource sampling for diagnostics / debug UI.
'use strict'

const os = require('os')

function bytesToMb(value) {
  return Math.round(Number(value || 0) / 1048576)
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10
}

function createElectronResourceHarness() {
  let lastMainCpu = null
  let lastSampleAt = 0

  function resetCpuBaseline() {
    lastMainCpu = null
    lastSampleAt = 0
  }

  function sampleMainCpuPercent() {
    if (typeof process.getCPUUsage !== 'function') return null
    const usage = process.getCPUUsage()
    const now = Date.now()
    if (!lastMainCpu || !lastSampleAt) {
      lastMainCpu = usage
      lastSampleAt = now
      return null
    }
    const elapsedUs = (now - lastSampleAt) * 1000
    const deltaUser = usage.user - lastMainCpu.user
    const deltaSystem = usage.system - lastMainCpu.system
    lastMainCpu = usage
    lastSampleAt = now
    if (elapsedUs <= 0) return null
    const pct = ((deltaUser + deltaSystem) / elapsedUs) * 100
    return round1(Math.min(100, Math.max(0, pct)))
  }

  function collectProcessMetrics(app) {
    if (!app || typeof app.getAppMetrics !== 'function') return []
    try {
      return app.getAppMetrics().map(entry => ({
        pid: entry.pid,
        type: String(entry.type || 'unknown'),
        cpuPct: round1((entry.cpu && entry.cpu.percentCPUUsage) || 0),
        workingSetMb: bytesToMb(entry.memory && entry.memory.workingSetSize),
        peakWorkingSetMb: bytesToMb(entry.memory && entry.memory.peakWorkingSetSize)
      }))
    } catch (_error) {
      return []
    }
  }

  function summarizeByType(processMetrics) {
    const byType = {}
    for (const entry of processMetrics) {
      if (!byType[entry.type]) {
        byType[entry.type] = { count: 0, workingSetMb: 0, cpuPct: 0 }
      }
      byType[entry.type].count += 1
      byType[entry.type].workingSetMb += entry.workingSetMb
      byType[entry.type].cpuPct = round1(byType[entry.type].cpuPct + entry.cpuPct)
    }
    return byType
  }

  function collect(app, context = {}) {
    const mem = process.memoryUsage()
    const mainCpuPct = sampleMainCpuPercent()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const processMetrics = collectProcessMetrics(app)
    const byType = summarizeByType(processMetrics)

    let totalWorkingSetMb = 0
    let totalCpuPct = 0
    for (const entry of processMetrics) {
      totalWorkingSetMb += entry.workingSetMb
      totalCpuPct += entry.cpuPct
    }

    const topConsumers = [...processMetrics]
      .sort((left, right) => right.workingSetMb - left.workingSetMb)
      .slice(0, 6)

    return {
      sampledAt: Date.now(),
      system: {
        totalMemMb: bytesToMb(totalMem),
        freeMemMb: bytesToMb(freeMem),
        usedMemPct: round1(((totalMem - freeMem) / totalMem) * 100),
        loadAvg: os.loadavg().map(round1)
      },
      main: {
        pid: process.pid,
        rssMb: bytesToMb(mem.rss),
        heapUsedMb: bytesToMb(mem.heapUsed),
        heapTotalMb: bytesToMb(mem.heapTotal),
        externalMb: bytesToMb(mem.external || 0),
        cpuPct: mainCpuPct
      },
      electron: {
        processCount: processMetrics.length,
        totalWorkingSetMb,
        totalCpuPct: round1(totalCpuPct),
        byType,
        topConsumers
      },
      counts: context.counts || {}
    }
  }

  return {
    collect,
    resetCpuBaseline,
    bytesToMb
  }
}

module.exports = {
  createElectronResourceHarness,
  bytesToMb
}
