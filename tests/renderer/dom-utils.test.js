const test = require('node:test')
const assert = require('node:assert/strict')
const { escapeHtml } = require('../../lib/dom-utils')

test('escapeHtml neutralizes HTML metacharacters', () => {
  assert.equal(escapeHtml(null), '')
  assert.equal(escapeHtml('a & b'), 'a &amp; b')
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
  assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;')
  assert.equal(escapeHtml("'single'"), '&#39;single&#39;')
})

test('escapeHtml leaves safe plain text unchanged', () => {
  assert.equal(escapeHtml('Office hours on Tuesday'), 'Office hours on Tuesday')
})
