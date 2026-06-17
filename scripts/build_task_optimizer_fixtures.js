#!/usr/bin/env node
const path = require('path')
const {
  bootstrapFromCanvasGraph,
  bootstrapFromTasksExport
} = require('../task_optimizer_iteration/bootstrap')
const { fixturePath, defaultTasksExportPath, repoRoot } = require('../task_optimizer_iteration/paths')

function parseArgs(argv) {
  const options = {
    root: repoRoot(),
    exportPath: null,
    graphPath: null,
    fixturePath: null,
    chunkSize: 6,
    referenceDate: new Date().toISOString()
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') options.root = path.resolve(argv[++index])
    else if (arg === '--export') options.exportPath = path.resolve(argv[++index])
    else if (arg === '--graph') options.graphPath = path.resolve(argv[++index])
    else if (arg === '--fixture') options.fixturePath = path.resolve(argv[++index])
    else if (arg === '--chunk-size') options.chunkSize = Number(argv[++index]) || options.chunkSize
    else if (arg === '--reference-date') options.referenceDate = argv[++index]
    else if (arg === '--help' || arg === '-h') options.help = true
  }

  return options
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(`Usage:
  node scripts/build_task_optimizer_fixtures.js --export <tasks.json>
  node scripts/build_task_optimizer_fixtures.js --graph <canvas_graph.json>

Options:
  --export <path>           JSON array of tasks or { "tasks": [...] }
  --graph <path>            Build tasks via make_canvas_tasks, then chunk into scenarios
  --fixture <path>          Output fixture path (default: fixtures/task_optimizer/scenarios_gt.json)
  --chunk-size <n>          Tasks per generated scenario (default: 6)
  --reference-date <iso>    Reference date for generated scenarios
  --root <path>             Repository root
`)
    return 0
  }

  const fixture = options.fixturePath || fixturePath(options.root)
  const bootstrapOptions = {
    fixturePath: fixture,
    chunkSize: options.chunkSize,
    referenceDate: options.referenceDate,
    id: 'export',
    description: 'Generated from current tasks export'
  }

  if (options.exportPath) {
    const merged = bootstrapFromTasksExport(options.exportPath, bootstrapOptions)
    console.log(`Updated ${fixture} with ${merged.scenarios.length} scenario(s) from ${options.exportPath}`)
    return 0
  }

  if (options.graphPath) {
    const result = bootstrapFromCanvasGraph(options.root, options.graphPath, {
      ...bootstrapOptions,
      exportPath: options.exportPath || defaultTasksExportPath(options.root)
    })
    console.log(`Exported ${result.taskCount} task(s) to ${result.exportPath}`)
    console.log(`Updated ${fixture} with ${result.fixture.scenarios.length} scenario(s)`)
    return 0
  }

  console.error('Provide --export or --graph')
  return 1
}

if (require.main === module) {
  process.exit(main())
}

module.exports = { main }
