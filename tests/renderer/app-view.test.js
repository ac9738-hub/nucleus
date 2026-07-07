const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')
const { sampleTasks, sampleCanvasData } = require('./fixtures')

function loadApp(harness, options = {}) {
  harness.context.tasks = options.tasks || sampleTasks()
  harness.context.canvasData = options.canvasData || sampleCanvasData()
  harness.loadRendererCore()
  return harness.context
}

test('titleFromUrl extracts hostname and handles search URLs', () => {
  const ctx = loadApp(createHarness())
  assert.equal(ctx.titleFromUrl('https://www.princeton.edu/courses'), 'princeton.edu')
  assert.equal(ctx.titleFromUrl('nucleus://search?q=canvas'), 'Search')
  assert.equal(ctx.titleFromUrl(''), '')
})

test('isWebPageTab recognizes browser and canvas browser tabs', () => {
  const ctx = loadApp(createHarness())
  assert.equal(ctx.isWebPageTab({ type: 'browsertab' }), true)
  assert.equal(ctx.isWebPageTab({ type: 'canvastab', canvasMode: 'browser' }), true)
  assert.equal(ctx.isWebPageTab({ type: 'canvastab', canvasMode: 'native' }), false)
  assert.equal(ctx.isWebPageTab({ type: 'mailtab' }), false)
})

test('getNativeTabIconKind maps native app tab types', () => {
  const ctx = loadApp(createHarness())
  assert.equal(ctx.getNativeTabIconKind({ type: 'mailtab' }), 'mail')
  assert.equal(ctx.getNativeTabIconKind({ type: 'synapsetab' }), 'synapse')
  assert.equal(ctx.getNativeTabIconKind({ type: 'canvastab', canvasMode: 'native' }), 'canvas')
  assert.equal(ctx.getNativeTabIconKind({ type: 'artifacttab' }), 'artifact')
})

test('getTabDisplayTitle prefers canvas course names over raw ids', () => {
  const ctx = loadApp(createHarness(), { canvasData: sampleCanvasData() })
  assert.equal(
    ctx.getTabDisplayTitle({
      type: 'canvastab',
      canvasMode: 'native',
      canvasNativePage: 'course',
      courseId: '101'
    }),
    'Intro to Architecture'
  )
})

test('truncateTaskText trims long descriptions', () => {
  const ctx = loadApp(createHarness())
  const long = 'word '.repeat(80)
  const truncated = ctx.truncateTaskText(long, 40)
  assert.match(truncated, /\.\.\.$/)
  assert.ok(truncated.length < long.length)
})

test('getCanvasCourseDisplayName resolves course metadata from canvasData', () => {
  const ctx = loadApp(createHarness())
  const name = ctx.getCanvasCourseDisplayName({
    source: 'canvas',
    courseId: '101',
    course: 'Canvas 101'
  })
  assert.equal(name, 'Intro to Architecture')
})

test('formatTaskDueDisplay handles missing and valid due dates', () => {
  const ctx = loadApp(createHarness())
  assert.equal(ctx.formatTaskDueDisplay(''), 'No due date')
  assert.match(ctx.formatTaskDueDisplay('2026-06-21T23:59:00Z'), /21\/06|due today/)
})

test('getTodaysDashboardItems includes tasks due today', () => {
  const ctx = loadApp(createHarness())
  const today = new Date()
  const iso = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
    12,
    0,
    0
  )).toISOString()
  ctx.tasks = [{ id: 'today', title: 'Due today', due: iso, workspaceId: 'nucleus' }]
  const items = ctx.getTodaysDashboardItems(ctx.tasks)
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'today')
})

test('renderCalendarPlaceholder announces coming-soon state accessibly', () => {
  const ctx = loadApp(createHarness())
  const html = ctx.renderCalendarPlaceholder()
  assert.match(html, /Coming soon/)
  assert.match(html, /role="status"/)
})

test('renderPrimaryTabs updates aria-selected for active section', () => {
  const harness = createHarness()
  const ctx = loadApp(harness)
  ctx.state.top = 'section'
  ctx.state.activeSection = 'tasks'
  ctx.renderPrimaryTabs()
  const tasksButton = harness.document.querySelector('#primary-tabs [data-section="tasks"]')
  const homeButton = harness.document.querySelector('#primary-tabs [data-section="home"]')
  assert.equal(tasksButton.getAttribute('aria-selected'), 'true')
  assert.equal(homeButton.getAttribute('aria-selected'), 'false')
  assert.equal(tasksButton.classList.contains('active'), true)
})

test('renderHomeDashboard escapes task titles in output', () => {
  const harness = createHarness()
  const ctx = loadApp(harness)
  ctx.tasks = [{
    id: 'xss-task',
    title: '<img onerror=alert(1)>',
    course: 'Test',
    due: '2026-06-21T23:59:00Z',
    estimate: '1h',
    details: 'safe',
    workspaceId: 'nucleus'
  }]
  const html = ctx.renderHomeDashboard()
  assert.doesNotMatch(html, /<img onerror/)
  assert.match(html, /&lt;img onerror/)
})
