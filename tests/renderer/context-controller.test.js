'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')

test('context control bar renders grounding modes and course scope', () => {
  const { context, loadRendererCore, runScript } = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: 'center:nucleus',
      tabs: [{ id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' }]
    },
    canvasData: {
      courses: [
        { id: '100', course_code: 'COS 226', name: 'Algorithms' },
        { id: '200', course_code: 'MAT 202', name: 'Linear Algebra' }
      ]
    }
  })

  context.workspaceSessions = {
    nucleus: {
      workspaceId: 'nucleus',
      groundingMode: 'course_first',
      contextLock: 'balanced',
      courseScope: { primaryCourseIds: ['100'], allowOtherCourses: false }
    }
  }

  loadRendererCore()

  const html = context.renderContextControlBar(context.workspaceSessions.nucleus, 'nucleus')
  assert.match(html, /Grounding mode/)
  assert.match(html, /Strict Course/)
  assert.match(html, /Workspace First/)
  assert.match(html, /COS 226/)
  assert.match(html, /Allow searching other courses/)
  assert.match(html, /Context lock/)
})
