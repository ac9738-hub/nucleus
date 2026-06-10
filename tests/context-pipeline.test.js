const test = require('node:test')
const assert = require('node:assert/strict')
const {
  sliceVisiblePageTextBlocks,
  analyzeGraphBlockCoverage
} = require('../context-pipeline')

const FIXTURE_PAGES = [
  {
    pageNumber: 1,
    blocks: [
      { text: 'Top of page one', y0: 0, y1: 40, yRatio0: 0.0, yRatio1: 0.1 },
      { text: 'Middle of page one', y0: 400, y1: 440, yRatio0: 0.4, yRatio1: 0.5 },
      { text: 'Bottom of page one', y0: 900, y1: 980, yRatio0: 0.9, yRatio1: 1.0 }
    ]
  }
]

test('sliceVisiblePageTextBlocks returns only viewport-intersecting blocks', () => {
  const visible = sliceVisiblePageTextBlocks(FIXTURE_PAGES, {
    scrollY: 350,
    viewportHeight: 200,
    scrollHeight: 1000
  })
  assert.equal(visible.length, 1)
  assert.match(visible[0].text, /Middle/)
})

test('sliceVisiblePageTextBlocks falls back to all blocks without scroll height', () => {
  const visible = sliceVisiblePageTextBlocks(FIXTURE_PAGES, {
    scrollY: 0,
    viewportHeight: 200,
    scrollHeight: 0
  })
  assert.equal(visible.length, 3)
})

test('analyzeGraphBlockCoverage reports block presence', () => {
  const stats = analyzeGraphBlockCoverage({
    files: {
      c1: {
        f1: {
          name: 'Syllabus.pdf',
          pages: [
            { text: 'whole page', blocks: [{ text: 'block a' }, { text: 'block b' }] },
            { text: 'legacy only' }
          ]
        }
      }
    }
  })
  assert.equal(stats.fileCount, 1)
  assert.equal(stats.pageCount, 2)
  assert.equal(stats.pagesWithBlocks, 1)
  assert.equal(stats.totalBlocks, 2)
  assert.ok(stats.blockPageRate > 0)
})
