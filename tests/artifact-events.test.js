const test = require('node:test')
const assert = require('node:assert/strict')
const {
  artifactBroadcastPayload,
  shouldHandleArtifactInLumi
} = require('../lib/artifact-events')

test('artifact broadcast payload tags source', () => {
  const payload = artifactBroadcastPayload({ id: 'art_1', title: 'Notes' }, 'synapse')
  assert.equal(payload.source, 'synapse')
  assert.equal(payload.artifact.id, 'art_1')
})

test('lumi ignores synapse-sourced artifact events', () => {
  assert.equal(shouldHandleArtifactInLumi({ source: 'synapse', artifact: { id: 'a' } }), false)
  assert.equal(shouldHandleArtifactInLumi({ source: 'lumi', artifact: { id: 'a' } }), true)
  assert.equal(shouldHandleArtifactInLumi({ artifact: { id: 'a' } }), true)
})
