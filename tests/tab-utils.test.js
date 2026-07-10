const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeBrowserUrl } = require('../tab-utils')

test('normalizeBrowserUrl keeps safe browser targets', () => {
  assert.equal(normalizeBrowserUrl('example.com'), 'https://example.com')
  assert.equal(normalizeBrowserUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(normalizeBrowserUrl('http://example.com/path'), 'http://example.com/path')
  assert.equal(normalizeBrowserUrl('nucleus://search?q=canvas'), 'nucleus://search?q=canvas')
  assert.equal(normalizeBrowserUrl('about:blank'), 'about:blank')
})

test('normalizeBrowserUrl converts executable or local schemes into search queries', () => {
  assert.equal(
    normalizeBrowserUrl('javascript:alert(document.domain)'),
    'https://www.google.com/search?q=javascript%3Aalert(document.domain)'
  )
  assert.equal(
    normalizeBrowserUrl('file:///etc/passwd'),
    'https://www.google.com/search?q=file%3A%2F%2F%2Fetc%2Fpasswd'
  )
  assert.equal(
    normalizeBrowserUrl('data:text/html,<script>alert(1)</script>'),
    'https://www.google.com/search?q=data%3Atext%2Fhtml%2C%3Cscript%3Ealert(1)%3C%2Fscript%3E'
  )
  assert.equal(
    normalizeBrowserUrl('about:srcdoc'),
    'https://www.google.com/search?q=about%3Asrcdoc'
  )
})
