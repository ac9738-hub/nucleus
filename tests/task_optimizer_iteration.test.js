const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const TaskOptimizer = require('../taskoptimizer')
const {
  evaluateScenario,
  evaluateScenarios,
  kendallTau
} = require('../task_optimizer_iteration/evaluate')
const {
  orderedTaskIds,
  ALGORITHM_VERSION
} = require('../task_optimizer_iteration/algorithm')
const { inferPairwiseConstraints } = require('../task_optimizer_iteration/bootstrap')
const { loadFixture, loadHoldoutFixture, main: runIteration } = require('../task_optimizer_iteration/run')
const { runOverfittingAudit } = require('../task_optimizer_iteration/overfitting')

const REFERENCE_DATE = new Date('2026-06-17T12:00:00.000-04:00')

test('TaskOptimizer honors REFERENCE_DATE in config', () => {
  const task = {
    id: 'due-tomorrow',
    title: 'Due tomorrow',
    due: '2026-06-18T23:59:00.000-04:00',
    gradepercentage: 5
  }
  const score = TaskOptimizer.calcPriority(task, {
    ...TaskOptimizer.Config,
    REFERENCE_DATE
  })
  assert.equal(score.days_until_due, 1)
})

test('v1 algorithm ranks done tasks below active tasks', () => {
  const order = orderedTaskIds([
    { id: 'done', title: 'Done task', due: '2026-06-10T00:00:00.000Z', status: 'done', gradepercentage: 20 },
    { id: 'active', title: 'Active task', due: '2026-06-20T00:00:00.000Z', status: 'not_started', gradepercentage: 5 }
  ], { referenceDate: REFERENCE_DATE })

  assert.equal(order[0], 'active')
  assert.equal(order[1], 'done')
})

test('evaluateScenario reports constraint misses for inverted order', () => {
  const scenario = {
    id: 'demo',
    tasks: [
      { id: 'a', title: 'A', due: '2026-06-18T00:00:00.000Z', gradepercentage: 10 },
      { id: 'b', title: 'B', due: '2026-06-25T00:00:00.000Z', gradepercentage: 2 }
    ],
    constraints: [{ above: 'b', below: 'a', reason: 'intentional bad constraint' }],
    reference_date: REFERENCE_DATE.toISOString()
  }

  const result = evaluateScenario(scenario)
  assert.ok(result.accuracy < 1)
  assert.equal(result.constraint_eval.misses.length, 1)
})

test('kendallTau returns 1 for identical order', () => {
  const order = ['a', 'b', 'c']
  assert.equal(kendallTau(order, order), 1)
})

test('inferPairwiseConstraints follows due date ordering', () => {
  const constraints = inferPairwiseConstraints([
    { id: 'later', due: '2026-06-25T00:00:00.000Z', gradepercentage: 10 },
    { id: 'sooner', due: '2026-06-18T00:00:00.000Z', gradepercentage: 10 }
  ])
  assert.equal(constraints[0].above, 'sooner')
  assert.equal(constraints[0].below, 'later')
})

test('committed baseline scenarios pass v1 algorithm target', () => {
  const fixture = loadFixture()
  const evaluation = evaluateScenarios(fixture.scenarios, {
    defaultReferenceDate: new Date(fixture.default_reference_date)
  })

  assert.equal(ALGORITHM_VERSION, 'v4_study_sections')
  assert.ok(evaluation.baseline_accuracy >= (fixture.target_baseline_accuracy ?? 1))

  const baselineResults = evaluation.results.filter(result => result.tier === 'baseline')
  for (const result of baselineResults) {
    assert.ok(result.accuracy >= 0.99, `${result.id} accuracy ${result.accuracy}`)
  }

  const stretchResults = evaluation.results.filter(result => result.tier === 'stretch')
  assert.ok(stretchResults.length === 0)
})

test('iteration CLI returns success on committed fixture', () => {
  const code = runIteration([])
  assert.equal(code, 0)
})

test('holdout fixture passes without primary scenario literals', () => {
  const holdout = loadHoldoutFixture()
  const evaluation = evaluateScenarios(holdout.scenarios, {
    defaultReferenceDate: new Date(holdout.default_reference_date)
  })
  assert.ok((evaluation.holdout_accuracy ?? evaluation.baseline_accuracy) >= 0.99)
})

test('overfitting audit passes on primary and holdout fixtures', () => {
  const primary = loadFixture()
  const holdout = loadHoldoutFixture()
  const audit = runOverfittingAudit({
    scenarios: primary.scenarios,
    holdoutScenarios: holdout.scenarios,
    referenceDate: new Date(primary.default_reference_date),
    evaluateScenarios,
    rootDir: path.join(__dirname, '..')
  })
  assert.equal(audit.overfitting_risk, 'low')
  assert.equal(audit.passed, true)
  assert.equal(audit.literal_audit.passed, true)
})

test('manual priority_weight breaks ties on equal due dates', () => {
  const ranked = TaskOptimizer.rankTasks([
    {
      id: 'low-priority',
      title: 'Organize notes',
      due: '2026-09-20T23:59:00.000-04:00',
      priority_weight: 3
    },
    {
      id: 'high-priority',
      title: 'Draft presentation',
      due: '2026-09-20T23:59:00.000-04:00',
      priority_weight: 8
    }
  ], {
    ...TaskOptimizer.Config,
    REFERENCE_DATE: new Date('2026-09-14T12:00:00.000-04:00')
  })

  assert.equal(ranked[0].task_id, 'high-priority')
})
