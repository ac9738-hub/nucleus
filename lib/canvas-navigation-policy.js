'use strict'

const { isCanvasExternalNavigationHost } = require('./canvas-preload-dom')

function normalizeAllowedHosts(allowedHosts) {
  if (!allowedHosts) return []
  const list = Array.isArray(allowedHosts) ? allowedHosts : [allowedHosts]
  return list
    .map(entry => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
}

function hostMatchesAllowedCanvasHost(host, allowedHosts) {
  const normalizedHost = String(host || '').trim().toLowerCase()
  if (!normalizedHost || isCanvasExternalNavigationHost(normalizedHost)) return false
  const allowed = normalizeAllowedHosts(allowedHosts)
  if (!allowed.length) return false
  return allowed.some(entry => normalizedHost === entry || normalizedHost.endsWith(`.${entry}`))
}

function normalizeAllowedCanvasNavigationUrl(value, options = {}) {
  const text = String(value || '').trim()
  if (!text) return ''

  let parsed
  try {
    parsed = new URL(text, options.baseUrl || undefined)
  } catch (_error) {
    return ''
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
  if (!hostMatchesAllowedCanvasHost(parsed.hostname, options.allowedHosts)) return ''
  return parsed.href
}

module.exports = {
  hostMatchesAllowedCanvasHost,
  normalizeAllowedCanvasNavigationUrl,
  normalizeAllowedHosts
}
