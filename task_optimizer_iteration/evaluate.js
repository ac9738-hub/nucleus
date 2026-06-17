const { orderedTaskIds } = require('./algorithm')

function parseReferenceDate(value, fallback) {
  if (!value) return fallback ? new Date(fallback) : null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? (fallback ? new Date(fallback) : null) : parsed
}

function rankIndex(order, taskId) {
  const index = order.indexOf(String(taskId))
  return index === -1 ? null : index
}

function evaluateConstraints(order, constraints = []) {
  const misses = []
  let matched = 0

  for (const constraint of constraints) {
    const aboveIndex = rankIndex(order, constraint.above)
    const belowIndex = rankIndex(order, constraint.below)
    if (aboveIndex === null || belowIndex === null) {
      misses.push({
        above: constraint.above,
        below: constraint.below,
        reason: constraint.reason || '',
        error: 'missing_task'
      })
      continue
    }
    if (aboveIndex < belowIndex) {
      matched += 1
    } else {
      misses.push({
        above: constraint.above,
        below: constraint.below,
        reason: constraint.reason || '',
        error: 'order_violation'
      })
    }
  }

  const total = constraints.length
  return {
    matched,
    total,
    accuracy: total ? matched / total : 1,
    misses
  }
}

function evaluateExpectedOrder(order, expectedOrder = []) {
  if (!expectedOrder.length) {
    return { matched: 0, total: 0, accuracy: 1, misses: [], kendall_tau: null }
  }

  const misses = []
  let matched = 0
  for (let index = 0; index < expectedOrder.length - 1; index += 1) {
    const above = String(expectedOrder[index])
    const below = String(expectedOrder[index + 1])
    const aboveIndex = rankIndex(order, above)
    const belowIndex = rankIndex(order, below)
    if (aboveIndex === null || belowIndex === null) {
      misses.push({ above, below, error: 'missing_task' })
      continue
    }
    if (aboveIndex < belowIndex) matched += 1
    else misses.push({ above, below, error: 'order_violation' })
  }

  const total = Math.max(expectedOrder.length - 1, 0)
  return {
    matched,
    total,
    accuracy: total ? matched / total : 1,
    misses,
    kendall_tau: kendallTau(order, expectedOrder)
  }
}

function kendallTau(actualOrder, expectedOrder) {
  const expectedIds = expectedOrder.map(String)
  const actualRanks = new Map(
    actualOrder
      .filter(id => expectedIds.includes(String(id)))
      .map((id, index) => [String(id), index])
  )

  const ids = expectedIds.filter(id => actualRanks.has(id))
  if (ids.length < 2) return ids.length ? 1 : null

  let concordant = 0
  let discordant = 0
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const leftRank = actualRanks.get(ids[i])
      const rightRank = actualRanks.get(ids[j])
      if (leftRank < rightRank) concordant += 1
      else if (leftRank > rightRank) discordant += 1
    }
  }

  const pairs = concordant + discordant
  return pairs ? (concordant - discordant) / pairs : 1
}

function evaluateTopK(order, expectedOrder = [], k = 3) {
  const expectedTop = expectedOrder.slice(0, k).map(String)
  const actualTop = order.slice(0, k).map(String)
  const overlap = expectedTop.filter(id => actualTop.includes(id)).length
  return {
    k,
    overlap,
    total: Math.min(k, expectedTop.length),
    accuracy: expectedTop.length ? overlap / Math.min(k, expectedTop.length) : 1,
    expected_top: expectedTop,
    actual_top: actualTop
  }
}

function evaluateScenario(scenario, options = {}) {
  const referenceDate = parseReferenceDate(
    scenario.reference_date,
    options.defaultReferenceDate
  )
  const order = orderedTaskIds(scenario.tasks || [], {
    referenceDate,
    configOverrides: {
      ...(options.configOverrides || {}),
      REFERENCE_DATE: options.configOverrides?.REFERENCE_DATE || referenceDate
    },
    includeDone: options.includeDone !== false
  })

  const constraintEval = evaluateConstraints(order, scenario.constraints || [])
  const expectedEval = evaluateExpectedOrder(order, scenario.expected_order || [])
  const topK = evaluateTopK(order, scenario.expected_order || [], scenario.top_k || 3)

  const accuracy = scenario.expected_order?.length
    ? expectedEval.accuracy
    : constraintEval.accuracy

  return {
    id: scenario.id,
    description: scenario.description || '',
    tier: scenario.tier || 'baseline',
    task_count: (scenario.tasks || []).length,
    reference_date: referenceDate ? referenceDate.toISOString() : null,
    order,
    constraint_eval: constraintEval,
    expected_eval: expectedEval,
    top_k: topK,
    accuracy,
    misses: [
      ...constraintEval.misses,
      ...expectedEval.misses.filter(miss => miss.error === 'missing_task')
    ]
  }
}

function evaluateScenarios(scenarios, options = {}) {
  const results = (scenarios || []).map(scenario => evaluateScenario(scenario, options))

  function summarize(filterFn) {
    const scored = results.filter(result => filterFn(result) && (result.constraint_eval.total || result.expected_eval.total))
    const aggregate = scored.length
      ? scored.reduce((sum, result) => sum + result.accuracy, 0) / scored.length
      : 1
    return { aggregate_accuracy: aggregate, scenario_count: scored.length }
  }

  const baseline = summarize(result => (result.tier || 'baseline') === 'baseline')
  const stretch = summarize(result => result.tier === 'stretch')
  const holdout = summarize(result => result.tier === 'holdout')
  const all = summarize(() => true)

  return {
    results,
    aggregate_accuracy: all.aggregate_accuracy,
    baseline_accuracy: baseline.aggregate_accuracy,
    stretch_accuracy: stretch.scenario_count ? stretch.aggregate_accuracy : null,
    holdout_accuracy: holdout.scenario_count ? holdout.aggregate_accuracy : null,
    scenario_count: results.length,
    scored_scenario_count: all.scenario_count,
    baseline_scenario_count: baseline.scenario_count,
    stretch_scenario_count: stretch.scenario_count,
    holdout_scenario_count: holdout.scenario_count
  }
}

module.exports = {
  parseReferenceDate,
  evaluateConstraints,
  evaluateExpectedOrder,
  evaluateTopK,
  evaluateScenario,
  evaluateScenarios,
  kendallTau
}
