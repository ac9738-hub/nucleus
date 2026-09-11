'use strict'

function normalizeText(value) {
  return String(value || '').toLowerCase()
}

function compactHost(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '')
}

function parseUrl(value) {
  try {
    return new URL(String(value || ''))
  } catch (_error) {
    return null
  }
}

function textMentionsHost(text, host) {
  const normalizedText = normalizeText(text)
  const normalizedHost = compactHost(host)
  if (!normalizedText || !normalizedHost) return false
  if (normalizedText.includes(normalizedHost)) return true
  const root = normalizedHost.split('.').filter(Boolean)[0] || ''
  return root.length >= 4 && normalizedText.includes(root)
}

function textMentionsRawValue(text, value) {
  const normalizedText = normalizeText(text).replace(/\s+/g, ' ').trim()
  const normalizedValue = normalizeText(value).replace(/\s+/g, ' ').trim()
  return Boolean(normalizedText && normalizedValue && normalizedText.includes(normalizedValue))
}

function isHttpUrl(value) {
  const url = parseUrl(value)
  return Boolean(url && (url.protocol === 'http:' || url.protocol === 'https:'))
}

function shouldAllowSidekickBrowserOpen({ rawValue = '', normalizedUrl = '', userText = '' } = {}) {
  const raw = String(rawValue || '').trim()
  const url = parseUrl(normalizedUrl)
  if (!url) {
    return { ok: false, error: 'Sidekick browser navigation blocked: invalid destination.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Sidekick browser navigation blocked: unsupported URL scheme.' }
  }
  if (isHttpUrl(raw) || /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
    if (textMentionsHost(userText, url.hostname) || textMentionsRawValue(userText, raw)) {
      return { ok: true }
    }
    return {
      ok: false,
      error: `Sidekick browser navigation blocked: the current user message did not mention ${compactHost(url.hostname)}.`
    }
  }
  if (textMentionsRawValue(userText, raw)) {
    return { ok: true }
  }
  return {
    ok: false,
    error: 'Sidekick browser navigation blocked: the requested search text was not in the current user message.'
  }
}

function shouldAllowSidekickWorkspaceDelete({ workspaceId = '', userText = '' } = {}) {
  const text = normalizeText(userText)
  const id = normalizeText(workspaceId).trim()
  const asksDelete = /\b(delete|remove)\b/.test(text) && /\bworkspace\b/.test(text)
  if (asksDelete && id && text.includes(id)) {
    return { ok: true }
  }
  return {
    ok: false,
    error: 'Sidekick workspace deletion blocked: the current user message must explicitly ask to delete that workspace.'
  }
}

module.exports = {
  shouldAllowSidekickBrowserOpen,
  shouldAllowSidekickWorkspaceDelete
}
