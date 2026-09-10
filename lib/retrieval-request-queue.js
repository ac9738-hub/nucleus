// Helpers for matching vector retrieval subprocess responses to callers.

function makeRetrievalRequestId(counter, now = Date.now()) {
  return `vr-${now}-${counter}`
}

function normalizeRequestId(value) {
  return String(value || '').trim()
}

function takePendingQueryForResult(pendingQueries, result = {}) {
  if (!Array.isArray(pendingQueries) || !pendingQueries.length) return null

  const requestId = normalizeRequestId(result.requestId || result.request_id)
  let index = -1
  if (requestId) {
    index = pendingQueries.findIndex(item => normalizeRequestId(item && item.requestId) === requestId)
    if (index === -1) return null
  } else {
    index = 0
  }

  const [pending] = pendingQueries.splice(index, 1)
  return pending || null
}

module.exports = {
  makeRetrievalRequestId,
  takePendingQueryForResult
}
