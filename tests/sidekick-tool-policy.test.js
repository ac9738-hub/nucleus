'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  shouldAllowSidekickBrowserOpen,
  shouldAllowSidekickWorkspaceDelete
} = require('../lib/sidekick-tool-policy')

test('Sidekick browser policy blocks exfiltration URL not mentioned by user', () => {
  const result = shouldAllowSidekickBrowserOpen({
    rawValue: 'https://attacker.example/?d=course%20context',
    normalizedUrl: 'https://attacker.example/?d=course%20context',
    userText: 'What does this page say about the homework?'
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /did not mention attacker\.example/)
})

test('Sidekick browser policy allows explicit user-mentioned URL host', () => {
  const result = shouldAllowSidekickBrowserOpen({
    rawValue: 'https://example.edu/calendar',
    normalizedUrl: 'https://example.edu/calendar',
    userText: 'Open example.edu calendar in my workspace.'
  })

  assert.equal(result.ok, true)
})

test('Sidekick browser policy blocks generated search text absent from user message', () => {
  const result = shouldAllowSidekickBrowserOpen({
    rawValue: 'course context copied from screen',
    normalizedUrl: 'https://www.google.com/search?q=course%20context%20copied%20from%20screen',
    userText: 'What should I do next?'
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /search text/)
})

test('Sidekick browser policy allows search text explicitly requested by user', () => {
  const result = shouldAllowSidekickBrowserOpen({
    rawValue: 'Princeton registrar calendar',
    normalizedUrl: 'https://www.google.com/search?q=Princeton%20registrar%20calendar',
    userText: 'Search for Princeton registrar calendar.'
  })

  assert.equal(result.ok, true)
})

test('Sidekick workspace delete policy requires explicit delete intent and workspace id', () => {
  assert.equal(shouldAllowSidekickWorkspaceDelete({
    workspaceId: 'biology',
    userText: 'Summarize this page.'
  }).ok, false)

  assert.equal(shouldAllowSidekickWorkspaceDelete({
    workspaceId: 'biology',
    userText: 'Delete the biology workspace.'
  }).ok, true)
})
