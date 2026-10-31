const test = require('node:test')
const assert = require('node:assert/strict')
const {
  makeRetrievalRequestId,
  takePendingQueryForResult
} = require('../lib/retrieval-request-queue')

test('takePendingQueryForResult ignores late timed-out responses with request ids', () => {
  const pending = [
    { requestId: 'req-b', query: 'second query' }
  ]

  assert.equal(takePendingQueryForResult(pending, { requestId: 'req-a', startpoints: [] }), null)
  assert.deepEqual(pending.map(item => item.requestId), ['req-b'])

  const matched = takePendingQueryForResult(pending, { requestId: 'req-b', startpoints: [] })
  assert.equal(matched.query, 'second query')
  assert.equal(pending.length, 0)
})

test('takePendingQueryForResult preserves FIFO fallback for untagged responses', () => {
  const pending = [
    { requestId: 'req-a', query: 'first query' },
    { requestId: 'req-b', query: 'second query' }
  ]

  const matched = takePendingQueryForResult(pending, { startpoints: [] })
  assert.equal(matched.query, 'first query')
  assert.deepEqual(pending.map(item => item.requestId), ['req-b'])
})

test('makeRetrievalRequestId includes monotonic counter', () => {
  assert.equal(makeRetrievalRequestId(7, 12345), 'vr-12345-7')
})
