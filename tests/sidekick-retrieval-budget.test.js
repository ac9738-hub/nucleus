const test = require('node:test')
const assert = require('node:assert/strict')
const {
  SIDEKICK_RETRIEVAL_K,
  MAX_RETRIEVAL_STARTPOINTS,
  MAX_CHUNKS_PER_STARTPOINT,
  MAX_GROUNDING_CATALOG_CHUNKS,
  prepareRetrievalStartpoints,
  finalizeGroundingCatalog,
  buildGroundingPayload,
  buildSlimRetrievalToolResponse,
  mergeGroundingCatalogs
} = require('../sidekick-retrieval-budget')
const { pruneConfidentlyIrrelevantCatalog, formatLayeredGroundingContext } = require('../text-chunks')

test('prepareRetrievalStartpoints keeps more results and drops empty chunks only', () => {
  const startpoints = Array.from({ length: 8 }, (_, i) => ({
    type: 'file',
    name: `File ${i}`,
    chunks: Array.from({ length: 10 }, (__, j) => ({
      chunkId: `c${i}-${j}`,
      text: j === 0 ? '' : `chunk ${i}-${j}`
    }))
  }))
  const { startpoints: prepared, truncated } = prepareRetrievalStartpoints(startpoints)
  assert.equal(prepared.length, 8)
  assert.equal(prepared[0].chunks.length, MAX_CHUNKS_PER_STARTPOINT)
  assert.equal(prepared[0].chunks[0].text, 'chunk 0-1')
  assert.equal(truncated, false)
})

test('pruneConfidentlyIrrelevantCatalog drops other-course chunks without query overlap', () => {
  const catalog = [
    { citeLabel: 'R1', text: 'entropy lecture notes', source: { courseid: '100' } },
    { citeLabel: 'R2', text: 'unrelated poetry reading', source: { courseid: '200' } },
    { citeLabel: 'C1', text: 'visible screen text', source: { courseid: '100' } }
  ]
  const { catalog: pruned, prunedCount } = pruneConfidentlyIrrelevantCatalog(catalog, {
    query: 'entropy',
    focusCourseIds: ['100']
  })
  assert.equal(prunedCount, 1)
  assert.deepEqual(pruned.map(item => item.citeLabel), ['R1', 'C1'])
})

test('buildGroundingPayload orders cache layers course graph before rag', () => {
  const payload = buildGroundingPayload({
    startpoints: [{
      chunks: [{ chunkId: 'r1', text: 'Retrieved entropy passage', source: { courseid: '100' } }]
    }],
    screenSlice: null,
    courseGraphContext: 'Course graph: Chain rule definition'
  })
  assert.ok(payload.ragContext.includes('[R1]'))
  assert.ok(payload.courseGraphContext.includes('Chain rule'))
  assert.ok(payload.callContext.indexOf('Chain rule') < payload.callContext.indexOf('[R1]'))
})

test('buildSlimRetrievalToolResponse omits full chunk bodies', () => {
  const payload = buildGroundingPayload({
    startpoints: [{
      type: 'file',
      name: 'Syllabus',
      chunks: [{ chunkId: 'a', text: 'A'.repeat(5000), source: {} }]
    }],
    screenSlice: null
  })
  const slim = buildSlimRetrievalToolResponse({
    normalized: payload.normalized,
    catalog: payload.catalog,
    callContext: payload.callContext,
    truncated: payload.truncated
  })
  const json = JSON.stringify(slim)
  assert.ok(json.length < 20000)
  assert.ok(slim.groundingContext.includes('[R1]'))
  assert.equal(slim.summary[0].preview.length <= 160, true)
})

test('mergeGroundingCatalogs dedupes by chunkId', () => {
  const a = [{ citeLabel: 'R1', chunkId: 'same', text: 'one' }]
  const b = [{ citeLabel: 'R2', chunkId: 'same', text: 'dup' }, { citeLabel: 'R3', chunkId: 'other', text: 'two' }]
  const merged = mergeGroundingCatalogs(a, b)
  assert.equal(merged.length, 2)
})

test('formatLayeredGroundingContext separates rag and screen', () => {
  const layered = formatLayeredGroundingContext({
    courseGraphContext: 'Concept: limits',
    catalog: [
      { citeLabel: 'R1', text: 'Retrieved passage' },
      { citeLabel: 'C1', text: 'On screen text' }
    ]
  })
  assert.match(layered.ragContext, /\[R1\]/)
  assert.match(layered.screenContext, /\[C1\]/)
  assert.doesNotMatch(layered.ragContext, /\[C1\]/)
})

test('SIDEKICK_RETRIEVAL_K is below generous startpoint ceiling', () => {
  assert.ok(SIDEKICK_RETRIEVAL_K <= MAX_RETRIEVAL_STARTPOINTS)
  assert.ok(MAX_GROUNDING_CATALOG_CHUNKS >= 24)
})
