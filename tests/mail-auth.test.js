'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseOAuthCallbackUrl,
  getGmailRedirectUri,
  buildRawEmail
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

test('buildRawEmail rejects newline injection in headers', () => {
  assert.throws(() => buildRawEmail({
    from: 'me@example.com',
    to: 'friend@example.com',
    subject: 'Hello\r\nBcc: attacker@example.com',
    body: '<p>Hi</p>'
  }), /Subject header contains invalid newline/)
})

test('buildRawEmail still allows multiline message bodies', () => {
  const raw = buildRawEmail({
    from: 'me@example.com',
    to: 'friend@example.com',
    subject: 'Hello',
    body: '<p>Line 1</p>\r\n<p>Line 2</p>'
  })
  assert.match(raw, /Subject: Hello\r\nMIME-Version/)
  assert.match(raw, /\r\n\r\n<p>Line 1<\/p>\r\n<p>Line 2<\/p>$/)
})
