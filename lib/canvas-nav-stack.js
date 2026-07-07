// Hybrid Canvas back stack (native states + web URLs).
'use strict'

function navEntriesEqual(left, right, urlsMatch) {
  if (!left || !right || left.kind !== right.kind) return false
  if (left.kind === 'web') {
    const match = typeof urlsMatch === 'function'
      ? urlsMatch(left.url, right.url)
      : String(left.url || '') === String(right.url || '')
    return match
  }
  return (
    String(left.page || '') === String(right.page || '')
    && String(left.courseId || '') === String(right.courseId || '')
    && String(left.courseSection || '') === String(right.courseSection || '')
    && Number(left.yindex || 0) === Number(right.yindex || 0)
  )
}

function createCanvasNavStackStore() {
  const stacks = new Map()

  function stackFor(tabId) {
    const key = String(tabId || '')
    if (!stacks.has(key)) stacks.set(key, [])
    return stacks.get(key)
  }

  function clear(tabId) {
    stacks.delete(String(tabId || ''))
  }

  function push(tabId, entry, urlsMatch) {
    if (!entry || !tabId) return false
    const stack = stackFor(tabId)
    const top = stack[stack.length - 1]
    if (navEntriesEqual(top, entry, urlsMatch)) return false
    stack.push(entry)
    return true
  }

  function pop(tabId) {
    const stack = stackFor(tabId)
    if (!stack.length) return null
    return stack.pop()
  }

  function peek(tabId) {
    const stack = stackFor(tabId)
    if (!stack.length) return null
    return stack[stack.length - 1]
  }

  function peekParent(tabId) {
    const stack = stackFor(tabId)
    if (stack.length < 2) return null
    return stack[stack.length - 2]
  }

  function size(tabId) {
    return stackFor(tabId).length
  }

  return {
    push,
    pop,
    peek,
    peekParent,
    size,
    clear,
    stackFor
  }
}

function snapshotNativeEntry(tab) {
  if (!tab) return null
  return {
    kind: 'native',
    page: tab.canvasNativePage || 'dashboard',
    courseId: tab.courseId || null,
    courseSection: tab.courseSection || 'homepage',
    yindex: Number(tab.yindex || 0)
  }
}

function snapshotNativeFromForward(forward) {
  if (!forward) return null
  return {
    kind: 'native',
    page: forward.page || 'dashboard',
    courseId: forward.courseId || null,
    courseSection: forward.courseSection || 'homepage',
    yindex: Number(forward.yindex || 0)
  }
}

function snapshotWebEntry(url, normalizeUrl) {
  const normalized = typeof normalizeUrl === 'function'
    ? normalizeUrl(url)
    : String(url || '').trim()
  if (!normalized) return null
  return { kind: 'web', url: normalized }
}

function isNavigableWebUrl(url, options = {}) {
  const text = String(url || '').trim()
  if (!text || text === 'about:blank') return false
  if (options.blankWarmUrl && text === options.blankWarmUrl) return false
  if (/^data:text\/html/i.test(text)) return false
  return /^https?:/i.test(text)
}

module.exports = {
  createCanvasNavStackStore,
  navEntriesEqual,
  snapshotNativeEntry,
  snapshotNativeFromForward,
  snapshotWebEntry,
  isNavigableWebUrl
}
