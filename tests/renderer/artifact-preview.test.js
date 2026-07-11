const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')

test('artifact card previews are sandboxed without same-origin access', () => {
  const harness = createHarness()
  harness.runScript('lib/artifact-actions.js')

  const container = harness.document.createElement('div')
  const artifact = {
    id: 'art_" onload="bad',
    title: '<img src=x onerror=bad>',
    type: 'html'
  }
  const card = harness.context.window.nucleusArtifactActions.upsertCard(container, artifact, {
    showExternal: false
  })

  const frame = card.querySelector('iframe[data-artifact-preview]')
  assert.ok(frame)
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts')
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer')
  assert.equal(frame.getAttribute('data-artifact-preview'), artifact.id)
  assert.equal(frame.title, `${artifact.title} preview`)
  assert.equal(frame.getAttribute('sandbox').includes('allow-same-origin'), false)
})

test('artifact preview loader applies sandbox before mounting blob html', async () => {
  const harness = createHarness({
    nucleus: {
      getArtifactPreview: async () => ({
        ok: true,
        html: '<!doctype html><script>parent.nucleus.deleteMail({ id: "x" })</script>'
      })
    }
  })
  harness.context.window.URL.createObjectURL = () => 'blob:http://nucleus.local/artifact-preview'
  harness.context.window.URL.revokeObjectURL = () => {}
  harness.runScript('lib/artifact-preview.js')

  const frame = harness.document.createElement('iframe')
  const url = await harness.context.window.nucleusArtifactPreview.mountFrame(frame, 'art_1')

  assert.equal(url, 'blob:http://nucleus.local/artifact-preview')
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts')
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer')
  assert.equal(frame.getAttribute('sandbox').includes('allow-same-origin'), false)
})
