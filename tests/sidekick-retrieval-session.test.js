const test = require('node:test')
const assert = require('node:assert/strict')
const { RetrievalSessionStore } = require('../sidekick-retrieval-session')
const { buildGroundingPayload } = require('../sidekick-retrieval-budget')

function makePayload(chunkCount = 2) {
  const startpoints = Array.from({ length: chunkCount }, (_, i) => ({
    type: 'file',
    name: `Doc ${i}`,
    chunks: [{ chunkId: `c${i}`, text: `Passage ${i}`, source: { fileid: String(100 + i) } }]
  }))
  return buildGroundingPayload({ startpoints, screenSlice: null })
}

test('seedTurnZero creates prefetch slot with global R labels', () => {
  const session = new RetrievalSessionStore()
  const payload = makePayload(2)
  const slot = session.seedTurnZero({ query: 'syllabus', payload })
  assert.equal(slot.id, 'prefetch')
  assert.deepEqual(session.toSnapshot().activeSlots.map(s => s.id), ['prefetch'])
  const ctx = session.getCallContext()
  assert.match(ctx, /\[R1\]/)
  assert.match(ctx, /\[R2\]/)
})

test('addRetrieval appends slot and merges labels', () => {
  const session = new RetrievalSessionStore()
  session.seedTurnZero({ query: 'intro', payload: makePayload(1) })
  const slot = session.addRetrieval({
    query: 'midterm',
    payload: buildGroundingPayload({
      startpoints: [{
        chunks: [{ chunkId: 'm1', text: 'Midterm info', source: {} }]
      }],
      screenSlice: null
    }),
    keep: true
  })
  assert.equal(slot.id, 'ret-1')
  const snapshot = session.toSnapshot()
  assert.equal(snapshot.activeSlots.length, 2)
  assert.ok(snapshot.callContext.includes('[R2]'))
})

test('replace_slots removes stale slot before add', () => {
  const session = new RetrievalSessionStore()
  session.seedTurnZero({ query: 'old', payload: makePayload(1) })
  session.addRetrieval({
    query: 'new topic',
    payload: makePayload(1),
    replaceSlots: ['prefetch'],
    keep: true
  })
  const ids = session.toSnapshot().activeSlots.map(s => s.id)
  assert.ok(!ids.includes('prefetch'))
  assert.ok(ids.includes('ret-1'))
})

test('keep_slots allowlist drops unlisted slots', () => {
  const session = new RetrievalSessionStore()
  session.seedTurnZero({ query: 'keep me', payload: makePayload(1) })
  session.addRetrieval({
    query: 'drop me',
    payload: makePayload(1),
    keep: true
  })
  session.addRetrieval({
    query: 'replacement',
    payload: makePayload(1),
    keepSlots: ['prefetch'],
    keep: true
  })
  const ids = session.toSnapshot().activeSlots.map(s => s.id)
  assert.deepEqual(ids, ['prefetch', 'ret-2'])
})

test('buildSlotToolResponse is metadata-only', () => {
  const session = new RetrievalSessionStore()
  const slot = session.seedTurnZero({ query: 'q', payload: makePayload(1) })
  const slim = session.buildSlotToolResponse(slot)
  const json = JSON.stringify(slim)
  assert.ok(json.length < 4000)
  assert.equal(slim.slotId, 'prefetch')
  assert.equal('groundingContext' in slim, false)
  assert.equal('chunkText' in slim, false)
})

test('keep false uses ephemeral context without active slot', () => {
  const session = new RetrievalSessionStore()
  const slot = session.addRetrieval({
    query: 'one shot',
    payload: makePayload(1),
    keep: false
  })
  assert.equal(session.toSnapshot().activeSlots.length, 0)
  assert.ok(session.getCallContext().includes('[R1]'))
  assert.equal(slot.keep, false)
})

test('reset clears slots between turns', () => {
  const session = new RetrievalSessionStore()
  session.seedTurnZero({ query: 'q', payload: makePayload(1) })
  session.reset()
  assert.equal(session.toSnapshot().activeSlots.length, 0)
  assert.equal(session.getCallContext(), '')
})
