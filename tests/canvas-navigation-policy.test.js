'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  hostMatchesAllowedCanvasHost,
  normalizeAllowedCanvasNavigationUrl
} = require('../lib/canvas-navigation-policy')

test('Canvas tab policy allows configured Canvas host and subdomains', () => {
  const allowedHosts = ['princeton.instructure.com']

  assert.equal(
    normalizeAllowedCanvasNavigationUrl('https://princeton.instructure.com/courses/100/pages/week-1', { allowedHosts }),
    'https://princeton.instructure.com/courses/100/pages/week-1'
  )
  assert.equal(
    normalizeAllowedCanvasNavigationUrl('/courses/100/assignments/20', {
      baseUrl: 'https://princeton.instructure.com',
      allowedHosts
    }),
    'https://princeton.instructure.com/courses/100/assignments/20'
  )
  assert.equal(hostMatchesAllowedCanvasHost('files.princeton.instructure.com', allowedHosts), true)
})

test('Canvas tab policy rejects attacker hosts and Canvas documentation hosts', () => {
  const allowedHosts = ['princeton.instructure.com']

  assert.equal(
    normalizeAllowedCanvasNavigationUrl('https://evil-canvas.example/courses/100/pages/login', { allowedHosts }),
    ''
  )
  assert.equal(
    normalizeAllowedCanvasNavigationUrl('https://princeton.instructure.com.evil.example/courses/100', { allowedHosts }),
    ''
  )
  assert.equal(
    normalizeAllowedCanvasNavigationUrl('https://canvas.instructure.com/doc/api/file.html', { allowedHosts }),
    ''
  )
})

test('Canvas tab policy rejects non-web URLs and default-denies without configured hosts', () => {
  assert.equal(
    normalizeAllowedCanvasNavigationUrl('javascript:alert(1)', { allowedHosts: ['princeton.instructure.com'] }),
    ''
  )
  assert.equal(
    normalizeAllowedCanvasNavigationUrl('https://princeton.instructure.com/courses/100'),
    ''
  )
})
