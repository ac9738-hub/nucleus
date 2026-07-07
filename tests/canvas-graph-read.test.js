'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

test('resolveGraphReadPath uses sidecar when graph exceeds Node read limit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-graph-read-'))
  const graph = path.join(root, 'canvas_graph.json')
  const sidecar = path.join(root, 'canvas_graph_tasks.json')
  fs.writeFileSync(graph, '{"syllabi":{}}')
  fs.writeFileSync(sidecar, '{"syllabi":{"1":{"courseid":"1","assignments":[]}}}')

  const originalLimit = process.env.CANVAS_GRAPH_MAX_NODE_READ_BYTES
  process.env.CANVAS_GRAPH_MAX_NODE_READ_BYTES = '4'
  delete require.cache[require.resolve('../lib/canvas-graph-read')]
  const graphRead = require('../lib/canvas-graph-read')
  try {
    assert.equal(graphRead.isGraphTooLargeForNode(graph), true)
    assert.equal(graphRead.sidecarIsFresh(graph, sidecar), true)
    assert.equal(graphRead.resolveGraphReadPath(root), sidecar)
  } finally {
    if (originalLimit === undefined) delete process.env.CANVAS_GRAPH_MAX_NODE_READ_BYTES
    else process.env.CANVAS_GRAPH_MAX_NODE_READ_BYTES = originalLimit
    delete require.cache[require.resolve('../lib/canvas-graph-read')]
    fs.rmSync(root, { recursive: true, force: true })
  }
})
