#!/usr/bin/env node
/**
 * Runs PDF block reparse then context effectiveness evaluation.
 *
 * Usage:
 *   node scripts/run-context-eval.js
 *   node scripts/run-context-eval.js --dry-run
 */
const { spawnSync } = require('child_process')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const dryRun = process.argv.includes('--dry-run')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

console.log('Step 1/2: Reparse PDF blocks in canvas_graph.json')
run('python', ['scripts/reparse_pdf_blocks.py'].concat(dryRun ? ['--dry-run'] : []))

console.log('\nStep 2/2: Run context effectiveness evaluation')
run(process.execPath, ['scripts/evaluate-context.js', '--fixture'])
