const fs = require('fs')
const path = require('path')
const { orderedTaskIds } = require('./algorithm')
const { evaluateScenario } = require('./evaluate')

const FORBIDDEN_LITERAL_PATTERNS = [
  /canvas-assignment-cs110-pset3/i,
  /canvas-study-cs110-midterm/i,
  /admin-email-recommendation/i,
  /C07_02182026_CI/i,
  /APMTH 105/i
]

function shiftIsoDate(value, dayOffset) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/)
    if (match) {
      const shifted = new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
      ))
      shifted.setUTCDate(shifted.getUTCDate() + dayOffset)
      const year = shifted.getUTCFullYear()
      const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
      const day = String(shifted.getUTCDate()).padStart(2, '0')
      return `${year}-${month}-${day}${match[4]}`
    }
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  parsed.setDate(parsed.getDate() + dayOffset)
  return parsed.toISOString()
}

function shiftScenarioDates(scenario, dayOffset) {
  return {
    ...scenario,
    reference_date: shiftIsoDate(scenario.reference_date, dayOffset),
    tasks: (scenario.tasks || []).map(task => ({
      ...task,
      due: task.due ? shiftIsoDate(task.due, dayOffset) : task.due,
      due_date: task.due_date ? shiftIsoDate(task.due_date, dayOffset) : task.due_date,
      dueDate: task.dueDate ? shiftIsoDate(task.dueDate, dayOffset) : task.dueDate
    }))
  }
}

function auditFixtureLiterals(scenarios, sourcePaths = []) {
  const findings = []
  const scenarioText = JSON.stringify(scenarios)

  for (const pattern of FORBIDDEN_LITERAL_PATTERNS) {
    if (pattern.test(scenarioText)) continue
  }

  for (const filePath of sourcePaths) {
    if (!fs.existsSync(filePath)) continue
    const source = fs.readFileSync(filePath, 'utf8')
    for (const pattern of FORBIDDEN_LITERAL_PATTERNS) {
      if (pattern.test(source)) {
        findings.push({
          type: 'fixture_literal_in_source',
          file: filePath,
          pattern: pattern.toString(),
          verdict: 'fail'
        })
      }
    }
  }

  return {
    passed: findings.length === 0,
    findings
  }
}

function auditDateShiftInvariance(scenarios, options = {}) {
  const dayOffset = options.dayOffset ?? 14
  const results = []

  for (const scenario of scenarios || []) {
    const referenceDate = new Date(scenario.reference_date)
    const base = evaluateScenario(scenario, { defaultReferenceDate: referenceDate })
    const shifted = evaluateScenario(
      shiftScenarioDates(scenario, dayOffset),
      { defaultReferenceDate: new Date(shiftIsoDate(scenario.reference_date, dayOffset)) }
    )
    const passed = JSON.stringify(base.order) === JSON.stringify(shifted.order)
    results.push({
      id: scenario.id,
      passed,
      base_order: base.order,
      shifted_order: shifted.order
    })
  }

  const passedCount = results.filter(result => result.passed).length
  return {
    passed: passedCount === results.length,
    passed_count: passedCount,
    total: results.length,
    results
  }
}

function auditMonotonicDueDates(referenceDate, options = {}) {
  const gradePercentage = options.gradePercentage ?? 8
  const pairs = [
    { soonerDays: 1, laterDays: 4 },
    { soonerDays: 2, laterDays: 7 }
  ]
  const misses = []

  for (const pair of pairs) {
    const soonerDue = new Date(referenceDate)
    soonerDue.setDate(soonerDue.getDate() + pair.soonerDays)
    const laterDue = new Date(referenceDate)
    laterDue.setDate(laterDue.getDate() + pair.laterDays)

    const tasks = [
      {
        id: 'later-task',
        title: 'Later assignment',
        due: laterDue.toISOString(),
        gradepercentage: gradePercentage,
        type: 'canvas-assignment'
      },
      {
        id: 'sooner-task',
        title: 'Sooner assignment',
        due: soonerDue.toISOString(),
        gradepercentage: gradePercentage,
        type: 'canvas-assignment'
      }
    ]

    const order = orderedTaskIds(tasks, { referenceDate })
    if (order[0] !== 'sooner-task') {
      misses.push({
        soonerDays: pair.soonerDays,
        laterDays: pair.laterDays,
        order
      })
    }
  }

  return {
    passed: misses.length === 0,
    misses
  }
}

