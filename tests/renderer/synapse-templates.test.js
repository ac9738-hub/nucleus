const test = require('node:test')
const assert = require('node:assert/strict')
const { escapeHtml } = require('../../lib/dom-utils')

global.escapeHtml = escapeHtml
const templates = require('../../app/synapse/chat')

test('formatContent escapes HTML and preserves fenced code blocks', () => {
  const html = templates.formatContent('Hello `<b>` world\n```js\nalert(1)\n```')
  assert.match(html, /Hello/)
  assert.match(html, /synapse-inline-code/)
  assert.match(html, /synapse-code/)
  assert.doesNotMatch(html, /<b>/)
  assert.match(html, /alert\(1\)/)
})

test('renderMessage ignores invalid roles', () => {
  assert.equal(templates.renderMessage({ role: 'system', content: 'nope' }), '')
})

test('renderMessage escapes user content', () => {
  const html = templates.renderMessage({
    role: 'user',
    content: '<script>alert(1)</script>',
    createdAt: '2026-06-21T18:30:00.000Z'
  })
  assert.match(html, /synapse-msg-user/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('renderMessages shows empty state for new conversations', () => {
  const html = templates.renderMessages([])
  assert.match(html, /New conversation/)
  assert.match(html, /synapse-thread-empty/)
})

test('createChatHtmlTemplate includes composer controls', () => {
  const html = templates.createChatHtmlTemplate({ conversationId: 'conv-1', model: templates.DEFAULT_MODEL })
  assert.match(html, /data-synapse-input/)
  assert.match(html, /data-synapse-send/)
  assert.match(html, /Message Synapse/)
})
