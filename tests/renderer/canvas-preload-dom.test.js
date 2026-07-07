'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isCanvasChromeUrl,
  isCanvasPreloadableUrl,
  isCanvasDownloadUrl,
  canvasPreloadUrlKey,
  canvasPreloadUrlsMatch,
  canonicalCanvasPreloadUrl,
  buildExtractVisibleCanvasLinksScript,
  CANVAS_HIDDEN_LINK_ANCESTOR_SELECTORS
} = require('../../lib/canvas-preload-dom')

test('isCanvasChromeUrl rejects course shell and section index pages', () => {
  assert.equal(isCanvasChromeUrl('https://canvas.example/courses/100'), true)
  assert.equal(isCanvasChromeUrl('https://canvas.example/courses/100/'), true)
  assert.equal(isCanvasChromeUrl('https://canvas.example/courses/100/modules'), true)
  assert.equal(isCanvasChromeUrl('https://canvas.example/courses/100/assignments'), true)
  assert.equal(isCanvasChromeUrl('https://canvas.example/courses/100/grades'), true)
})

test('isCanvasPreloadableUrl rejects downloads but keeps submissions and wrap previews', () => {
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.example/courses/100/assignments/20/submissions/70811'),
    true
  )
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.example/courses/100/assignments/20/submissions/70811?download=3219652'),
    false
  )
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.example/courses/100/files/50?wrap=1'),
    true
  )
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.example/courses/100/files/50/download?download_frd=1'),
    false
  )
  assert.equal(
    isCanvasDownloadUrl('https://canvas.example/courses/100/files/50/download'),
    true
  )
})

test('canvasPreloadUrlsMatch equates file wrap, preview, and canonical file paths', () => {
  assert.equal(
    canvasPreloadUrlsMatch(
      'https://canvas.example/courses/100/files/50?wrap=1',
      'https://canvas.example/courses/100/files/50'
    ),
    true
  )
  assert.equal(
    canvasPreloadUrlsMatch(
      'https://canvas.example/courses/100/files?preview=50',
      'https://canvas.example/courses/100/files/50'
    ),
    true
  )
  assert.equal(
    canonicalCanvasPreloadUrl('https://canvas.example/courses/100/files/50?wrap=1'),
    'https://canvas.example/courses/100/files/50'
  )
})

test('isCanvasPreloadableUrl keeps content deep links', () => {
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.example/courses/100/assignments/20'),
    true
  )
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.example/courses/100/modules/items/55'),
    true
  )
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.example/courses/100/pages/week-3'),
    true
  )
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.example/courses/100/files/50'),
    true
  )
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.example/courses/100'),
    false
  )
})

test('canvasPreloadUrlKey normalizes submission pages without download params', () => {
  assert.equal(
    canvasPreloadUrlKey('https://canvas.example/courses/100/assignments/20/submissions/70811'),
    '/courses/100/assignments/20/submissions/70811'
  )
})

test('isCanvasPreloadableUrl rejects external Canvas community links', () => {
  assert.equal(
    isCanvasPreloadableUrl('https://community.canvaslms.com/t5/Canvas-Basics-Guide/How-do-I-allow-pop-ups-for-Canvas-in-my-browser/ta-p/33'),
    false
  )
  assert.equal(
    isCanvasPreloadableUrl('https://canvas.instructure.com/doc/api/file.html'),
    false
  )
})

test('isCanvasPreloadableUrl rejects pages index and front_page', () => {
  assert.equal(isCanvasPreloadableUrl('https://canvas.example/courses/100/pages'), false)
  assert.equal(isCanvasPreloadableUrl('https://canvas.example/courses/100/pages/front_page'), false)
})

test('isCanvasPreloadableUrl respects allowed institution hosts', () => {
  const url = 'https://princeton.instructure.com/courses/100/assignments/20'
  assert.equal(isCanvasPreloadableUrl(url, { allowedHosts: ['princeton.instructure.com'] }), true)
  assert.equal(isCanvasPreloadableUrl(url, { allowedHosts: ['canvas.harvard.edu'] }), false)
})

test('buildExtractVisibleCanvasLinksScript excludes hidden ancestor selectors', () => {
  const script = buildExtractVisibleCanvasLinksScript(10)
  assert.match(script, /#left-side/)
  assert.match(script, /\.module-sequence-footer/)
  assert.match(script, /isHiddenCanvasControlLink/)
  assert.ok(CANVAS_HIDDEN_LINK_ANCESTOR_SELECTORS.includes('#section-tabs'))
})
