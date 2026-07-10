'use strict'

function normalizeHostname(hostname) {
  return String(hostname || '').trim().replace(/\.$/, '').toLowerCase()
}

function hostMatchesDomain(hostname, domain) {
  const host = normalizeHostname(hostname)
  const base = normalizeHostname(domain)
  return Boolean(host && base && (host === base || host.endsWith(`.${base}`)))
}

function isCanvasLikeHostname(hostname) {
  const host = normalizeHostname(hostname)
  if (!host) return false
  if (hostMatchesDomain(host, 'instructure.com')) return true
  return host.split('.').includes('canvas')
}

function collectAllowedHosts(options = {}) {
  const hosts = []
  if (options.loginUrl) {
    try {
      hosts.push(new URL(options.loginUrl).hostname)
    } catch (_error) {
      // Ignore invalid configuration and fall back to explicit hosts.
    }
  }
  if (Array.isArray(options.allowedHosts)) {
    hosts.push(...options.allowedHosts)
  }
  return hosts.map(normalizeHostname).filter(Boolean)
}

function isTrustedAuthPopupUrl(rawUrl, options = {}) {
  let parsed
  try {
    parsed = new URL(String(rawUrl || ''))
  } catch (_error) {
    return false
  }

  if (parsed.protocol !== 'https:') return false

  const host = normalizeHostname(parsed.hostname)
  if (!host) return false

  if (options.allowCanvasHosts && isCanvasLikeHostname(host)) {
    return true
  }

  return collectAllowedHosts(options).some(domain => hostMatchesDomain(host, domain))
}

function handleTrustedAuthPopup(webContents, rawUrl, options = {}) {
  if (isTrustedAuthPopupUrl(rawUrl, options) && webContents && typeof webContents.loadURL === 'function') {
    const load = webContents.loadURL(rawUrl)
    if (load && typeof load.catch === 'function') {
      load.catch(error => {
        console.error('Unable to load auth popup URL:', error)
      })
    }
  }
  return { action: 'deny' }
}

module.exports = {
  collectAllowedHosts,
  handleTrustedAuthPopup,
  hostMatchesDomain,
  isCanvasLikeHostname,
  isTrustedAuthPopupUrl
}
