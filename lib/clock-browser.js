// Browser fake clock — configures nucleusNow without patching global Date.
(function (root) {
  'use strict'

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

  function configureFakeClock(raw) {
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
    root.__nucleusClock = {
      offsetMs,
      fakeDate: fakeDateLabel,
      fakeDateRaw,
      realNow: () => Date.now(),
      now: () => nucleusNow()
    }
    return getClockStatus()
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

  const api = {
    configureFakeClock,
    nucleusNow,
    getClockStatus
  }

  root.nucleusNow = api
  if (typeof root.__NUCLEUS_FAKE_DATE__ === 'string' && root.__NUCLEUS_FAKE_DATE__.trim()) {
    configureFakeClock(root.__NUCLEUS_FAKE_DATE__)
  }
})(typeof globalThis !== 'undefined' ? globalThis : window)
