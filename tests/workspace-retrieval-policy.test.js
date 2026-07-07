'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeSession } = require('../lib/workspace-session')
const {
  resolveFocusCourseIdsForRetrieval,
  buildRetrievalPruneOptions
} = require('../lib/workspace-retrieval-policy')
const { buildWorkspaceContextPacket } = require('../lib/workspace-context-packet')
const { pruneConfidentlyIrrelevantCatalog } = require('../text-chunks')

const tab = { id: 't1', courseId: '100', type: 'canvastab' }
const tab200 = { id: 't2', courseId: '200', type: 'canvastab' }

test('strict_course restricts focus to primary courses', () => {
  const session = normalizeSession({
    groundingMode: 'strict_course',
    courseScope: { primaryCourseIds: ['100'], allowOtherCourses: false }
  }, 'nucleus')
  const scope = resolveFocusCourseIdsForRetrieval(session, {
    tabs: [tab, tab200],
    activeTab: tab200
  })
  assert.deepEqual(scope.focusCourseIds, ['100'])
  assert.equal(scope.restrictToFocus, true)
})

test('open_context does not restrict course pool', () => {
  const session = normalizeSession({
    groundingMode: 'open_context',
    courseScope: { primaryCourseIds: ['100'], allowOtherCourses: true }
  }, 'nucleus')
  const scope = resolveFocusCourseIdsForRetrieval(session, {
    tabs: [tab],
    activeTab: tab
  })
  assert.deepEqual(scope.focusCourseIds, [])
  assert.equal(scope.restrictToFocus, false)
})

test('buildRetrievalPruneOptions marks strict lock as restrictive', () => {
  const session = normalizeSession({
    groundingMode: 'course_first',
    contextLock: 'strict',
    courseScope: { primaryCourseIds: ['100'], allowOtherCourses: false }
  }, 'nucleus')
  const prune = buildRetrievalPruneOptions(session, {
    query: 'when is the exam',
    tabs: [tab],
    activeTab: tab
  })
  assert.equal(prune.contextLock, 'strict')
  assert.equal(prune.restrictToFocus, true)
  assert.deepEqual(prune.focusCourseIds, ['100'])
})

test('buildWorkspaceContextPacket includes health and prune options', () => {
  const session = normalizeSession({ workspaceId: 'nucleus' }, 'nucleus')
  const packet = buildWorkspaceContextPacket(session, {
    workspaceId: 'nucleus',
    tabs: [tab],
    activeTab: tab,
    allCourseIds: ['100', '200'],
    tasks: [{ id: 'task-1', workspaceId: 'nucleus', title: 'PSET 4' }]
  })
  assert.equal(packet.workspaceId, 'nucleus')
  assert.ok(packet.health)
  assert.ok(packet.pruneOptions)
  assert.equal(packet.groundingLabel, 'Workspace First')
})

test('strict prune drops out-of-scope chunks even with query overlap', () => {
  const catalog = [
    { citeLabel: 'R1', text: 'exam review for course 200', source: { courseid: '200' } }
  ]
  const soft = pruneConfidentlyIrrelevantCatalog(catalog, {
    query: 'exam',
    focusCourseIds: ['100'],
    contextLock: 'soft',
    restrictToFocus: false
  })
  const strict = pruneConfidentlyIrrelevantCatalog(catalog, {
    query: 'exam',
    focusCourseIds: ['100'],
    contextLock: 'strict',
    restrictToFocus: true
  })
  assert.equal(soft.catalog.length, 1)
  assert.equal(strict.catalog.length, 0)
})
