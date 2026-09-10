'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
  resolvePythonExecutable,
  resetPythonExecutableCache
} = require('../lib/python-exec')

test('resolvePythonExecutable honors explicit override', () => {
  resetPythonExecutableCache()
  assert.equal(
    resolvePythonExecutable({
      env: { NUCLEUS_PYTHON: '/opt/python/bin/python' },
      commandExists: () => false,
      skipCache: true
    }),
    '/opt/python/bin/python'
  )
})

test('resolvePythonExecutable prefers python3 when python is absent', () => {
  resetPythonExecutableCache()
  assert.equal(
    resolvePythonExecutable({
      env: {},
      candidates: ['python3', 'python'],
      commandExists: command => command === 'python3',
      skipCache: true
    }),
    'python3'
  )
})

test('production Python child process callers avoid literal python binary', () => {
  const root = path.join(__dirname, '..')
  const files = [
    'agent-artifacts.js',
    'agent-process.js',
    'app/canvas/api.js',
    'app/synapse/teaching-curriculum.js',
    'lib/canvas-graph-read.js',
    'main.js'
  ]

  for (const relative of files) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    assert.doesNotMatch(source, /\bspawn(?:Sync)?\(\s*['"]python['"]/)
  }
})
