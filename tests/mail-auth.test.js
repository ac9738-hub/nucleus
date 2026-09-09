'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseOAuthCallbackUrl,
  getGmailRedirectUri,
  getmailmeta,
  __test
} = require('../app/mail/api')

test('parseOAuthCallbackUrl extracts authorization code', () => {
  const redirectUri = getGmailRedirectUri()
  const parsed = parseOAuthCallbackUrl(`${redirectUri}?code=abc123&scope=mail`, redirectUri)
  assert.equal(parsed.code, 'abc123')
})

test('parseOAuthCallbackUrl surfaces Google OAuth errors', () => {
  const redirectUri = getGmailRedirectUri()
  const parsed = parseOAuthCallbackUrl(
    `${redirectUri}?error=access_denied&error_description=User%20denied%20access`,
    redirectUri
  )
  assert.equal(parsed.error, 'User denied access')
})

test('parseOAuthCallbackUrl rejects unexpected redirect hosts', () => {
  const parsed = parseOAuthCallbackUrl('http://evil.example/callback?code=abc', getGmailRedirectUri())
  assert.match(parsed.error, /Unexpected Gmail OAuth redirect URL/)
})

function gmailJsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  }
}

function gmailTextResponse(status, body, contentType = 'application/json') {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
    headers: {
      get: name => String(name).toLowerCase() === 'content-type' ? contentType : ''
    }
  }
}

test('gmail metadata retries do not deadlock the global request limiter', async () => {
  const originalFetch = global.fetch
  const seenByPath = new Map()

  __test.resetGmailLimiterForTests()
  __test.setMailAuthTokens({ access_token: 'test-token' })
  global.fetch = async url => {
    const pathname = String(url).replace(/^https:\/\/www\.googleapis\.com\/gmail\/v1\/users\/me/, '')
    const seen = seenByPath.get(pathname) || 0
    seenByPath.set(pathname, seen + 1)
    if (seen === 0) {
      return gmailJsonResponse(429, { error: { message: 'rate limit' } })
    }
    return gmailJsonResponse(200, { id: pathname.match(/messages\/([^?]+)/)[1], payload: { headers: [] } })
  }

  try {
    const ids = Array.from({ length: 6 }, (_, index) => `msg-${index + 1}`)
    const results = await Promise.race([
      Promise.all(ids.map(id => getmailmeta(id))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Gmail retry limiter deadlocked')), 3000))
    ])

    assert.deepEqual(results.map(message => message.id).sort(), ids)
    assert.equal([...seenByPath.values()].every(count => count === 2), true)
  } finally {
    global.fetch = originalFetch
    __test.setMailAuthTokens(null)
    __test.resetGmailLimiterForTests()
  }
})

test('gmail batch metadata retries do not deadlock the global request limiter', async () => {
  const originalFetch = global.fetch
  const seenById = new Map()
  const boundary = 'test-batch-response'

  __test.resetGmailLimiterForTests()
  __test.setMailAuthTokens({ access_token: 'test-token' })
  global.fetch = async (_url, options = {}) => {
    const id = String(options.body || '').match(/messages\/([^?]+)\?/)
    assert.ok(id, 'expected Gmail batch body to include a message id')
    const messageId = id[1]
    const seen = seenById.get(messageId) || 0
    seenById.set(messageId, seen + 1)
    if (seen === 0) {
      return gmailTextResponse(503, JSON.stringify({ error: { message: 'rate limit' } }))
    }
    const part = [
      `--${boundary}`,
      'Content-Type: application/http',
      '',
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      JSON.stringify({ id: messageId, payload: { headers: [] } }),
      `--${boundary}--`,
      ''
    ].join('\r\n')
    return gmailTextResponse(200, part, `multipart/mixed; boundary=${boundary}`)
  }

  try {
    const ids = Array.from({ length: 6 }, (_, index) => `batch-${index + 1}`)
    const results = await Promise.race([
      Promise.all(ids.map(id => __test.gmailBatchGetMessages([id]))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Gmail batch retry limiter deadlocked')), 3000))
    ])

    assert.deepEqual(results.flat().map(message => message.id).sort(), ids)
    assert.equal([...seenById.values()].every(count => count === 2), true)
  } finally {
    global.fetch = originalFetch
    __test.setMailAuthTokens(null)
    __test.resetGmailLimiterForTests()
  }
})
