'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')

test('renderWorkspaceControlCenter shows overview and open pages', () => {
  const { context, loadRendererCore, runScript } = createHarness({
    state: {
      top: 'workspace',
      activeWorkspaceId: 'nucleus',
      activeTabId: 'center:nucleus',
      tabs: [
        { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
        {
          id: 'browser:1',
          type: 'browsertab',
          workspaceId: 'nucleus',
          label: 'Lecture 8',
          url: 'https://canvas.example/courses/100/files/lecture8.pdf'
        }
      ]
    },
    canvasData: {
      courses: [{ id: '100', course_code: 'COS 226', name: 'Algorithms' }]
    },
    tasks: [{
      id: 'task-1',
      workspaceId: 'nucleus',
      courseId: '100',
      title: 'PSET 4',
      details: 'Finish Question 3',
      due: '2026-03-14T00:00:00.000Z'
    }]
  })

  context.workspaceSessions = {
    nucleus: {
      workspaceId: 'nucleus',
      activeTaskIds: ['task-1']
    }
  }

  loadRendererCore()

  const html = context.renderWorkspaceControlCenter(context.getWorkspace('nucleus'))
  assert.match(html, /Context controller/)
  assert.match(html, /Search these classes first/)
  assert.match(html, /Grounding mode/)
  assert.match(html, /Context lock/)
  assert.match(html, /Tasks in progress/)
  assert.match(html, /COS 226/)
  assert.match(html, /PSET 4/)
  assert.match(html, /Open pages/)
  assert.match(html, /Lecture 8/)
  assert.match(html, /Include in AI/)
})

test('ensureWorkspaceCenter uses Control Center label', () => {
  const { context, loadWorkspaceTabs } = createHarness()
  loadWorkspaceTabs()
  const tabId = context.ensureWorkspaceCenter('biology')
  const tab = context.state.tabs.find(item => item.id === tabId)
  assert.equal(tab.label, 'Control Center')
})
