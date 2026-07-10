const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeBrowserUrl } = require('../tab-utils')

test('normalizeBrowserUrl preserves web and engine schemes', () => {
  assert.equal(normalizeBrowserUrl('example.com'), 'https://example.com')
  assert.equal(normalizeBrowserUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(normalizeBrowserUrl('nucleus://canvas/course/1'), 'nucleus://canvas/course/1')
  assert.equal(normalizeBrowserUrl('about:blank'), 'about:blank')
})

test('normalizeBrowserUrl turns executable or local schemes into searches', () => {
  assert.equal(
    normalizeBrowserUrl('javascript:alert(1)'),
    'https://www.google.com/search?q=javascript%3Aalert(1)'
  )
  assert.equal(
    normalizeBrowserUrl('data:text/html,<script>alert(1)</script>'),
    'https://www.google.com/search?q=data%3Atext%2Fhtml%2C%3Cscript%3Ealert(1)%3C%2Fscript%3E'
  )
  assert.equal(
    normalizeBrowserUrl('file:///etc/passwd'),
    'https://www.google.com/search?q=file%3A%2F%2F%2Fetc%2Fpasswd'
  )
})
