'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const TASK_SLICE_NAME = 'canvas_graph_tasks.json'
const GRAPH_NAME = 'canvas_graph.json'
const NODE_MAX_GRAPH_BYTES = Number(process.env.CANVAS_GRAPH_MAX_NODE_READ_BYTES || 450 * 1024 * 1024)

function graphPath(rootDir) {
  return path.join(rootDir, GRAPH_NAME)
}

function taskSlicePath(rootDir) {
  return path.join(rootDir, TASK_SLICE_NAME)
}

function fileSizeBytes(filePath) {
  try {
    return fs.statSync(filePath).size
  } catch (_error) {
    return 0
  }
}

function isGraphTooLargeForNode(filePath) {
  return fileSizeBytes(filePath) > NODE_MAX_GRAPH_BYTES
}

function sidecarIsFresh(graphFile, sidecarFile) {
  if (!fs.existsSync(sidecarFile) || !fs.existsSync(graphFile)) return false
  return fs.statSync(sidecarFile).mtimeMs >= fs.statSync(graphFile).mtimeMs
}

function ensureGraphTaskSidecar(rootDir) {
  const graph = graphPath(rootDir)
  const sidecar = taskSlicePath(rootDir)
  if (!fs.existsSync(graph)) {
    return { ok: false, path: sidecar, reason: 'missing_graph' }
  }
  if (!isGraphTooLargeForNode(graph)) {
    return { ok: true, path: graph, usedSidecar: false }
  }
  if (sidecarIsFresh(graph, sidecar)) {
    return { ok: true, path: sidecar, usedSidecar: true }
  }

  const script = path.join(rootDir, 'scripts', 'extract_canvas_graph_tasks.py')
  const proc = spawnSync('python', [script, '--root', rootDir], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  })
  if (proc.status !== 0 || !fs.existsSync(sidecar)) {
    const detail = String(proc.stderr || proc.stdout || proc.error || '').trim()
    throw new Error(detail || 'Failed to build canvas_graph_tasks.json from canvas_graph.json')
  }
  return { ok: true, path: sidecar, usedSidecar: true, built: true }
}

function resolveGraphReadPath(rootDir) {
  const graph = graphPath(rootDir)
  if (!fs.existsSync(graph)) return null
  if (!isGraphTooLargeForNode(graph)) return graph
  return ensureGraphTaskSidecar(rootDir).path
}

module.exports = {
  TASK_SLICE_NAME,
  GRAPH_NAME,
  NODE_MAX_GRAPH_BYTES,
  graphPath,
  taskSlicePath,
  fileSizeBytes,
  isGraphTooLargeForNode,
  sidecarIsFresh,
  ensureGraphTaskSidecar,
  resolveGraphReadPath
}
