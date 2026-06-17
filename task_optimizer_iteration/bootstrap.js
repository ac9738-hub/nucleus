const fs = require('fs')
const path = require('path')
const { fixturePath, defaultTasksExportPath } = require('./paths')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function normalizeTasksExport(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.tasks)) return payload.tasks
  if (Array.isArray(payload.items)) return payload.items
  return []
}

function dueTimestamp(task) {
  const due = task?.due || task?.due_date || task?.dueDate
  if (!due || due === 'No due date') return Number.POSITIVE_INFINITY
  const timestamp = Date.parse(due)
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
}

function gradeWeight(task) {
  const direct = Number(task.grade_weight ?? task.gradeWeight)
  if (Number.isFinite(direct)) return Math.min(Math.max(direct, 0), 1)

  const pct = Number(task.gradepercentage ?? task.gradePercentage)
  if (Number.isFinite(pct) && pct > 0) return Math.min(pct / 100, 1)

  const points = Number(task.points_possible ?? task.pointsPossible)
  const total = Number(task.course_total_pts ?? task.courseTotalPts)
  if (Number.isFinite(points) && Number.isFinite(total) && total > 0) {
    return Math.min(Math.max(points / total, 0), 1)
  }

  return 0
}

function chunkTasks(tasks, chunkSize = 6) {
  const chunks = []
  for (let index = 0; index < tasks.length; index += chunkSize) {
    chunks.push(tasks.slice(index, index + chunkSize))
  }
  return chunks
}

function inferPairwiseConstraints(tasks) {
  const active = tasks.filter(task => String(task.status || 'not_started').toLowerCase() !== 'done')
  const sorted = [...active].sort((left, right) => {
    const dueDelta = dueTimestamp(left) - dueTimestamp(right)
    if (dueDelta !== 0) return dueDelta
    return gradeWeight(right) - gradeWeight(left)
  })

  const constraints = []
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const above = sorted[index]
    const below = sorted[index + 1]
    if (!above?.id || !below?.id) continue
    constraints.push({
      above: String(above.id),
      below: String(below.id),
      reason: 'auto: earlier due date with equal-or-higher grade weight'
    })
  }
  return constraints
}

function buildScenarioFromTasks(tasks, options = {}) {
  const {
    id = `export_${Date.now()}`,
    description = 'Generated from tasks export',
    referenceDate = new Date().toISOString(),
    chunkIndex = 0
  } = options

  const scenarioTasks = tasks.map(task => ({ ...task }))
  const constraints = inferPairwiseConstraints(scenarioTasks)

  return {
    id: `${id}_${chunkIndex + 1}`,
    description,
    source: 'tasks_export',
    reference_date: referenceDate,
    tasks: scenarioTasks,
    constraints
  }
}

function buildScenariosFromExport(tasks, options = {}) {
  const chunkSize = options.chunkSize || 6
  const chunks = chunkTasks(tasks, chunkSize)
  return chunks.map((chunk, index) => buildScenarioFromTasks(chunk, {
    ...options,
    chunkIndex: index
  }))
}

function loadFixture(filePath = fixturePath()) {
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      default_reference_date: new Date().toISOString(),
      target_pairwise_accuracy: 0.85,
      scenarios: []
    }
  }
  return readJson(filePath)
}

function mergeScenarios(existing, generated, { replaceSource = 'tasks_export' } = {}) {
  const kept = (existing.scenarios || []).filter(
    scenario => scenario.source !== replaceSource
  )
  return {
    ...existing,
    scenarios: [...kept, ...generated]
  }
}

function exportTasksFromGraph(rootDir, graphPath) {
  const apiPath = path.join(rootDir, 'app', 'canvas', 'api.js')
  if (!fs.existsSync(apiPath)) {
    throw new Error(`Canvas API module not found: ${apiPath}`)
  }
  if (!fs.existsSync(graphPath)) {
    throw new Error(`Canvas graph not found: ${graphPath}`)
  }

  const graphTarget = path.join(rootDir, 'canvas_graph.json')
  const hadGraph = fs.existsSync(graphTarget)
  const graphBackup = hadGraph ? fs.readFileSync(graphTarget) : null

  fs.copyFileSync(graphPath, graphTarget)
  delete require.cache[require.resolve(apiPath)]

  try {
    const { make_canvas_tasks } = require(apiPath)
    return make_canvas_tasks(rootDir)
  } finally {
    if (graphBackup) fs.writeFileSync(graphTarget, graphBackup)
    else if (fs.existsSync(graphTarget)) fs.unlinkSync(graphTarget)
  }
}

function bootstrapFromTasksExport(exportPath, options = {}) {
  const payload = readJson(exportPath)
  const tasks = normalizeTasksExport(payload)
  if (!tasks.length) {
    throw new Error(`No tasks found in export: ${exportPath}`)
  }

  const generated = buildScenariosFromExport(tasks, options)
  const fixture = loadFixture(options.fixturePath)
  const merged = mergeScenarios(fixture, generated, options)
  writeJson(options.fixturePath || fixturePath(), merged)
  return merged
}

function bootstrapFromCanvasGraph(rootDir, graphPath, options = {}) {
  const tasks = exportTasksFromGraph(rootDir, graphPath)
  const exportPath = options.exportPath || defaultTasksExportPath(rootDir)
  writeJson(exportPath, {
    exported_at: new Date().toISOString(),
    source: graphPath,
    tasks
  })

  const generated = buildScenariosFromExport(tasks, options)
  const fixture = loadFixture(options.fixturePath)
  const merged = mergeScenarios(fixture, generated, options)
  writeJson(options.fixturePath || fixturePath(), merged)
  return { exportPath, fixture: merged, taskCount: tasks.length }
}

module.exports = {
  readJson,
  writeJson,
  normalizeTasksExport,
  inferPairwiseConstraints,
  buildScenarioFromTasks,
  buildScenariosFromExport,
  bootstrapFromTasksExport,
  bootstrapFromCanvasGraph
}
