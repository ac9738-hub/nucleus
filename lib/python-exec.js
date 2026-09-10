'use strict'

const { spawnSync } = require('child_process')

let cachedExecutable = null

function commandExists(command) {
  if (!command) return false
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    timeout: 2000,
    windowsHide: true
  })
  return !result.error && result.status === 0
}

function resolvePythonExecutable(options = {}) {
  const env = options.env || process.env
  const explicit = String(
    env.NUCLEUS_PYTHON || env.PYTHON || env.PYTHON_BIN || ''
  ).trim()
  if (explicit) return explicit

  if (!options.skipCache && cachedExecutable) return cachedExecutable

  const candidates = Array.isArray(options.candidates)
    ? options.candidates
    : (process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'])
  const runner = typeof options.commandExists === 'function'
    ? options.commandExists
    : commandExists
  const found = candidates.find(candidate => runner(candidate))
  cachedExecutable = found || (process.platform === 'win32' ? 'python' : 'python3')
  return cachedExecutable
}

function resetPythonExecutableCache() {
  cachedExecutable = null
}

module.exports = {
  resolvePythonExecutable,
  resetPythonExecutableCache,
  commandExists
}
