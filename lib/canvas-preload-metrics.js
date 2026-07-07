// Canvas preload production metrics (pure functions + lightweight event log).
// Events append to .cache/canvas_preload/events.jsonl for offline hit-rate eval.

const fs = require('fs')
const path = require('path')

const DEFAULT_EVENTS_RELATIVE = path.join('.cache', 'canvas_preload', 'events.jsonl')
const DEFAULT_MAX_RECENT = 100

function truncateUrl(url, max = 240) {
  const text = String(url || '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function sanitizePayload(payload = {}) {
  const out = {}
  if (payload.tabId != null) out.tabId = String(payload.tabId)
  if (payload.url) out.url = truncateUrl(payload.url)
  if (payload.courseId) out.courseId = String(payload.courseId)
  if (payload.source) out.source = String(payload.source)
  if (payload.poolSize != null) out.poolSize = Number(payload.poolSize)
  if (payload.plannedCount != null) out.plannedCount = Number(payload.plannedCount)
  if (payload.reason) out.reason = String(payload.reason)
  if (payload.surface) out.surface = String(payload.surface)
  if (payload.canvasNativePage) out.canvasNativePage = String(payload.canvasNativePage)
  if (payload.courseSection) out.courseSection = String(payload.courseSection)
  if (payload.loadReason) out.loadReason = String(payload.loadReason)
  if (payload.slotState) out.slotState = String(payload.slotState)
  if (payload.outcome) out.outcome = String(payload.outcome)
  if (payload.timeSavedMs != null && Number.isFinite(Number(payload.timeSavedMs))) {
    out.timeSavedMs = Math.round(Number(payload.timeSavedMs))
  }
  if (payload.loadDurationMs != null && Number.isFinite(Number(payload.loadDurationMs))) {
    out.loadDurationMs = Math.round(Number(payload.loadDurationMs))
  }
  return out
}

function isPredictivePreloadHit(payload = {}) {
  return String(payload.loadReason || '') !== 'link_mousedown'
}

function buildLastHitRecord(payload = {}) {
  const slotState = String(payload.slotState || '')
  const loadDurationMs = Number(payload.loadDurationMs) || 0
  const loadingAt = Number(payload.loadingAt) || 0
  let outcome = ''
  let timeSavedMs = null
  let display = ''

  if (slotState === 'ready') {
    outcome = 'already_loaded'
    display = 'already loaded'
  } else if (slotState === 'loading' && loadingAt > 0) {
    outcome = 'partial'
    timeSavedMs = Math.max(0, Date.now() - loadingAt)
    display = `${timeSavedMs}ms saved (still loading)`
  }

  return {
    ts: Date.now(),
    url: truncateUrl(payload.url),
    source: String(payload.source || ''),
    loadReason: String(payload.loadReason || ''),
    slotState,
    outcome,
    timeSavedMs,
    loadDurationMs: loadDurationMs > 0 ? loadDurationMs : null,
    display
  }
}

function createCanvasPreloadMetrics(options = {}) {
  const maxRecent = Math.max(10, Number(options.maxRecent) || DEFAULT_MAX_RECENT)
  const state = {
    hits: 0,
    misses: 0,
    predictiveHits: 0,
    bySource: Object.create(null),
    byCourse: Object.create(null),
    recent: [],
    lastHit: null
  }

  function bumpCourse(courseId, kind) {
    if (!courseId) return
    const key = String(courseId)
    if (!state.byCourse[key]) {
      state.byCourse[key] = { hits: 0, misses: 0 }
    }
    state.byCourse[key][kind === 'hit' ? 'hits' : 'misses'] += 1
  }

  function record(kind, payload = {}) {
    const normalizedKind = kind === 'hit' ? 'hit' : 'miss'
    if (normalizedKind === 'hit') {
      state.hits += 1
      if (isPredictivePreloadHit(payload)) state.predictiveHits += 1
    } else {
      state.misses += 1
    }

    const source = String(payload.source || 'will-navigate')
    state.bySource[source] = (state.bySource[source] || 0) + 1
    bumpCourse(payload.courseId, normalizedKind)

    const entry = {
      ts: new Date().toISOString(),
      kind: normalizedKind,
      ...sanitizePayload(payload)
    }
    state.recent.push(entry)
    while (state.recent.length > maxRecent) state.recent.shift()

    if (normalizedKind === 'hit') {
      state.lastHit = buildLastHitRecord(payload)
    }
    return entry
  }

  function recordHit(payload = {}) {
    return record('hit', payload)
  }

  function recordMiss(payload = {}) {
    return record('miss', payload)
  }

  function summarize() {
    const navigations = state.hits + state.misses
    const predictiveNavigations = state.predictiveHits + state.misses
    return {
      hits: state.hits,
      misses: state.misses,
      predictiveHits: state.predictiveHits,
      navigations,
      hitRate: navigations ? Number((state.hits / navigations).toFixed(4)) : null,
      predictiveHitRate: predictiveNavigations
        ? Number((state.predictiveHits / predictiveNavigations).toFixed(4))
        : null,
      bySource: { ...state.bySource },
      byCourse: { ...state.byCourse },
      recent: state.recent.slice(-20),
      lastHit: state.lastHit ? { ...state.lastHit } : null
    }
  }

  function reset() {
    state.hits = 0
    state.misses = 0
    state.predictiveHits = 0
    state.bySource = Object.create(null)
    state.byCourse = Object.create(null)
    state.recent = []
    state.lastHit = null
  }

  return {
    record,
    recordHit,
    recordMiss,
    summarize,
    reset,
    getState: () => ({
      hits: state.hits,
      misses: state.misses,
      bySource: { ...state.bySource },
      byCourse: { ...state.byCourse },
      recent: state.recent.slice()
    })
  }
}

function normalizeEventLine(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  if (parsed.kind === 'hit' || parsed.kind === 'miss') {
    return {
      ts: parsed.ts || '',
      kind: parsed.kind,
      tabId: parsed.tabId || '',
      url: parsed.url || '',
      courseId: parsed.courseId || '',
      source: parsed.source || '',
      poolSize: parsed.poolSize ?? null,
      plannedCount: parsed.plannedCount ?? null,
      reason: parsed.reason || '',
      surface: parsed.surface || '',
      canvasNativePage: parsed.canvasNativePage || '',
      courseSection: parsed.courseSection || '',
      loadReason: parsed.loadReason || ''
    }
  }
  if (parsed.channel === 'tabs' && (parsed.event === 'preload_hit' || parsed.event === 'preload_miss')) {
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {}
    return {
      ts: parsed.ts || '',
      kind: parsed.event === 'preload_hit' ? 'hit' : 'miss',
      tabId: data.tabId || '',
      url: data.url || '',
      courseId: data.courseId || '',
      source: data.source || '',
      poolSize: data.poolSize ?? null,
      plannedCount: data.plannedCount ?? null,
      reason: data.reason || '',
      surface: data.surface || '',
      canvasNativePage: data.canvasNativePage || '',
      courseSection: data.courseSection || '',
      loadReason: data.loadReason || ''
    }
  }
  return null
}

function parseEventsFromText(text) {
  const events = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const normalized = normalizeEventLine(JSON.parse(trimmed))
      if (normalized) events.push(normalized)
    } catch (_error) {
      // Skip malformed lines.
    }
  }
  return events
}

function parseEventsFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return []
  return parseEventsFromText(fs.readFileSync(filePath, 'utf8'))
}

function aggregateHitRate(events = []) {
  const metrics = createCanvasPreloadMetrics()
  for (const event of events) {
    if (event.kind === 'hit' && event.loadReason === 'link_mousedown') continue
    if (event.kind === 'hit') metrics.recordHit(event)
    else if (event.kind === 'miss') metrics.recordMiss(event)
  }
  const summary = metrics.summarize()
  return {
    ...summary,
    eventCount: events.length,
    firstEventAt: events[0] && events[0].ts || '',
    lastEventAt: events.length ? events[events.length - 1].ts : ''
  }
}

function resolveEventsPath(rootDir, options = {}) {
  if (options.eventsPath) return options.eventsPath
  return path.join(rootDir, DEFAULT_EVENTS_RELATIVE)
}

function appendEvent(rootDir, entry, options = {}) {
  if (!entry || typeof entry !== 'object') return ''
  const eventsPath = resolveEventsPath(rootDir, options)
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true })
  fs.appendFileSync(eventsPath, `${JSON.stringify(entry)}\n`, 'utf8')
  return eventsPath
}

function findDiagnosticLogFiles(rootDir) {
  const diagDir = path.join(rootDir, '.cache', 'diagnostics')
  if (!fs.existsSync(diagDir)) return []
  return fs.readdirSync(diagDir)
    .filter(name => name.startsWith('session-') && name.endsWith('.jsonl'))
    .map(name => path.join(diagDir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
}

function loadEventsFromSources(rootDir, options = {}) {
  const events = []
  const seen = new Set()

  const pushUnique = (event) => {
    const key = `${event.ts}|${event.kind}|${event.tabId}|${event.url}|${event.source}`
    if (seen.has(key)) return
    seen.add(key)
    events.push(event)
  }

  const eventsPath = resolveEventsPath(rootDir, options)
  parseEventsFromFile(eventsPath).forEach(pushUnique)

  if (options.includeDiagnostics !== false) {
    const diagFiles = options.diagPath
      ? [options.diagPath]
      : findDiagnosticLogFiles(rootDir).slice(0, options.diagLimit || 5)
    for (const filePath of diagFiles) {
      parseEventsFromFile(filePath).forEach(pushUnique)
    }
  }

  events.sort((left, right) => String(left.ts).localeCompare(String(right.ts)))
  return events
}

module.exports = {
  DEFAULT_EVENTS_RELATIVE,
  createCanvasPreloadMetrics,
  isPredictivePreloadHit,
  buildLastHitRecord,
  normalizeEventLine,
  parseEventsFromText,
  parseEventsFromFile,
  aggregateHitRate,
  appendEvent,
  loadEventsFromSources,
  resolveEventsPath
}
