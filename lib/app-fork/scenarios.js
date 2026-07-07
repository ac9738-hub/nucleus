// Scenario registry for app-fork eval runner.

const SCENARIOS = {
  load: {
    id: 'load',
    label: 'Load timing (paint-before-sync, p95 tab switch)',
    tests: ['tests/app-fork/load-timing.test.js']
  },
  gpu: {
    id: 'gpu',
    label: 'GPU pressure from pool + predictive views',
    tests: ['tests/app-fork/gpu-pressure.test.js']
  },
  races: {
    id: 'races',
    label: 'Cross-process race guards (activation + preload generation)',
    tests: [
      'tests/app-fork/race-activation.test.js',
      'tests/app-fork/race-preload.test.js',
      'tests/app-fork/race-renderer-main.test.js'
    ]
  },
  screen: {
    id: 'screen',
    label: 'Screen-state coherence across IPC + view tiers',
    tests: ['tests/app-fork/screen-state.test.js']
  },
  integration: {
    id: 'integration',
    label: 'Full fork scenarios (multi-surface switches)',
    tests: ['tests/app-fork/integration-scenarios.test.js']
  },
  stress: {
    id: 'stress',
    label: 'Resource stress (preload, tabs, workspaces)',
    tests: [
      'tests/app-fork/stress-preload.test.js',
      'tests/app-fork/stress-tabs.test.js',
      'tests/app-fork/stress-workspaces.test.js'
    ]
  }
}

function listScenarioIds() {
  return Object.keys(SCENARIOS)
}

function resolveScenarioTests(selected) {
  const key = String(selected || 'all').toLowerCase()
  if (key === 'all') {
    return [...new Set(Object.values(SCENARIOS).flatMap(item => item.tests))]
  }
  const entry = SCENARIOS[key]
  if (!entry) {
    throw new Error(`Unknown app-fork scenario "${selected}". Valid: all, ${listScenarioIds().join(', ')}`)
  }
  return entry.tests.slice()
}

module.exports = {
  SCENARIOS,
  listScenarioIds,
  resolveScenarioTests
}
