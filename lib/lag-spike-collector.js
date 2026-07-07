// Canvas / tab interaction timing collector with spike detection.
'use strict'

const { performance } = require('node:perf_hooks')

const DEFAULT_SPIKE_MS = 120
const DEFAULT_NAV_SPIKE_MS = 250
const MAX_EVENTS = 400
const MAX_SPIKES = 120

const NAV_OPS = new Set([
  'canvas.open_link',
  'canvas.open_link.total',
  'canvas.back',
  'canvas.preload_swap',
  'canvas.preload_fallback',
  'nav.cover',
  'nav.wait_reveal',
  'nav.transfer',
  'tab.switch_active',
  'tab.run_serialized_wait',
  'visible_context.update',
  'preload.refresh',
  'preload.extract_links',
  'preload.load_slots'
])

function nowMs() {
  return performance.now()
}

function createLagSpikeCollector(options = {}) {
  const spikeMs = Number(options.spikeMs) || DEFAULT_SPIKE_MS
  const navSpikeMs = Number(options.navSpikeMs) || DEFAULT_NAV_SPIKE_MS
  const events = []
  const spikes = []
  const active = new Map()
  let seq = 0
  let serializedQueueDepth = 0
  let serializedWaitMs = 0

  function thresholdFor(op) {
    return NAV_OPS.has(op) ? navSpikeMs : spikeMs
  }

  function pushEvent(entry) {
    events.push(entry)
    while (events.length > MAX_EVENTS) events.shift()
    const limit = thresholdFor(entry.op)
    if (entry.durationMs >= limit) {
      spikes.push({
        ...entry,
        spikeThresholdMs: limit,
        overMs: Number((entry.durationMs - limit).toFixed(2))
      })
      while (spikes.length > MAX_SPIKES) spikes.shift()
    }
  }

  function begin(op, meta = {}) {
    const id = ++seq
    active.set(id, {
      id,
      op: String(op || 'unknown'),
      startedAt: nowMs(),
      meta: meta && typeof meta === 'object' ? { ...meta } : {}
    })
    return id
  }

  function end(id, meta = {}) {
    const row = active.get(id)
    if (!row) return null
    active.delete(id)
    const durationMs = Number((nowMs() - row.startedAt).toFixed(2))
    const entry = {
      id: row.id,
      op: row.op,
      durationMs,
      ts: Date.now(),
      meta: { ...row.meta, ...(meta && typeof meta === 'object' ? meta : {}) }
    }
    pushEvent(entry)
    return entry
  }

  function mark(op, meta = {}) {
    const entry = {
      id: ++seq,
      op: String(op || 'mark'),
      durationMs: 0,
      ts: Date.now(),
      meta: meta && typeof meta === 'object' ? { ...meta } : {},
      mark: true
    }
    events.push(entry)
    while (events.length > MAX_EVENTS) events.shift()
    return entry
  }

  async function span(op, fn, meta = {}) {
    const id = begin(op, meta)
    try {
      const result = await fn()
      end(id, { ok: true })
      return result
    } catch (error) {
      end(id, { ok: false, error: error && error.message ? error.message : String(error) })
      throw error
    }
  }

  function syncSpan(op, fn, meta = {}) {
    const id = begin(op, meta)
    try {
      const result = fn()
      end(id, { ok: true })
      return result
    } catch (error) {
      end(id, { ok: false, error: error && error.message ? error.message : String(error) })
      throw error
    }
  }

  function noteSerializedWait(waitMs) {
    serializedWaitMs = Number(waitMs) || 0
    if (serializedWaitMs >= spikeMs) {
      mark('tab.run_serialized_wait', { waitMs: serializedWaitMs, queueDepth: serializedQueueDepth })
    }
  }

  function setSerializedQueueDepth(depth) {
    serializedQueueDepth = Math.max(0, Number(depth) || 0)
  }

  function percentile(values, p) {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
    return sorted[idx]
  }

  function summarizeByOp(rows) {
    const buckets = Object.create(null)
    for (const row of rows) {
      if (row.mark) continue
      const key = row.op
      if (!buckets[key]) {
        buckets[key] = { op: key, count: 0, totalMs: 0, maxMs: 0, durations: [] }
      }
      const bucket = buckets[key]
      bucket.count += 1
      bucket.totalMs += row.durationMs
      bucket.maxMs = Math.max(bucket.maxMs, row.durationMs)
      bucket.durations.push(row.durationMs)
    }
    return Object.values(buckets)
      .map(bucket => ({
        op: bucket.op,
        count: bucket.count,
        avgMs: Number((bucket.totalMs / bucket.count).toFixed(2)),
        maxMs: Number(bucket.maxMs.toFixed(2)),
        p50Ms: percentile(bucket.durations, 50),
        p95Ms: percentile(bucket.durations, 95)
      }))
      .sort((left, right) => right.p95Ms - left.p95Ms || right.maxMs - left.maxMs)
  }

  function analyzeSpikes() {
    const byOp = Object.create(null)
    for (const spike of spikes) {
      byOp[spike.op] = (byOp[spike.op] || 0) + 1
    }
    const drivers = Object.entries(byOp)
      .map(([op, count]) => ({ op, count }))
      .sort((a, b) => b.count - a.count)

    const navSpikes = spikes.filter(row => NAV_OPS.has(row.op))
    const recent = spikes.slice(-20).reverse()

    return {
      totalSpikes: spikes.length,
      navSpikeCount: navSpikes.length,
      topDrivers: drivers.slice(0, 8),
      recent,
      serializedQueueDepth,
      lastSerializedWaitMs: serializedWaitMs
    }
  }

  function getSnapshot(extra = {}) {
    const timed = events.filter(row => !row.mark && row.durationMs > 0)
    return {
      sampledAt: Date.now(),
      activeCount: active.size,
      eventCount: events.length,
      spikeCount: spikes.length,
      thresholds: { spikeMs, navSpikeMs },
      byOp: summarizeByOp(timed),
      spikes: analyzeSpikes(),
      recentEvents: events.slice(-40).reverse(),
      ...extra
    }
  }

  function reset() {
    events.length = 0
    spikes.length = 0
    active.clear()
    serializedQueueDepth = 0
    serializedWaitMs = 0
  }

  return {
    begin,
    end,
    mark,
    span,
    syncSpan,
    noteSerializedWait,
    setSerializedQueueDepth,
    summarizeByOp,
    analyzeSpikes,
    getSnapshot,
    reset,
    NAV_OPS
  }
}

module.exports = {
  createLagSpikeCollector,
  DEFAULT_SPIKE_MS,
  DEFAULT_NAV_SPIKE_MS
}
