const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')
const { escapeHtml } = require('../../lib/dom-utils')

global.escapeHtml = escapeHtml
const artifactTabs = require('../../renderer/artifact-tabs')

test('artifactTabId encodes workspace and artifact ids', () => {
  assert.equal(artifactTabs.artifactTabId('flash-1', 'nucleus'), 'artifact:nucleus:flash-1')
})

test('renderArtifactTabView escapes title and exposes action buttons', () => {
  const html = artifactTabs.renderArtifactTabView({
    label: '<script>bad</script>',
    artifactType: 'html',
    artifactId: 'a1'
  })
  assert.doesNotMatch(html, /<script>bad/)
  assert.match(html, /data-artifact-download/)
  assert.match(html, /data-artifact-preview/)
})

test('findArtifactTab locates existing artifact tab in renderer state', () => {
  const harness = createHarness()
  harness.loadRendererCore()
  harness.context.state.tabs.push({
    id: 'artifact:nucleus:a1',
    type: 'artifacttab',
    workspaceId: 'nucleus',
    artifactId: 'a1',
    label: 'Flashcards'
  })
  const tab = harness.context.findArtifactTab('a1', 'nucleus')
  assert.ok(tab)
  assert.equal(tab.label, 'Flashcards')
})

test('renderArtifactTabIcon returns inline svg markup', () => {
  const html = artifactTabs.renderArtifactTabIcon()
  assert.match(html, /workspace-page-tab-icon-artifact/)
  assert.match(html, /<svg/)
})
