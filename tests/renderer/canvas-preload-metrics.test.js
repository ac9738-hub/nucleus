'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const metrics = require('../../lib/canvas-preload-metrics')

test('recordHit and recordMiss update summarize hit rate', () => {
  const tracker = metrics.createCanvasPreloadMetrics()
  tracker.recordHit({ tabId: 't1', url: 'https://canvas.example/a', courseId: '100', source: 'will-navigate' })
  tracker.recordHit({ tabId: 't1', url: 'https://canvas.example/b', courseId: '100', source: 'window-open' })
  tracker.recordMiss({ tabId: 't1', url: 'https://canvas.example/c', courseId: '100', source: 'will-navigate' })

  const summary = tracker.summarize()
  assert.equal(summary.hits, 2)
  assert.equal(summary.misses, 1)
  assert.equal(summary.navigations, 3)
  assert.equal(summary.hitRate, 0.6667)
  assert.equal(summary.byCourse['100'].hits, 2)
  assert.equal(summary.byCourse['100'].misses, 1)
})

test('parseEventsFromText accepts preload events and diagnostics JSONL', () => {
  const text = [
    JSON.stringify({
      ts: '2026-06-22T10:00:00.000Z',
      kind: 'hit',
      tabId: 'tab-1',
      url: 'https://canvas.example/courses/100/assignments/1',
      courseId: '100',
      source: 'will-navigate'
    }),
    JSON.stringify({
      ts: '2026-06-22T10:01:00.000Z',
      channel: 'tabs',
      event: 'preload_miss',
      data: {
        tabId: 'tab-1',
        url: 'https://canvas.example/courses/100/files/2',
        courseId: '100',
        source: 'window-open'
      }
    })
  ].join('\n')

  const events = metrics.parseEventsFromText(text)
  assert.equal(events.length, 2)
  assert.equal(events[0].kind, 'hit')
  assert.equal(events[1].kind, 'miss')
  assert.equal(events[1].source, 'window-open')
})

test('aggregateHitRate summarizes parsed events', () => {
  const events = metrics.parseEventsFromText([
    JSON.stringify({ ts: '2026-06-22T10:00:00.000Z', kind: 'hit', tabId: '1', url: 'https://canvas.example/a' }),
    JSON.stringify({ ts: '2026-06-22T10:01:00.000Z', kind: 'miss', tabId: '1', url: 'https://canvas.example/b' })
  ].join('\n'))
  const summary = metrics.aggregateHitRate(events)
  assert.equal(summary.hits, 1)
  assert.equal(summary.misses, 1)
  assert.equal(summary.hitRate, 0.5)
})

test('aggregateHitRate excludes mousedown preload hits', () => {
  const events = metrics.parseEventsFromText([
    JSON.stringify({
      ts: '2026-06-22T10:00:00.000Z',
      kind: 'hit',
      tabId: '1',
      url: 'https://canvas.example/a',
      loadReason: 'link_mousedown'
    }),
    JSON.stringify({
      ts: '2026-06-22T10:01:00.000Z',
      kind: 'hit',
      tabId: '1',
      url: 'https://canvas.example/b',
      loadReason: 'predictive'
    }),
    JSON.stringify({ ts: '2026-06-22T10:02:00.000Z', kind: 'miss', tabId: '1', url: 'https://canvas.example/c' })
  ].join('\n'))
  const summary = metrics.aggregateHitRate(events)
  assert.equal(summary.hits, 1)
  assert.equal(summary.misses, 1)
  assert.equal(summary.hitRate, 0.5)
})

test('summarize exposes predictive hit rate excluding mousedown hits', () => {
  const tracker = metrics.createCanvasPreloadMetrics()
  tracker.recordHit({
    tabId: 't1',
    url: 'https://canvas.example/a',
    loadReason: 'link_mousedown',
    slotState: 'ready',
    loadDurationMs: 900
  })
  tracker.recordHit({
    tabId: 't1',
    url: 'https://canvas.example/b',
    loadReason: 'native_section',
    slotState: 'ready',
    loadDurationMs: 1200
  })
  tracker.recordMiss({ tabId: 't1', url: 'https://canvas.example/c' })

  const summary = tracker.summarize()
  assert.equal(summary.hits, 2)
  assert.equal(summary.predictiveHits, 1)
  assert.equal(summary.misses, 1)
  assert.equal(summary.predictiveHitRate, 0.5)
  assert.equal(summary.lastHit.display, 'already loaded')
  assert.equal(summary.lastHit.loadDurationMs, 1200)
})

test('buildLastHitRecord marks partial loading hits with time saved', () => {
  const loadingAt = Date.now() - 450
  const record = metrics.buildLastHitRecord({
    url: 'https://canvas.example/courses/1/pages/x',
    source: 'will-navigate',
    loadReason: 'browser_refresh',
    slotState: 'loading',
    loadingAt
  })
  assert.equal(record.outcome, 'partial')
  assert.ok(record.timeSavedMs >= 400)
  assert.match(record.display, /saved/)
})

test('sanitizePayload keeps native page metadata', () => {
  const tracker = metrics.createCanvasPreloadMetrics()
  const entry = tracker.recordMiss({
    tabId: 'tab-1',
    url: 'https://canvas.example/courses/100/assignments/1',
    courseId: '100',
    source: 'open_link',
    surface: 'native',
    canvasNativePage: 'course',
    courseSection: 'weekly'
  })
  assert.equal(entry.surface, 'native')
  assert.equal(entry.canvasNativePage, 'course')
  assert.equal(entry.courseSection, 'weekly')
})

test('loadEventsFromSources dedupes identical events across files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-preload-merge-'))
  const entry = {
    ts: '2026-06-22T10:00:00.000Z',
    kind: 'hit',
    tabId: 'tab-1',
    url: 'https://canvas.example/courses/100',
    source: 'will-navigate'
  }
  metrics.appendEvent(dir, entry)
  const diagDir = path.join(dir, '.cache', 'diagnostics')
  fs.mkdirSync(diagDir, { recursive: true })
  fs.writeFileSync(path.join(diagDir, 'session-test.jsonl'), `${JSON.stringify({
    ts: entry.ts,
    channel: 'tabs',
    event: 'preload_hit',
    data: entry
  })}\n`, 'utf8')

  const merged = metrics.loadEventsFromSources(dir, { includeDiagnostics: true })
  assert.equal(merged.length, 1)
})

test('appendEvent writes JSONL line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-preload-metrics-'))
  const entry = {
    ts: '2026-06-22T10:00:00.000Z',
    kind: 'miss',
    tabId: 'tab-1',
    url: 'https://canvas.example/courses/100'
  }
  const eventsPath = metrics.appendEvent(dir, entry)
  assert.ok(fs.existsSync(eventsPath))
  const loaded = metrics.parseEventsFromFile(eventsPath)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].kind, 'miss')
})
