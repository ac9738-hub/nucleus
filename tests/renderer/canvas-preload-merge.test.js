'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { mergePreloadUrls } = require('../../lib/canvas-preload-merge')

test('mergePreloadUrls prefers explicit urls before planner candidates', () => {
  const urls = mergePreloadUrls(
    [{ url: 'https://canvas.example/courses/100/assignments/2' }],
    ['https://canvas.example/courses/100/assignments/1'],
    { limit: 2 }
  )
  assert.deepEqual(urls, [
    'https://canvas.example/courses/100/assignments/1',
    'https://canvas.example/courses/100/assignments/2'
  ])
})

test('mergePreloadUrls skips active url and dedupes', () => {
  const urls = mergePreloadUrls(
    [{ url: 'https://canvas.example/courses/100' }],
    ['https://canvas.example/courses/100', 'https://canvas.example/courses/100/files/1'],
    {
      limit: 3,
      activeUrl: 'https://canvas.example/courses/100'
    }
  )
  assert.deepEqual(urls, ['https://canvas.example/courses/100/files/1'])
})

test('mergePreloadUrls can prefer planner candidates before dom extras', () => {
  const urls = mergePreloadUrls(
    [
      { url: 'https://canvas.example/courses/100/assignments/1' },
      { url: 'https://canvas.example/courses/100/assignments/2' }
    ],
    ['https://canvas.example/courses/100/files/9'],
    { limit: 2, order: 'candidates-first' }
  )
  assert.deepEqual(urls, [
    'https://canvas.example/courses/100/assignments/1',
    'https://canvas.example/courses/100/assignments/2'
  ])
})
