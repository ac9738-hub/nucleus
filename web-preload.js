// Generic web-view preload.
// Functionality: notifies the main process whenever the page scrolls so the
// render-context "screen" slice can be refreshed event-driven (on every y-scroll
// change of the active tab) instead of on a fixed poll. Intercepts nucleus://
// links so they stay inside the app instead of being handed to Windows.
// Dependencies: main.js listens for the 'surface:scrolled' and
// 'engine:internal-navigate' channels.
const { contextBridge, ipcRenderer } = require('electron')
const { attachSurfaceScrollNotify } = require('./lib/surface-scroll-notify')

function sendEngineOpenApp(app) {
  ipcRenderer.send('engine:open-app', app)
}

const engineBridge = {
  openApp(app) {
    sendEngineOpenApp(app)
  }
}

try {
  contextBridge.exposeInMainWorld('__nucleusEngine', engineBridge)
} catch (_error) {
  window.__nucleusEngine = engineBridge
}

function navigateInternal(url) {
  if (!url) return
  try {
    ipcRenderer.send('engine:internal-navigate', url)
  } catch (_error) {
    window.location.href = url
  }
}

function isEngineAppUrl(value) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'nucleus:' && url.hostname === 'app'
  } catch (_error) {
    return false
  }
}

function parseEngineAppName(value) {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'nucleus:' || url.hostname !== 'app') return ''
    return url.pathname.replace(/^\/+/, '').split('/')[0] || ''
  } catch (_error) {
    return ''
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest && event.target.closest('a[href^="nucleus://app/"]')
  if (link) {
    event.preventDefault()
    event.stopPropagation()
    const href = link.getAttribute('href') || link.href
    const app = parseEngineAppName(href)
    if (!app) return
    try {
      sendEngineOpenApp(app)
    } catch (_error) {
      window.location.href = href
    }
    return
  }

  const otherLink = event.target.closest && event.target.closest('a[href^="nucleus://"]')
  if (!otherLink) return
  const href = otherLink.getAttribute('href')
  if (!href || isEngineAppUrl(href)) return
  event.preventDefault()
  event.stopPropagation()
  navigateInternal(href)
}, true)

function normalizeEngineSearchUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(text)) return text
  if (text.includes('.') && !text.includes(' ')) return 'https://' + text
  return 'nucleus://search?q=' + encodeURIComponent(text)
}

document.addEventListener('submit', event => {
  const form = event.target
  if (!form || form.id !== 'engine-search-form') return
  event.preventDefault()
  event.stopImmediatePropagation()
  const input = document.getElementById('engine-search-input')
  const text = input ? String(input.value || '').trim() : ''
  const url = normalizeEngineSearchUrl(text)
  if (url) navigateInternal(url)
}, true)

attachSurfaceScrollNotify(window)

try {
  ipcRenderer.send('engine:preload-ready')
} catch (_error) {}
