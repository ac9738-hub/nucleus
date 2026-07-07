// Canvas tab preload.
// Functionality: injects Canvas-specific CSS into main frames and selected
// iframe previews so WebContentsView Canvas tabs match the app shell.
// Dependencies: main.js configures this preload for canvastab WebContentsViews.
const path = require('path')
const { webFrame, ipcRenderer } = require('electron')
const { getCanvasThemeConfig, readThemeCss } = require('../../theme-manager')

// Match the slate overlay (slate.css) exactly so the page reveals on top of the
// slide with no color jump. background-attachment: fixed anchors the gradient to
// the viewport on every wrapper, so the stacked layers line up seamlessly and
// match the viewport-sized slate.
const canvasThemeConfig = getCanvasThemeConfig(path.join(__dirname, '..', '..'))
const CANVAS_THEME_GRADIENT = canvasThemeConfig.criticalGradient

const criticalInjection = `
  html,
  body,
  #application,
  .ic-app,
  .ic-Layout-wrapper,
  .ic-app-main-content,
  .ic-Layout-contentWrapper {
    background: ${CANVAS_THEME_GRADIENT} !important;
    background-attachment: fixed !important;
  }
`

webFrame.insertCSS(criticalInjection)

function applyCanvasThemeBackground(element) {
  if (!element) return
  element.style.background = CANVAS_THEME_GRADIENT
  element.style.backgroundAttachment = 'fixed'
}

applyCanvasThemeBackground(document.documentElement)

if (document.body) {
  applyCanvasThemeBackground(document.body)
} else {
  document.addEventListener('DOMContentLoaded', () => {
    applyCanvasThemeBackground(document.body)
  }, { once: true })
}

const injection = readThemeCss(
  path.join(__dirname, '..', '..'),
  canvasThemeConfig.mainInjectionPath,
  ''
)

webFrame.insertCSS(injection)

function markUpcomingFormNavigation() {
  ipcRenderer.send('canvas:form_submit_pending')
}

document.addEventListener('submit', () => {
  markUpcomingFormNavigation()
}, true)

let canvasFirstPaintGeneration = 0

function scheduleCanvasFirstPaintSignal(reason = 'unspecified') {
  canvasFirstPaintGeneration += 1
  const generation = canvasFirstPaintGeneration
  const signal = () => {
    if (generation !== canvasFirstPaintGeneration) return
    ipcRenderer.send('canvas:first_paint', { generation, reason })
  }
  requestAnimationFrame(() => {
    if (generation !== canvasFirstPaintGeneration) return
    requestAnimationFrame(() => {
      if (generation !== canvasFirstPaintGeneration) return
      signal()
    })
  })
}

function armCanvasFirstPaintAfterNavigation(reason = 'navigation') {
  canvasFirstPaintGeneration += 1
  const generation = canvasFirstPaintGeneration
  const run = () => {
    if (generation !== canvasFirstPaintGeneration) return
    scheduleCanvasFirstPaintSignal(reason)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
    return
  }
  run()
}

armCanvasFirstPaintAfterNavigation('initial')

for (const method of ['pushState', 'replaceState']) {
  const original = history[method].bind(history)
  history[method] = (...args) => {
    const result = original(...args)
    armCanvasFirstPaintAfterNavigation(method)
    return result
  }
}

window.addEventListener('popstate', () => {
  armCanvasFirstPaintAfterNavigation('popstate')
})
window.addEventListener('pageshow', () => {
  armCanvasFirstPaintAfterNavigation('pageshow')
})

try {
  window.__nucleusScheduleCanvasFirstPaint = armCanvasFirstPaintAfterNavigation
} catch (_error) {
  // Preload may run in an isolated context.
}

const { installCanvasPageTracker } = require('../../lib/canvas-preload-page-tracker')

function installCanvasPointerTrackerWhenReady() {
  installCanvasPageTracker(ipcRenderer)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installCanvasPointerTrackerWhenReady, { once: true })
} else {
  installCanvasPointerTrackerWhenReady()
}
