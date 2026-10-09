'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, after, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-mail-auth-test-'))
process.env.NUCLEUS_MAIL_AUTH_PATH = path.join(tempRoot, 'mail_auth.json')
process.env.NUCLEUS_MAIL_CACHE_ROOT = path.join(tempRoot, 'mail-cache')

const {
  parseOAuthCallbackUrl,
  getGmailRedirectUri,
  get_token,
  deleteMailMessage,
  trashMailMessage,
  __test
} = require('../app/mail/api')
const {
  getCachedMessageDetail,
  setCachedMessageDetail,
  getCachedThread,
  setCachedThread
} = require('../app/mail/cache')

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  __test.clearSavedMailAuth()
})

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

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

test('setMailAuthTokens preserves refresh-token-only credentials for silent recovery', () => {
  const ok = __test.setMailAuthTokens({ refresh_token: 'refresh-token-only' })
  assert.equal(ok, true)
  assert.equal(get_token(), null)
  assert.equal(__test.getOAuthCredentials().refresh_token, 'refresh-token-only')
})

test('clearSavedMailAuth removes cached message and thread bodies', () => {
  __test.saveMailAuth({ access_token: 'access-token', refresh_token: 'refresh-token' })
  setCachedMessageDetail('msg-1', { id: 'msg-1', threadId: 'thread-1', bodyHtml: '<b>private</b>' })
  setCachedThread('thread-1', { id: 'thread-1', messages: [{ id: 'msg-1', bodyText: 'private' }] })

  assert.ok(fs.existsSync(process.env.NUCLEUS_MAIL_AUTH_PATH))
  assert.ok(getCachedMessageDetail('msg-1'))
  assert.ok(getCachedThread('thread-1'))

  __test.clearSavedMailAuth()

  assert.equal(fs.existsSync(process.env.NUCLEUS_MAIL_AUTH_PATH), false)
  assert.equal(getCachedMessageDetail('msg-1'), null)
  assert.equal(getCachedThread('thread-1'), null)
})

test('deleteMailMessage invalidates cached message and thread bodies after Gmail confirms deletion', async () => {
  __test.setMailAuthTokens({ access_token: 'access-token', refresh_token: 'refresh-token' })
  setCachedMessageDetail('msg-delete', { id: 'msg-delete', threadId: 'thread-delete', bodyText: 'private' })
  setCachedThread('thread-delete', { id: 'thread-delete', messages: [{ id: 'msg-delete', bodyText: 'private' }] })
  global.fetch = async (url, options) => {
    assert.match(String(url), /\/messages\/msg-delete$/)
    assert.equal(options.method, 'DELETE')
    return { status: 204, ok: true }
  }

  await deleteMailMessage('msg-delete')

  assert.equal(getCachedMessageDetail('msg-delete'), null)
  assert.equal(getCachedThread('thread-delete'), null)
})

test('trashMailMessage invalidates cached message and thread bodies after Gmail confirms trash', async () => {
  __test.setMailAuthTokens({ access_token: 'access-token', refresh_token: 'refresh-token' })
  setCachedMessageDetail('msg-trash', { id: 'msg-trash', threadId: 'thread-trash', bodyHtml: '<p>private</p>' })
  setCachedThread('thread-trash', { id: 'thread-trash', messages: [{ id: 'msg-trash', bodyHtml: '<p>private</p>' }] })
  global.fetch = async (url, options) => {
    assert.match(String(url), /\/messages\/msg-trash\/trash$/)
    assert.equal(options.method, 'POST')
    return {
      status: 200,
      ok: true,
      json: async () => ({
        id: 'msg-trash',
        threadId: 'thread-trash',
        labelIds: ['TRASH'],
        payload: { headers: [] }
      })
    }
  }

  await trashMailMessage('msg-trash')

  assert.equal(getCachedMessageDetail('msg-trash'), null)
  assert.equal(getCachedThread('thread-trash'), null)
})
