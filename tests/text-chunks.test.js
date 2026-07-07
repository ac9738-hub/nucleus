const test = require('node:test')
const assert = require('node:assert/strict')
const {
  chunkFromScreenBlocks,
  chunkFromPageBlocks,
  formatChunksForGrounding,
  parseCiteLabels,
  resolveCitations,
  chunkIdsUnique
} = require('../text-chunks')

const FIXTURE_PAGES = [
  {
    pageNumber: 1,
    pageid: 'f1:page:1',
    blocks: [
      { text: 'Top of page one', y0: 0, y1: 40, yRatio0: 0.0, yRatio1: 0.1 },
      { text: 'Middle of page one', y0: 400, y1: 440, yRatio0: 0.4, yRatio1: 0.5 }
    ]
  }
]

test('chunkFromPageBlocks assigns stable cite labels', () => {
  const chunks = chunkFromPageBlocks(FIXTURE_PAGES, { courseid: '100', fileid: 'f1' })
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].citeLabel, 'C1')
  assert.ok(chunkIdsUnique(chunks))
  assert.match(chunks[0].chunkId, /^file:100\/f1\/p1\/b0$/)
})

test('chunkFromScreenBlocks wraps visible blocks', () => {
  const blocks = [{ tag: 'p', text: 'Visible paragraph', y: 10 }]
  const chunks = chunkFromScreenBlocks(blocks, { surfaceKind: 'mail', url: 'nucleus:mail' })
  assert.equal(chunks[0].citeLabel, 'C1')
  assert.equal(chunks[0].source.surfaceKind, 'mail')
})

test('formatChunksForGrounding and resolveCitations roundtrip', () => {
  const chunks = chunkFromScreenBlocks([
    { tag: 'p', text: 'First chunk' },
    { tag: 'p', text: 'Second chunk' }
  ], { surfaceKind: 'web' })
  const prompt = formatChunksForGrounding(chunks)
  assert.match(prompt, /\[C1\]/)
  const answer = 'The first chunk says it [C1].'
  assert.deepEqual(parseCiteLabels(answer), ['C1'])
  assert.equal(resolveCitations(answer, chunks).length, 1)
})

test('buildGroundingCatalog assigns global sequential R labels', () => {
  const { buildGroundingCatalog, normalizeRetrievalStartpoints } = require('../text-chunks')
  const normalized = normalizeRetrievalStartpoints([
    { chunks: [{ chunkId: 'a', text: 'First', source: {} }] },
    { chunks: [{ chunkId: 'b', text: 'Second', source: {} }] }
  ])
  const catalog = buildGroundingCatalog({
    screenChunks: [{ citeLabel: 'C1', chunkId: 's1', text: 'Screen', source: {} }],
    retrievalStartpoints: normalized
  })
  const labels = catalog.map(item => item.citeLabel)
  assert.deepEqual(labels, ['C1', 'R1', 'R2'])
})

test('resolveAllCitations merges C and R labels from catalog', () => {
  const { buildGroundingCatalog, resolveAllCitations } = require('../text-chunks')
  const catalog = buildGroundingCatalog({
    screenChunks: [{ citeLabel: 'C1', chunkId: 's1', text: 'On screen fact', source: {}, edges: [] }],
    retrievalStartpoints: [{
      chunks: [{ chunkId: 'r1', text: 'Retrieved policy', source: { fileid: '1001' }, edges: [] }]
    }]
  })
  const answer = 'Visible [C1] and policy [R1].'
  const citations = resolveAllCitations(answer, catalog)
  assert.equal(citations.length, 2)
  assert.equal(citations[0].citeLabel, 'C1')
  assert.equal(citations[1].citeLabel, 'R1')
  assert.equal(citations[1].fileid, '1001')
})

test('formatRetrievalChunksForGrounding uses R labels', () => {
  const { formatRetrievalChunksForGrounding, parseRetrievalCiteLabels } = require('../text-chunks')
  const prompt = formatRetrievalChunksForGrounding([
    { chunkId: 'a', text: 'Grading policy excerpt', edges: [] }
  ])
  assert.match(prompt, /\[R1\]/)
  assert.deepEqual(parseRetrievalCiteLabels('See [R1] for policy.'), ['R1'])
})
