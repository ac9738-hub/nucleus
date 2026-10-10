'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseOAuthCallbackUrl,
  getGmailRedirectUri,
  isAllowedGmailOAuthNavigation
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

test('isAllowedGmailOAuthNavigation permits Google account pages and redirect callback', () => {
  const redirectUri = getGmailRedirectUri()

  assert.equal(
    isAllowedGmailOAuthNavigation('https://accounts.google.com/o/oauth2/v2/auth?client_id=abc', redirectUri),
    true
  )
  assert.equal(
    isAllowedGmailOAuthNavigation('https://myaccount.google.com/permissions', redirectUri),
    true
  )
  assert.equal(
    isAllowedGmailOAuthNavigation(`${redirectUri}?code=abc123`, redirectUri),
    true
  )
})

test('isAllowedGmailOAuthNavigation blocks untrusted auth-window destinations', () => {
  const redirectUri = getGmailRedirectUri()

  assert.equal(isAllowedGmailOAuthNavigation('https://evil.example/google-login', redirectUri), false)
  assert.equal(isAllowedGmailOAuthNavigation('javascript:alert(1)', redirectUri), false)
  assert.equal(isAllowedGmailOAuthNavigation('http://accounts.google.com/o/oauth2/v2/auth', redirectUri), false)
  assert.equal(isAllowedGmailOAuthNavigation('https://accounts.google.com.evil.example/', redirectUri), false)
})
