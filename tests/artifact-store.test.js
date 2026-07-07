const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createArtifactStore } = require('../artifact-store')
const { createAgentArtifacts } = require('../agent-artifacts')
const { generateTableArtifact, generateChartArtifact } = require('../artifact-generators')

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-artifacts-'))
}

test('artifact store creates and lists artifacts', () => {
  const rootDir = tempRoot()
  const store = createArtifactStore({ rootDir })
  const record = store.upsertArtifact({
    title: 'Midterm Review',
    type: 'table',
    workspaceId: 'biology',
    previewPath: 'files/art_test/preview.html',
    downloadPath: 'files/art_test/review.html',
    mimeType: 'text/html'
  })
  assert.equal(record.title, 'Midterm Review')
  const listed = store.listArtifacts({ workspaceId: 'biology' })
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, record.id)
})

test('agent artifacts builds table artifact files', () => {
  const rootDir = tempRoot()
  const store = createArtifactStore({ rootDir })
  const artifacts = createAgentArtifacts({ store, repoRoot: path.join(__dirname, '..') })
  const record = artifacts.buildArtifactRecord({
    title: 'Grade Tracker',
    type: 'table',
    content: {
      headers: ['Assignment', 'Score'],
      rows: [['Quiz 1', '92'], ['Quiz 2', '88']]
    }
  })
  const previewAbs = store.resolveArtifactPath(record.previewPath)
  const downloadAbs = store.resolveArtifactPath(record.downloadPath)
  assert.ok(fs.existsSync(previewAbs))
  assert.ok(fs.existsSync(downloadAbs))
  const html = fs.readFileSync(previewAbs, 'utf8')
  assert.match(html, /Grade Tracker/)
  assert.match(html, /Quiz 1/)
})

test('chart generator emits svg preview', () => {
  const generated = generateChartArtifact({
    title: 'Scores',
    chart_type: 'bar',
    labels: ['A', 'B'],
    datasets: [{ label: 'Set 1', values: [3, 7] }]
  })
  assert.match(generated.previewHtml, /<svg/)
  assert.match(generated.previewHtml, /Scores/)
})

test('table generator escapes html', () => {
  const generated = generateTableArtifact({
    title: 'Notes <unsafe>',
    headers: ['Item'],
    rows: [['<script>']]
  })
  assert.match(generated.previewHtml, /Notes &lt;unsafe&gt;/)
  assert.doesNotMatch(generated.previewHtml, /<script>/)
})
