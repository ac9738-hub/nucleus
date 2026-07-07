// Fake clock for semester testing — shifts nucleusNow() without patching global Date.
// Set NUCLEUS_FAKE_DATE in .env (e.g. 2026-03-15T12:00:00 for mid spring).
'use strict'

const fs = require('fs')
const path = require('path')

let offsetMs = 0
let fakeDateLabel = ''
let fakeDateRaw = ''
let configured = false

function parseFakeDateInput(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  let ms = Date.parse(text)
  if (Number.isNaN(ms)) {
    ms = Date.parse(`${text}T12:00:00`)
  }
  return Number.isNaN(ms) ? null : ms
}

function readFakeDateFromEnv(options = {}) {
  if (typeof process !== 'undefined' && process.env && process.env.NUCLEUS_FAKE_DATE) {
    return String(process.env.NUCLEUS_FAKE_DATE).trim()
  }
  const envPath = options.envPath || path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return ''
  const pattern = /^\s*NUCLEUS_FAKE_DATE\s*=\s*(.*)\s*$/
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(pattern)
    if (!match) continue
    const value = String(match[1] || '').trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1)
    }
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1)
    }
    return value
  }
  return ''
}

function configureFakeClock(rawOrOptions = {}) {
  const raw = typeof rawOrOptions === 'string'
    ? rawOrOptions
    : readFakeDateFromEnv(rawOrOptions)
  fakeDateRaw = String(raw || '').trim()
  const targetMs = parseFakeDateInput(fakeDateRaw)
  if (targetMs == null) {
    offsetMs = 0
    fakeDateLabel = ''
    configured = false
    return getClockStatus()
  }

  offsetMs = targetMs - Date.now()
  fakeDateLabel = new Date(targetMs).toISOString()
  configured = true

  if (typeof process !== 'undefined' && process.env) {
    process.env.NUCLEUS_FAKE_DATE = fakeDateRaw
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : global
  root.__nucleusClock = {
    offsetMs,
    fakeDate: fakeDateLabel,
    fakeDateRaw,
    realNow: () => Date.now(),
    now: () => nucleusNow()
  }

  return getClockStatus()
}

/** @deprecated Use configureFakeClock — kept so old call sites do not patch Date. */
function installClockShim(options = {}) {
  return configureFakeClock(options)
}

function nucleusNow() {
  return configured ? Date.now() + offsetMs : Date.now()
}

function getClockStatus() {
  return {
    active: configured,
    offsetMs,
    fakeDate: fakeDateLabel,
    fakeDateRaw,
    now: nucleusNow()
  }
}

module.exports = {
  configureFakeClock,
  installClockShim,
  nucleusNow,
  getClockStatus,
  parseFakeDateInput,
  readFakeDateFromEnv
}
