#!/usr/bin/env node
/**
 * Evaluate render-context effectiveness after PDF block reparse.
 * Prints coverage stats from canvas_graph.json and runs the Node test suite.
 *
 * Usage:
 *   node scripts/evaluate-context.js
 *   node scripts/evaluate-context.js --skip-tests
 *   node scripts/evaluate-context.js --max-files 25
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { analyzeGraphBlockCoverage, sliceVisiblePageTextBlocks } = require('../context-pipeline')

const ROOT = path.join(__dirname, '..')
const GRAPH_PATH = process.env.NUCLEUS_GRAPH_PATH || path.join(ROOT, 'canvas_graph.json')
const FIXTURE_GRAPH_PATH = path.join(ROOT, 'tests', 'fixtures', 'sample-graph.json')
const REPARSER_REPORT = path.join(ROOT, 'scripts', 'reparse_pdf_blocks_report.json')

function parseArgs(argv) {
  const options = { skipTests: false, skipGraph: false, maxFiles: Infinity, useFixture: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--skip-tests') options.skipTests = true
    if (arg === '--skip-graph') options.skipGraph = true
    if (arg === '--fixture') options.useFixture = true
    if (arg === '--max-files') options.maxFiles = Number(argv[index + 1]) || Infinity
  }
  return options
}

function runNodeTests() {
  const result = spawnSync(process.execPath, ['--test', 'tests/context-store.test.js', 'tests/context-pipeline.test.js'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.status === 0
}

function runPythonTests() {
  const result = spawnSync('python', ['tests/test_format_context_snapshot.py'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.status === 0
}

function loadReparseReport() {
  if (!fs.existsSync(REPARSER_REPORT)) return null
  try {
    return JSON.parse(fs.readFileSync(REPARSER_REPORT, 'utf8'))
  } catch (_error) {
    return null
  }
}

function evaluateViewportSlice(graph) {
  for (const courseFiles of Object.values(graph.files || {})) {
    for (const file of Object.values(courseFiles || {})) {
      const pages = Array.isArray(file.pages) ? file.pages : []
      const withBlocks = pages.filter(page => Array.isArray(page.blocks) && page.blocks.length)
      if (!withBlocks.length) continue
      const scrollHeight = Math.max(
        1000,
        ...withBlocks.map(page => (Number(page.yScroll) || 0) + (Number(page.height) || 0))
      )
      const midPage = withBlocks[Math.floor(withBlocks.length / 2)]
      const midBlock = midPage.blocks[Math.floor(midPage.blocks.length / 2)]
      const scrollY = Math.max(0, Math.round(Number(midBlock.y0) || 0) - 20)
      const visible = sliceVisiblePageTextBlocks([midPage], {
        scrollY,
        viewportHeight: 120,
        scrollHeight
      })
      return {
        file: file.name || file.fileid || 'unknown',
        scrollY,
        scrollHeight,
        visibleBlocks: visible.length,
        sampleText: visible[0] && visible[0].text ? visible[0].text.slice(0, 80) : ''
      }
    }
  }
  return null
}

function printCoverage(stats) {
  console.log('\n=== Canvas graph block coverage ===')
  console.log(`Files with pages:     ${stats.fileCount}`)
  console.log(`Total pages:          ${stats.pageCount}`)
  console.log(`Pages with blocks:    ${stats.pagesWithBlocks} (${(stats.blockPageRate * 100).toFixed(1)}%)`)
  console.log(`Pages text-only:      ${stats.pagesWithTextOnly}`)
  console.log(`Total blocks:         ${stats.totalBlocks}`)
  console.log(`Avg blocks/page:      ${stats.avgBlocksPerPage.toFixed(1)}`)
  if (stats.samples.length) {
    console.log('\nSample files:')
    for (const sample of stats.samples) {
      console.log(`  - [${sample.courseId}/${sample.fileId}] ${sample.name || '(unnamed)'}: ${sample.blocks} blocks / ${sample.pages} pages`)
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  let ok = true

  if (!options.skipTests) {
    console.log('=== Running Node context tests ===')
    ok = runNodeTests() && ok
    console.log('\n=== Running Python formatter tests ===')
    ok = runPythonTests() && ok
  }

  if (!options.skipGraph) {
    const graphPath = options.useFixture ? FIXTURE_GRAPH_PATH : GRAPH_PATH
    if (!fs.existsSync(graphPath)) {
      console.error(`Missing ${graphPath}`)
      process.exit(1)
    }

    if (options.useFixture) {
      console.log('\n=== Using fixture graph for coverage ===')
    } else {
      console.log('\n=== Loading canvas_graph.json (this may take a moment) ===')
    }
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
    const stats = analyzeGraphBlockCoverage(graph, { maxFiles: options.maxFiles })
    printCoverage(stats)

    const sliceSample = evaluateViewportSlice(graph)
    console.log('\n=== Viewport slice smoke test ===')
    if (!sliceSample) {
      console.log('No block-bearing pages found. Run: npm run reparse:pdf-blocks')
      if (!options.useFixture) ok = false
    } else {
      console.log(`File:            ${sliceSample.file}`)
      console.log(`ScrollY:         ${sliceSample.scrollY}`)
      console.log(`Visible blocks:  ${sliceSample.visibleBlocks}`)
      console.log(`Sample text:     ${sliceSample.sampleText || '(none)'}`)
    }
  } else {
    console.log('\n=== Skipping live graph coverage (--skip-graph) ===')
  }

  const reparseReport = loadReparseReport()
  if (reparseReport) {
    console.log('\n=== Latest PDF block reparse report ===')
    console.log(`Updated files:   ${reparseReport.filesUpdated}`)
    console.log(`Pages updated:   ${reparseReport.pagesUpdated}`)
    console.log(`Blocks added:    ${reparseReport.blocksAdded}`)
    console.log(`Local PDFs seen: ${reparseReport.filesWithLocalPdf}`)
  } else {
    console.log('\n(No reparse report yet — run: npm run reparse:pdf-blocks)')
  }

  if (!ok) process.exit(1)
  console.log('\nContext evaluation passed.')
}

main()
