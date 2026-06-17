const path = require('path')

const CACHE_DIR_NAME = '.cache/task_optimizer'

function repoRoot(startPath = __dirname) {
  return path.resolve(startPath, '..')
}

function cacheDir(root = repoRoot()) {
  return path.join(root, CACHE_DIR_NAME)
}

function fixturePath(root = repoRoot()) {
  return path.join(root, 'fixtures', 'task_optimizer', 'scenarios_gt.json')
}

function defaultReportPath(root = repoRoot()) {
  return path.join(cacheDir(root), 'report.json')
}

function defaultTasksExportPath(root = repoRoot()) {
  return path.join(cacheDir(root), 'tasks_export.json')
}

function holdoutFixturePath(root = repoRoot()) {
  return path.join(root, 'fixtures', 'task_optimizer', 'scenarios_holdout.json')
}

function holdoutReportPath(root = repoRoot()) {
  return path.join(cacheDir(root), 'report_holdout.json')
}

module.exports = {
  CACHE_DIR_NAME,
  repoRoot,
  cacheDir,
  fixturePath,
  holdoutFixturePath,
  defaultReportPath,
  holdoutReportPath,
  defaultTasksExportPath
}
