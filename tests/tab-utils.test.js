const test = require('node:test')
const assert = require('node:assert/strict')

const { normalizeBrowserUrl } = require('../tab-utils')

test('normalizeBrowserUrl preserves safe browser and app schemes', () => {
  assert.equal(normalizeBrowserUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(normalizeBrowserUrl('http://example.com/path'), 'http://example.com/path')
  assert.equal(normalizeBrowserUrl('nucleus://search?q=canvas'), 'nucleus://search?q=canvas')
  assert.equal(normalizeBrowserUrl('about:blank'), 'about:blank')
})

test('normalizeBrowserUrl converts unsupported schemes into search queries', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/file.txt'
  ]) {
    const normalized = normalizeBrowserUrl(value)
    assert.match(normalized, /^https:\/\/www\.google\.com\/search\?q=/)
    assert.notEqual(normalized, value)
  }
})
