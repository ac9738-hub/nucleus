'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeSession,
  setTabIncludeInContext,
  isTabIncludedInContext,
  collectWorkspaceFocusCourseIds,
  computeContextHealth,
  recordActivity,
  defaultTabIncludeInContext
} = require('../lib/workspace-session')

test('normalizeSession applies workspace defaults', () => {
  const session = normalizeSession(null, 'biology')
  assert.equal(session.workspaceId, 'biology')
  assert.equal(session.groundingMode, 'workspace_first')
  assert.equal(session.contextLock, 'balanced')
})

test('setTabIncludeInContext stores explicit exclusions', () => {
  const tab = { id: 'browser:1', type: 'browsertab', url: 'https://canvas.example/courses/100/files/1' }
  let session = normalizeSession({}, 'nucleus')
  session = setTabIncludeInContext(session, tab.id, false, tab)
  assert.equal(isTabIncludedInContext(session, tab.id), false)
})

test('collectWorkspaceFocusCourseIds skips excluded tabs', () => {
  const tab = {
    id: 'browser:1',
    type: 'browsertab',
    workspaceId: 'nucleus',
    url: 'https://canvas.example/courses/100/files/1'
  }
  let session = normalizeSession({}, 'nucleus')
  session = setTabIncludeInContext(session, tab.id, false, tab)
  const ids = collectWorkspaceFocusCourseIds(session, [tab], tab)
  assert.deepEqual(ids, [])
})

test('computeContextHealth reports strong when assignment and lecture are present', () => {
  const session = normalizeSession({
    workspaceId: 'nucleus',
    activeTaskIds: ['task-1']
  }, 'nucleus')
  const health = computeContextHealth(session, {
    tasks: [{ id: 'task-1', workspaceId: 'nucleus', title: 'PSET 4' }],
    tabs: [
      { id: 'browser:1', workspaceId: 'nucleus', type: 'browsertab', url: 'https://x.edu/file.pdf' }
    ]
  })
  assert.equal(health.level, 'strong')
  assert.ok(health.reasons.includes('Assignment loaded'))
})

test('recordActivity prepends events and caps history', () => {
  let session = normalizeSession({}, 'nucleus')
  session = recordActivity(session, { type: 'tab_open', label: 'Opened Lecture 8' }, 'nucleus')
  assert.equal(session.recentActivity.length, 1)
  assert.equal(session.recentActivity[0].label, 'Opened Lecture 8')
})

test('defaultTabIncludeInContext excludes mail and center tabs', () => {
  assert.equal(defaultTabIncludeInContext({ type: 'mailtab' }), false)
  assert.equal(defaultTabIncludeInContext({ type: 'center' }), false)
  assert.equal(defaultTabIncludeInContext({ type: 'browsertab' }), true)
})
