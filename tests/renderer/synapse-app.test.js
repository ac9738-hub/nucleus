const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')
const { sampleSynapseTab } = require('./fixtures')

test('renderSynapseApp renders chat surface in chat mode', () => {
  const harness = createHarness()
  harness.loadSynapseStack()
  const tab = sampleSynapseTab()
  const html = harness.window.nucleusSynapseApp.renderSynapseApp(tab, {
    conversations: [{ id: 'conv-1', title: 'Test chat', messages: [] }]
  })
  assert.match(html, /synapse-chat/)
  assert.match(html, /data-synapse-thread/)
  assert.match(html, /Message Synapse/)
})

test('renderSynapseSidebar lists conversations', () => {
  const harness = createHarness()
  harness.loadSynapseStack()
  const conversations = [
    { id: 'conv-1', title: 'Derivatives help', messages: [] },
    { id: 'conv-2', title: 'Essay outline', messages: [] }
  ]
  const html = harness.window.nucleusSynapseApp.renderSynapseSidebar(conversations, 'conv-1', false)
  assert.match(html, /Derivatives help/)
  assert.match(html, /Essay outline/)
})

test('renderSynapseLearnPage shows course picker when learn session is empty', () => {
  const harness = createHarness()
  harness.loadSynapseStack()
  const tab = { ...sampleSynapseTab(), synapseMode: 'learn', learnSession: { coursesLoadState: 'done', courses: [{ id: '101', name: 'Intro to Architecture' }] } }
  const html = harness.window.nucleusSynapseApp.renderSynapseLearnPage(tab, { conversations: [] })
  assert.match(html, /synapse-shell/)
  assert.match(html, /Intro to Architecture/)
})
