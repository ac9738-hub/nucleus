// Default timing + GPU budgets for app-fork eval profiles.

const PROFILES = {
  jsdom: {
    paintBeforeSyncMs: 80,
    tabSwitchPaintP95MaxMs: 40,
    workspaceSwitchMaxMs: 120,
    preloadPlanMaxMs: 25,
    serializedTabOpMaxMs: 200,
    gpu: {
      maxLayerScore: 12,
      maxEstimatedMb: 384,
      maxHiddenPredictive: 4
    }
  },
  strict: {
    paintBeforeSyncMs: 40,
    tabSwitchPaintP95MaxMs: 20,
    workspaceSwitchMaxMs: 80,
    preloadPlanMaxMs: 12,
    serializedTabOpMaxMs: 100,
    gpu: {
      maxLayerScore: 10,
      maxEstimatedMb: 320,
      maxHiddenPredictive: 3
    }
  },
  relaxed: {
    paintBeforeSyncMs: 150,
    tabSwitchPaintP95MaxMs: 80,
    workspaceSwitchMaxMs: 250,
    preloadPlanMaxMs: 50,
    serializedTabOpMaxMs: 400,
    gpu: {
      maxLayerScore: 16,
      maxEstimatedMb: 512,
      maxHiddenPredictive: 6
    }
  }
}

function resolveBudgetProfile(name) {
  const key = String(name || 'jsdom').toLowerCase()
  return PROFILES[key] || PROFILES.jsdom
}

function percentile(values, p) {
  const list = (values || []).filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (!list.length) return 0
  const index = Math.min(list.length - 1, Math.floor(list.length * p))
  return list[index]
}

module.exports = {
  PROFILES,
  resolveBudgetProfile,
  percentile
}
