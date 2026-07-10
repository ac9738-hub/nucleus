'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseOAuthCallbackUrl,
  getGmailRedirectUri,
  createOAuthClient
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

test('createOAuthClient requires configured Gmail credentials', () => {
  assert.throws(
    () => createOAuthClient({ clientId: 'test-client', clientSecret: '' }),
    /Gmail OAuth is not configured/
  )

  assert.doesNotThrow(() => createOAuthClient({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:3000/callback'
  }))
})
