#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { ALGORITHM_VERSION } = require('./algorithm')
const { evaluateScenarios, parseReferenceDate } = require('./evaluate')
const { runOverfittingAudit } = require('./overfitting')
const {
  fixturePath,
  holdoutFixturePath,
  defaultReportPath,
  holdoutReportPath,
  repoRoot
} = require('./paths')

function parseArgs(argv) {
  const options = {
    root: repoRoot(),
    fixture: null,
    holdoutFixture: null,
    report: null,
    target: 0.85,
    algorithm: ALGORITHM_VERSION,
    referenceDate: null,
    json: false,
    strictAll: false,
    skipHoldout: false,
    skipOverfitting: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--fixture') options.fixture = argv[++index]
    else if (arg === '--holdout-fixture') options.holdoutFixture = argv[++index]
    else if (arg === '--report') options.report = argv[++index]
    else if (arg === '--root') options.root = path.resolve(argv[++index])
    else if (arg === '--target') options.target = Number(argv[++index]) || options.target
    else if (arg === '--algorithm') options.algorithm = argv[++index]
    else if (arg === '--reference-date') options.referenceDate = argv[++index]
    else if (arg === '--json') options.json = true
    else if (arg === '--strict-all') options.strictAll = true
    else if (arg === '--skip-holdout') options.skipHoldout = true
    else if (arg === '--skip-overfitting') options.skipOverfitting = true
    else if (arg === '--help' || arg === '-h') options.help = true
  }

  return options
}

function loadFixtureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture not found: ${filePath}`)
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function loadFixture(options = {}) {
  return loadFixtureFile(options.fixture || fixturePath(options.root || repoRoot()))
}

function loadHoldoutFixture(options = {}) {
  return loadFixtureFile(options.holdoutFixture || holdoutFixturePath(options.root || repoRoot()))
}

function buildSectionReport(label, fixture, evaluation, options) {
  const defaultReferenceDate = parseReferenceDate(
    options.referenceDate || fixture.default_reference_date
  )
  const baselineTarget = fixture.target_baseline_accuracy ?? options.target
  const stretchTarget = fixture.target_stretch_accuracy ?? baselineTarget
  const holdoutTarget = fixture.target_holdout_accuracy ?? baselineTarget
  const passMetric = options.strictAll
    ? evaluation.aggregate_accuracy
    : label === 'holdout'
      ? (evaluation.holdout_accuracy ?? evaluation.baseline_accuracy)
      : evaluation.baseline_accuracy
  const passTarget = options.strictAll
    ? options.target
    : label === 'holdout'
      ? holdoutTarget
      : baselineTarget
  const stretchPassed = evaluation.stretch_scenario_count === 0
    || evaluation.stretch_accuracy >= stretchTarget

  return {
    label,
    fixture: options.fixturePath || fixturePath(options.root),
    default_reference_date: defaultReferenceDate
      ? defaultReferenceDate.toISOString()
      : null,
    target: passTarget,
    aggregate_accuracy: Number(evaluation.aggregate_accuracy.toFixed(4)),
    baseline_accuracy: Number(evaluation.baseline_accuracy.toFixed(4)),
    stretch_accuracy: evaluation.stretch_accuracy === null
      ? null
      : Number(evaluation.stretch_accuracy.toFixed(4)),
    holdout_accuracy: evaluation.holdout_accuracy === null
      ? null
      : Number(evaluation.holdout_accuracy.toFixed(4)),
    passed: label === 'holdout'
      ? passMetric >= passTarget
      : passMetric >= passTarget && stretchPassed,
    stretch_passed: stretchPassed,
    stretch_target: stretchTarget,
    scenario_count: evaluation.scenario_count,
    baseline_scenario_count: evaluation.baseline_scenario_count,
    stretch_scenario_count: evaluation.stretch_scenario_count,
    holdout_scenario_count: evaluation.holdout_scenario_count,
    scenarios: evaluation.results.map(result => ({
      id: result.id,
      tier: result.tier,
      description: result.description,
      task_count: result.task_count,
      accuracy: Number(result.accuracy.toFixed(4)),
      constraint_matched: result.constraint_eval.matched,
      constraint_total: result.constraint_eval.total,
      expected_matched: result.expected_eval.matched,
      expected_total: result.expected_eval.total,
      top_k: result.top_k,
      kendall_tau: result.expected_eval.kendall_tau,
      order: result.order,
      misses: result.misses
    }))
  }
}

function buildReport(primaryFixture, primaryEval, options, extras = {}) {
  const primary = buildSectionReport('primary', primaryFixture, primaryEval, {
    ...options,
    fixturePath: options.fixture || fixturePath(options.root)
  })

  return {
    generated_at: new Date().toISOString(),
    algorithm: options.algorithm,
    passed: primary.passed
      && (extras.holdout ? extras.holdout.passed : true)
      && (extras.overfitting ? extras.overfitting.passed : true),
    primary,
    holdout: extras.holdout || null,
    overfitting_audit: extras.overfitting || null
  }
}

function printSection(section) {
  if (!section) return

  console.log(`${section.label[0].toUpperCase()}${section.label.slice(1)} accuracy: ${(section.baseline_accuracy * 100).toFixed(1)}% (target ${(section.target * 100).toFixed(0)}%)`)
  if (section.holdout_accuracy !== null) {
    console.log(`Holdout accuracy: ${(section.holdout_accuracy * 100).toFixed(1)}%`)
  }
  if (section.stretch_accuracy !== null) {
    console.log(`Stretch accuracy: ${(section.stretch_accuracy * 100).toFixed(1)}% (target ${(section.stretch_target * 100).toFixed(0)}%)`)
  }
  console.log(`Aggregate accuracy: ${(section.aggregate_accuracy * 100).toFixed(1)}%`)
  console.log(section.passed ? 'PASS' : 'FAIL')
  console.log('')

  for (const scenario of section.scenarios) {
    const tier = scenario.tier && scenario.tier !== 'baseline'
      ? ` [${scenario.tier}]`
      : ''
    console.log(`- ${scenario.id}${tier}: ${(scenario.accuracy * 100).toFixed(1)}% (${scenario.task_count} tasks)`)
    if (scenario.misses.length) {
      for (const miss of scenario.misses.slice(0, 5)) {
        console.log(`    miss: ${miss.above} > ${miss.below}${miss.reason ? ` (${miss.reason})` : ''}`)
      }
      if (scenario.misses.length > 5) {
        console.log(`    ... ${scenario.misses.length - 5} more`)
      }
    }
  }
}

function printReport(report) {
  console.log(`Task optimizer iteration (${report.algorithm})`)
  printSection(report.primary)

  if (report.holdout) {
    console.log('Holdout set')
    printSection(report.holdout)
  }

  if (report.overfitting_audit) {
    const audit = report.overfitting_audit
    console.log(`Overfitting audit: ${audit.passed ? 'PASS' : 'FAIL'} (risk: ${audit.overfitting_risk})`)
    if (!audit.literal_audit.passed) {
      console.log('  - fixture literals found in taskoptimizer.js')
    }
    if (!audit.date_shift_audit.passed) {
      console.log('  - primary date-shift invariance failed')
    }
    if (!audit.holdout_date_shift_audit.passed) {
      console.log('  - holdout date-shift invariance failed')
    }
    if (!audit.monotonic_due_date_audit.passed) {
      console.log('  - monotonic due-date pairs failed')
    }
    if (audit.parameter_sensitivity?.length) {
      console.log(`  - parameter sensitivity: ${audit.parameter_sensitivity.join(', ')}`)
    }
    if (audit.borderline_parameters.length) {
      console.log(`  - borderline parameters: ${audit.borderline_parameters.map(item => item.param).join(', ')}`)
    }
    console.log('')
  }

  console.log(report.passed ? 'OVERALL PASS' : 'OVERALL FAIL')
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(`Usage: node task_optimizer_iteration/run.js [options]