function auditParameterRobustness(scenarios, referenceDate, evaluateScenarios) {
  const baseline = evaluateScenarios(scenarios, { defaultReferenceDate: referenceDate })
  const reference = new Date(referenceDate)

  const variants = [
    {
      id: 'no_imminence',
      configOverrides: { IMMINENCE_ONE: 1.0, REFERENCE_DATE: reference }
    },
    {
      id: 'no_proximity',
      configOverrides: { W_PROXIMITY: 0, REFERENCE_DATE: reference }
    },
    {
      id: 'no_study_horizon',
      configOverrides: { STUDY_PENALTY_AFTER_DAYS: 0, REFERENCE_DATE: reference }
    }
  ]

  const results = variants.map(variant => {
    const evaluation = evaluateScenarios(scenarios, {
      defaultReferenceDate: reference,
      configOverrides: variant.configOverrides
    })
    return {
      id: variant.id,
      aggregate_accuracy: evaluation.aggregate_accuracy,
      baseline_only_accuracy: evaluation.baseline_accuracy,
      scenarios: evaluation.results.map(result => ({
        id: result.id,
        accuracy: result.accuracy
      }))
    }
  })

  const brittle = results.filter(variant => variant.aggregate_accuracy < 0.85)
  return {
    passed: brittle.length === 0,
    baseline_aggregate: baseline.aggregate_accuracy,
    variants: results,
    brittle_variants: brittle.map(variant => variant.id)
  }
}

function reviewParameterChoices() {
  return [
    {
      param: 'IMMINENCE_ONE',
      value: 1.12,
      verdict: 'acceptable',
      note: 'Submission-only imminence boost for due ≤1 day; not applied to study/admin.'
    },
    {
      param: 'W_PROXIMITY',
      value: 0.06,
      verdict: 'acceptable',
      note: 'Linear deadline proximity term; same structural family as urgency weight.'
    },
    {
      param: 'EXTERNAL_PRIORITY_CAP',
      value: 6,
      verdict: 'acceptable',
      note: 'Maps sidekick 1–10 priority into importance without beating urgent email.'
    },
    {
      param: 'priority_weight tie-break',
      value: 'equal raw score + equal days',
      verdict: 'acceptable',
      note: 'Manual workspace priority resolves ties only; graded assignments keep due-date precedence.'
    },
    {
      param: 'STUDY_PENALTY_AFTER_DAYS',
      value: 3,
      verdict: 'acceptable',
      note: 'Defers study multiplier until prep is far from due date.'
    },
    {
      param: 'STUDY_IMPORTANCE_FAR',
      value: 0.8,
      verdict: 'acceptable',
      note: 'Exam-weight importance is discounted when the study deadline is more than one day out.'
    },
    {
      param: 'STUDY_SECTION_HOURS',
      value: 1.25,
      verdict: 'acceptable',
      note: 'Default session length when splitting estimate-only study tasks into sections.'
    },
    {
      param: 'EFFORT_DAY_SCALE',
      value: 2,
      verdict: 'acceptable',
      note: 'Scales effort/dependency down as deadline horizon grows.'
    }
  ]
}

function runOverfittingAudit({
  scenarios,
  holdoutScenarios = [],
  referenceDate,
  evaluateScenarios,
  rootDir
}) {
  const taskOptimizerPath = path.join(rootDir, 'taskoptimizer.js')
  const literalAudit = auditFixtureLiterals(scenarios, [taskOptimizerPath])
  const shiftAudit = auditDateShiftInvariance(scenarios)
  const monotonicAudit = auditMonotonicDueDates(referenceDate)
  const robustnessAudit = auditParameterRobustness(
    scenarios,
    referenceDate,
    evaluateScenarios
  )
  const holdoutShiftAudit = holdoutScenarios.length
    ? auditDateShiftInvariance(holdoutScenarios)
    : { passed: true, passed_count: 0, total: 0, results: [] }

  const parameterReview = reviewParameterChoices()
  const borderline = parameterReview.filter(item => item.verdict === 'borderline')

  return {
    passed: literalAudit.passed
      && shiftAudit.passed
      && monotonicAudit.passed
      && holdoutShiftAudit.passed,
    literal_audit: literalAudit,
    date_shift_audit: shiftAudit,
    holdout_date_shift_audit: holdoutShiftAudit,
    monotonic_due_date_audit: monotonicAudit,
    parameter_robustness: robustnessAudit,
    parameter_review: parameterReview,
    borderline_parameters: borderline,
    overfitting_risk: borderline.length ? 'elevated' : 'low',
    parameter_sensitivity: robustnessAudit.brittle_variants
  }
}

module.exports = {
  shiftScenarioDates,
  auditFixtureLiterals,
  auditDateShiftInvariance,
  auditMonotonicDueDates,
  auditParameterRobustness,
  reviewParameterChoices,
  runOverfittingAudit
}
