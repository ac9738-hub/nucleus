'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  archiveLiveGraph,
  unwireLiveGraphIfNeeded
} = require('../lib/parser-graph-archive')

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-graph-archive-'))
}

function testArchiveBacksUpGraphWithoutRemovingLiveCopy() {
  const root = tempRoot()
  const graphPath = path.join(root, 'canvas_graph.json')
  fs.writeFileSync(graphPath, '{"concepts":[]}', 'utf8')

  const archived = archiveLiveGraph(root)
  assert.equal(archived.length, 1)
  assert.equal(fs.existsSync(graphPath), true)
  assert.equal(fs.existsSync(archived[0]), true)
  assert.equal(fs.readFileSync(archived[0], 'utf8'), '{"concepts":[]}')
  assert.match(archived[0], /graph_archive[\\/]canvas_graph_.+\.json$/)
}

function testUnwireIsIdempotent() {
  const root = tempRoot()
  fs.writeFileSync(path.join(root, 'canvas_graph.json'), '{"events":[]}', 'utf8')

  const first = unwireLiveGraphIfNeeded(root)
  assert.equal(first.alreadyUnwired, false)
  assert.equal(first.archived.length, 1)
  assert.equal(fs.existsSync(path.join(root, 'canvas_graph.json')), true)

  fs.writeFileSync(path.join(root, 'canvas_graph.json'), '{"events":[1]}', 'utf8')
  const second = unwireLiveGraphIfNeeded(root)
  assert.equal(second.alreadyUnwired, true)
  assert.equal(second.archived.length, 0)
  assert.equal(fs.existsSync(path.join(root, 'canvas_graph.json')), true)
}

testArchiveBacksUpGraphWithoutRemovingLiveCopy()
testUnwireIsIdempotent()
console.log('parser-graph-archive tests passed')