Options:
  --fixture <path>         Primary fixture (default: fixtures/task_optimizer/scenarios_gt.json)
  --holdout-fixture <path> Holdout fixture (default: fixtures/task_optimizer/scenarios_holdout.json)
  --report <path>          Write JSON report (default: .cache/task_optimizer/report.json)
  --root <path>            Repository root
  --target <float>         Pass threshold for --strict-all (default: 0.85)
  --strict-all             Require aggregate accuracy across all scenarios
  --reference-date <iso>   Override fixture reference date
  --skip-holdout           Skip holdout eval and holdout shift audit
  --skip-overfitting       Skip overfitting audit block
  --json                   Print full JSON report to stdout
  --algorithm <name>       Algorithm label for report metadata
`)
    return 0
  }

  const primaryFixture = loadFixture(options)
  const primaryReferenceDate = parseReferenceDate(
    options.referenceDate || primaryFixture.default_reference_date
  )
  const primaryEval = evaluateScenarios(primaryFixture.scenarios || [], {
    defaultReferenceDate: primaryReferenceDate
  })

  let holdoutSection = null
  let holdoutFixture = null
  if (!options.skipHoldout) {
    holdoutFixture = loadHoldoutFixture(options)
    const holdoutEval = evaluateScenarios(holdoutFixture.scenarios || [], {
      defaultReferenceDate: parseReferenceDate(holdoutFixture.default_reference_date)
    })
    holdoutSection = buildSectionReport('holdout', holdoutFixture, holdoutEval, {
      ...options,
      fixturePath: options.holdoutFixture || holdoutFixturePath(options.root)
    })
  }

  let overfittingAudit = null
  if (!options.skipOverfitting) {
    overfittingAudit = runOverfittingAudit({
      scenarios: primaryFixture.scenarios || [],
      holdoutScenarios: holdoutFixture?.scenarios || [],
      referenceDate: primaryReferenceDate,
      evaluateScenarios,
      rootDir: options.root
    })
  }

  const report = buildReport(primaryFixture, primaryEval, options, {
    holdout: holdoutSection,
    overfitting: overfittingAudit
  })

  const reportPath = options.report || defaultReportPath(options.root)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (holdoutSection) {
    const holdoutPath = holdoutReportPath(options.root)
    fs.writeFileSync(holdoutPath, `${JSON.stringify({
      generated_at: report.generated_at,
      algorithm: report.algorithm,
      holdout: holdoutSection
    }, null, 2)}\n`, 'utf8')
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printReport(report)
    console.log('')
    console.log(`Report: ${reportPath}`)
  }

  return report.passed ? 0 : 1
}

if (require.main === module) {
  process.exit(main())
}

module.exports = {
  main,
  parseArgs,
  buildReport,
  buildSectionReport,
  loadFixture,
  loadHoldoutFixture
}
