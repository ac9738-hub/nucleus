const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')
const { sampleCanvasData, sampleMailState, sampleSynapseTab } = require('./fixtures')

test('renderView mounts native canvas dashboard in canvas tab', () => {
  const harness = createHarness({ canvasData: sampleCanvasData() })
  harness.loadCanvasStack()
  harness.loadRendererCore()
  harness.context.state.top = 'workspace'
  harness.context.state.activeTabId = 'canvas:nucleus'
  harness.context.state.tabs = [{
    id: 'canvas:nucleus',
    type: 'canvastab',
    canvasMode: 'native',
    workspaceId: 'nucleus',
    label: 'Canvas'
  }]
  harness.context.renderView()
  const view = harness.document.getElementById('view')
  assert.match(view.innerHTML, /Intro to Architecture/)
  assert.ok(view.querySelector('[data-canvas-course-id="101"]'))
})

test('renderView mounts mail app surface in mail tab', () => {
  const harness = createHarness()
  harness.loadMailSuite()
  harness.context.mailState = sampleMailState()
  global.mailState = harness.context.mailState
  harness.context.state.top = 'workspace'
  harness.context.state.activeTabId = 'mail:nucleus'
  harness.context.state.tabs = [{
    id: 'mail:nucleus',
    type: 'mailtab',
    workspaceId: 'nucleus',
    label: 'Mail'
  }]
  harness.context.renderView()
  const view = harness.document.getElementById('view')
  assert.ok(view.querySelector('[data-mail-app]'))
  assert.ok(view.querySelector('[data-mail-folder="inbox"]'))
})

test('renderView mounts synapse chat surface in synapse tab', () => {
  const harness = createHarness()
  harness.loadSynapseStack()
  harness.loadRendererCore()
  harness.context.synapseState = {
    conversations: [{ id: 'conv-1', title: 'Help', messages: [] }]
  }
  harness.context.state.top = 'workspace'
  harness.context.state.activeTabId = sampleSynapseTab().id
  harness.context.state.tabs = [sampleSynapseTab()]
  harness.context.renderView()
  const view = harness.document.getElementById('view')
  assert.ok(view.querySelector('.synapse-shell'))
  assert.ok(view.querySelector('[data-synapse-thread]'))
})

test('renderView shows calendar placeholder in calendar section', () => {
  const harness = createHarness()
  harness.loadRendererCore()
  harness.context.state.top = 'section'
  harness.context.state.activeSection = 'calendar'
  harness.context.renderView()
  const view = harness.document.getElementById('view')
  assert.match(view.textContent, /Coming soon/)
})

test('renderView calls syncMailWatchLifecycle after drawing mail tab', async () => {
  let lifecycleCalls = 0
  const harness = createHarness()
  harness.loadMailSuite()
  harness.context.syncMailWatchLifecycle = async () => {
    lifecycleCalls += 1
  }
  harness.context.state.top = 'workspace'
  harness.context.state.activeTabId = 'mail:nucleus'
  harness.context.state.tabs = [{
    id: 'mail:nucleus',
    type: 'mailtab',
    workspaceId: 'nucleus',
    label: 'Mail'
  }]
  harness.context.renderView()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(lifecycleCalls, 1)
})
