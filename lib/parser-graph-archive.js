'use strict'

const fs = require('fs')
const path = require('path')

const GRAPH_NAME = 'canvas_graph.json'
const TASKS_NAME = 'canvas_graph_tasks.json'
const UNWIRE_MARKER = '.unwired_for_lambda'

function archiveDir(rootDir) {
  return path.join(rootDir, '.cache', 'graph_archive')
}

function archiveMarkerPath(rootDir) {
  return path.join(archiveDir(rootDir), UNWIRE_MARKER)
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function moveIfExists(sourcePath, destPath) {
  if (!fs.existsSync(sourcePath)) return false
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.renameSync(sourcePath, destPath)
  return true
}

function archiveLiveGraph(rootDir) {
  const root = path.resolve(rootDir)
  const dir = archiveDir(root)
  const stamp = stampNow()
  const archived = []

  const graphPath = path.join(root, GRAPH_NAME)
  const graphDest = path.join(dir, `canvas_graph_${stamp}.json`)
  if (moveIfExists(graphPath, graphDest)) {
    archived.push(graphDest)
  }

  const tasksPath = path.join(root, TASKS_NAME)
  const tasksDest = path.join(dir, `canvas_graph_tasks_${stamp}.json`)
  if (moveIfExists(tasksPath, tasksDest)) {
    archived.push(tasksDest)
  }

  if (archived.length) {
    console.log(`[canvas] Archived live graph (${archived.length} file(s)) -> ${dir}`)
  }
  return archived
}

function unwireLiveGraphIfNeeded(rootDir) {
  const root = path.resolve(rootDir)
  const marker = archiveMarkerPath(root)
  if (fs.existsSync(marker)) return { archived: [], alreadyUnwired: true }

  const archived = archiveLiveGraph(root)
  fs.mkdirSync(path.dirname(marker), { recursive: true })
  fs.writeFileSync(marker, `${new Date().toISOString()}\n`, 'utf8')
  return { archived, alreadyUnwired: false }
}

module.exports = {
  GRAPH_NAME,
  TASKS_NAME,
  archiveDir,
  archiveLiveGraph,
  unwireLiveGraphIfNeeded
}
