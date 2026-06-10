// Pure helpers for the render-context screen-text pipeline.
// Functionality: PDF viewport slicing and canvas-graph block coverage analysis.
// Shared by main.js (live context) and the context evaluation tests.

const MAX_VISIBLE_TEXT_BLOCKS = 24
const MAX_VISIBLE_TEXT_CHARS = 2600

function compactText(value, maxLength = 180) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

// Slices block-level PDF text to the blocks intersecting the live viewport.
function sliceVisiblePageTextBlocks(visiblePages, scrollState, maxBlocks = MAX_VISIBLE_TEXT_BLOCKS, maxChars = MAX_VISIBLE_TEXT_CHARS) {
  const scrollY = Math.max(0, Number(scrollState && scrollState.scrollY) || 0)
  const viewportHeight = Math.max(1, Number(scrollState && scrollState.viewportHeight) || 1)
  const scrollHeight = Number(scrollState && scrollState.scrollHeight) || 0
  const haveRatios = scrollHeight > 0
  const rangeStartRatio = haveRatios ? scrollY / scrollHeight : 0
  const rangeEndRatio = haveRatios ? (scrollY + viewportHeight) / scrollHeight : 1
  const out = []
  let chars = 0
  for (const page of visiblePages) {
    const blocks = Array.isArray(page && page.blocks) ? page.blocks : []
    for (const block of blocks) {
      if (!block || !block.text) continue
      if (haveRatios) {
        const blockStart = Number(block.yRatio0) || 0
        const blockEnd = Number(block.yRatio1) || blockStart
        if (blockEnd < rangeStartRatio || blockStart > rangeEndRatio) continue
      }
      const text = compactText(block.text, 320)
      if (!text) continue
      out.push({
        tag: 'pdf',
        text,
        y: Math.round(Number(block.y0) || 0),
        pageNumber: page.pageNumber || null
      })
      chars += text.length
      if (out.length >= maxBlocks || chars >= maxChars) return out
    }
  }
  return out
}

// Summarizes how much block-level PDF text is present in a canvas graph index.
function analyzeGraphBlockCoverage(graph, options = {}) {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : Infinity
  const files = graph && graph.files ? graph.files : {}
  let fileCount = 0
  let pageCount = 0
  let pagesWithBlocks = 0
  let totalBlocks = 0
  let pagesWithTextOnly = 0
  const samples = []

  outer: for (const [courseId, courseFiles] of Object.entries(files)) {
    if (!courseFiles || typeof courseFiles !== 'object') continue
    for (const [fileId, file] of Object.entries(courseFiles)) {
      if (!file || !Array.isArray(file.pages) || !file.pages.length) continue
      fileCount += 1
      let fileBlocks = 0
      for (const page of file.pages) {
        pageCount += 1
        const blocks = Array.isArray(page.blocks) ? page.blocks : []
        const blockCount = blocks.filter(block => block && block.text).length
        if (blockCount) {
          pagesWithBlocks += 1
          totalBlocks += blockCount
          fileBlocks += blockCount
        } else if (page.text) {
          pagesWithTextOnly += 1
        }
      }
      if (samples.length < 8) {
        samples.push({
          courseId,
          fileId,
          name: file.name || '',
          pages: file.pages.length,
          blocks: fileBlocks,
          hasBlocks: fileBlocks > 0
        })
      }
      if (fileCount >= maxFiles) break outer
    }
  }

  const blockPageRate = pageCount ? pagesWithBlocks / pageCount : 0
  return {
    fileCount,
    pageCount,
    pagesWithBlocks,
    pagesWithTextOnly,
    totalBlocks,
    avgBlocksPerPage: pagesWithBlocks ? totalBlocks / pagesWithBlocks : 0,
    blockPageRate,
    samples
  }
}

module.exports = {
  MAX_VISIBLE_TEXT_BLOCKS,
  MAX_VISIBLE_TEXT_CHARS,
  compactText,
  sliceVisiblePageTextBlocks,
  analyzeGraphBlockCoverage
}
