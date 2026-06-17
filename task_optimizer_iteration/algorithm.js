const TaskOptimizer = require('../taskoptimizer')

const ALGORITHM_VERSION = 'v4_study_sections'

function buildConfig(referenceDate, overrides = {}) {
  const cfg = { ...TaskOptimizer.Config, ...overrides }
  if (referenceDate) {
    cfg.REFERENCE_DATE = referenceDate instanceof Date
      ? referenceDate
      : new Date(referenceDate)
  }
  return cfg
}

function rankScenarioTasks(tasks, options = {}) {
  const {
    referenceDate = null,
    configOverrides = {},
    includeDone = true
  } = options

  const activeTasks = includeDone
    ? tasks
    : tasks.filter(task => String(task.status || 'not_started').toLowerCase() !== 'done')

  const cfg = buildConfig(referenceDate, configOverrides)
  return TaskOptimizer.rankTasks(activeTasks, cfg)
}

function orderedTaskIds(tasks, options = {}) {
  return rankScenarioTasks(tasks, options).map(score => score.task_id || score.task?.id)
}

module.exports = {
  ALGORITHM_VERSION,
  buildConfig,
  rankScenarioTasks,
  orderedTaskIds,
  TaskOptimizer
}
