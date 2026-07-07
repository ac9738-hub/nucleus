// Synthetic GPU / compositor pressure model for headless app-fork tests.
// Real GPU metrics require Electron; this estimates layer cost from view topology.

const DEFAULT_BUDGET = {
  maxLayerScore: 12,
  maxEstimatedMb: 384,
  maxHiddenPredictive: 4
}

const WEIGHTS = {
  activeVisible: 1.0,
  activeHidden: 0.55,
  backupStashed: 0.2,
  predictiveHidden: 0.35,
  availableWarm: 0.12
}

function scoreView(entry, role) {
  if (!entry) return 0
  if (role === 'active-visible') return WEIGHTS.activeVisible
  if (role === 'active-hidden') return WEIGHTS.activeHidden
  if (role === 'backup') return WEIGHTS.backupStashed
  if (role === 'predictive') return WEIGHTS.predictiveHidden
  if (role === 'warm') return WEIGHTS.availableWarm
  return 0.15
}

function estimateGpuPressure(snapshot, options = {}) {
  const budget = { ...DEFAULT_BUDGET, ...(options.budget || {}) }
  const pool = snapshot && snapshot.pool ? snapshot.pool : {}
  const preload = snapshot && snapshot.preload ? snapshot.preload : {}

  const layers = []
  let layerScore = 0

  for (const type of ['web', 'canvas']) {
    const bucket = pool[type] || {}
    const inUse = Number(bucket.inUse) || 0
    const backup = Number(bucket.backup) || 0
    const available = Number(bucket.available) || 0
    const activeVisible = Math.min(1, inUse)
    const activeHidden = Math.max(0, inUse - activeVisible)

    if (activeVisible) {
      const weight = scoreView({}, 'active-visible')
      layerScore += weight
      layers.push({ type, role: 'active-visible', weight })
    }
    for (let i = 0; i < activeHidden; i += 1) {
      const weight = scoreView({}, 'active-hidden')
      layerScore += weight
      layers.push({ type, role: 'active-hidden', weight })
    }
    for (let i = 0; i < backup; i += 1) {
      const weight = scoreView({}, 'backup')
      layerScore += weight
      layers.push({ type, role: 'backup', weight })
    }
    for (let i = 0; i < available; i += 1) {
      const weight = scoreView({}, 'warm')
      layerScore += weight
      layers.push({ type, role: 'warm', weight })
    }
  }

  const predictiveCount = Number(preload.poolSize) || 0
  for (let i = 0; i < predictiveCount; i += 1) {
    const weight = scoreView({}, 'predictive')
    layerScore += weight
    layers.push({ type: 'canvas', role: 'predictive', weight })
  }

  const estimatedMb = Math.round(layerScore * 32)
  const withinBudget = layerScore <= budget.maxLayerScore
    && estimatedMb <= budget.maxEstimatedMb
    && predictiveCount <= budget.maxHiddenPredictive

  return {
    layerScore: Number(layerScore.toFixed(3)),
    estimatedMb,
    layerCount: layers.length,
    predictiveCount,
    layers,
    budget,
    withinBudget,
    headroom: Number((budget.maxLayerScore - layerScore).toFixed(3))
  }
}

module.exports = {
  DEFAULT_BUDGET,
  WEIGHTS,
  estimateGpuPressure
}
