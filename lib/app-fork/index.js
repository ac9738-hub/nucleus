// App-fork headless testing framework (no Electron / npm start).

const { createProcessTrace } = require('./process-trace')
const { captureAppScreen, captureRendererScreen, assertScreenCoherent } = require('./screen-state')
const { estimateGpuPressure, DEFAULT_BUDGET } = require('./gpu-estimator')
const { resolveBudgetProfile, percentile, PROFILES } = require('./budgets')
const { createMockMainProcess, createMockView } = require('./mock-main-process')
const { listScenarioIds, resolveScenarioTests, SCENARIOS } = require('./scenarios')
const {
  buildStressRendererState,
  buildStressCanvasUrls,
  cycleTabIds
} = require('./stress-fixtures')
const {
  createStressCollector,
  resolveStressBudget,
  assertStressBounds,
  REPORT_DIR
} = require('./stress-metrics')

module.exports = {
  createProcessTrace,
  captureAppScreen,
  captureRendererScreen,
  assertScreenCoherent,
  estimateGpuPressure,
  DEFAULT_BUDGET,
  resolveBudgetProfile,
  percentile,
  PROFILES,
  createMockMainProcess,
  createMockView,
  listScenarioIds,
  resolveScenarioTests,
  SCENARIOS,
  buildStressRendererState,
  buildStressCanvasUrls,
  cycleTabIds,
  createStressCollector,
  resolveStressBudget,
  assertStressBounds,
  REPORT_DIR
}
