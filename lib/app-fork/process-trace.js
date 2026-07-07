// High-precision process trace for headless app-fork tests.
// Every step records: seq, tMs, process lane, comment, optional screen snapshot.

const { performance } = require('node:perf_hooks')

function createProcessTrace(options = {}) {
  const started = performance.now()
  let seq = 0
  const entries = []
  const maxEntries = Math.max(50, Number(options.maxEntries) || 5000)

  function step(process, comment, screen = null, data = null) {
    const entry = {
      seq: ++seq,
      tMs: Number((performance.now() - started).toFixed(3)),
      process: String(process || 'unknown'),
      comment: String(comment || ''),
      screen: screen || null,
      data: data || null
    }
    entries.push(entry)
    if (entries.length > maxEntries) entries.shift()
    return entry
  }

  function fork(process, comment) {
    return (screen, data) => step(process, comment, screen, data)
  }

  function summarize() {
    const byProcess = Object.create(null)
    for (const entry of entries) {
      byProcess[entry.process] = (byProcess[entry.process] || 0) + 1
    }
    const last = entries.length ? entries[entries.length - 1] : null
    return {
      count: entries.length,
      durationMs: last ? last.tMs : 0,
      byProcess,
      firstSeq: entries[0] ? entries[0].seq : 0,
      lastSeq: last ? last.seq : 0
    }
  }

  function toJSON() {
    return {
      summary: summarize(),
      entries
    }
  }

  function reset() {
    seq = 0
    entries.length = 0
  }

  return {
    step,
    fork,
    summarize,
    toJSON,
    reset,
    get entries() {
      return entries.slice()
    }
  }
}

module.exports = {
  createProcessTrace
}
