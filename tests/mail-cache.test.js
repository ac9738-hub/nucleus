'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  setCachedMessageDetail,
  getCachedMessageDetail,
  setCachedThread,
  getCachedThread,
  evictCachedMessage
} = require('../app/mail/cache')

function uniqueId(prefix) {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

test('evictCachedMessage removes deleted message detail and containing thread cache', () => {
  const messageId = uniqueId('message')
  const threadId = uniqueId('thread')

  setCachedMessageDetail(messageId, {
    id: messageId,
    threadId,
    subject: 'Sensitive message',
    bodyHtml: '<p>private body</p>'
  })
  setCachedThread(threadId, {
    id: threadId,
    messages: [
      { id: messageId, threadId, bodyText: 'private body' },
      { id: uniqueId('sibling'), threadId, bodyText: 'other body' }
    ]
  })

  assert.equal(getCachedMessageDetail(messageId).bodyHtml, '<p>private body</p>')
  assert.equal(getCachedThread(threadId).messages.length, 2)

  evictCachedMessage(messageId)

  assert.equal(getCachedMessageDetail(messageId), null)
  assert.equal(getCachedThread(threadId), null)
})

test('evictCachedMessage scans thread caches when no message detail is cached', () => {
  const messageId = uniqueId('thread-only-message')
  const threadId = uniqueId('thread-only-thread')

  setCachedThread(threadId, {
    id: threadId,
    messages: [
      { id: messageId, threadId, bodyText: 'thread-only private body' }
    ]
  })

  assert.equal(getCachedThread(threadId).messages[0].bodyText, 'thread-only private body')

  evictCachedMessage(messageId)

  assert.equal(getCachedThread(threadId), null)
})
