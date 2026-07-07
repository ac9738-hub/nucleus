#!/usr/bin/env node
/**
 * Fetch Canvas via the production api.js path, run parser.py, and write a
 * human-readable activity log to .cache/parser_activity_<timestamp>.md
 *
 * Requires CANVAS_AUTH_COOKIE and CANVAS_BASE_URL in .env
 */
const fs = require('fs')
const path = require('path')

const rootDir = path.join(__dirname, '..')

function parseEnvValue(value) {
  const text = String(value || '').trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1)
  }
  return text
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    process.env[match[1]] = parseEnvValue(match[2])
  }
}

loadEnvFile(path.join(rootDir, '.env'))

const cacheDir = path.join(rootDir, '.cache')
fs.mkdirSync(cacheDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const logPath = path.join(cacheDir, `parser_activity_${stamp}.md`)
process.env.PARSER_ACTIVITY_LOG = logPath

const { createCanvasApi, waitForParserAllPasses } = require('../app/canvas/api')

const canvasDataPath = path.join(rootDir, 'canvas_data.json')

function getAuthState() {
  const cookie = process.env.CANVAS_AUTH_COOKIE || ''
  const baseUrl = process.env.CANVAS_BASE_URL || ''
  if (!cookie || !baseUrl) {
    throw new Error('Missing CANVAS_AUTH_COOKIE or CANVAS_BASE_URL in .env')
  }
  return {
    canvasAuthCookie: cookie,
    canvasAuthCsrf: process.env.CANVAS_AUTH_CSRF || '',
    canvasBaseUrl: baseUrl
  }
}

async function main() {
  console.log(`Activity log: ${logPath}`)
  console.log('Fetching Canvas and starting parser (this may take a long time)...')

  const api = createCanvasApi({
    canvasDataPath,
    getAuthState,
    sendCanvasDataUpdate: () => {},
    rootDir,
    onCanvasTasks: () => {}
  })

  await api.setupCanvasData()
  console.log('Canvas fetch complete; waiting for parser to finish all passes...')
  await waitForParserAllPasses()
  console.log(`Parser finished. Activity log: ${logPath}`)
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
