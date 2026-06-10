// Canvas tab preload.
// Functionality: injects Canvas-specific CSS into main frames and selected
// iframe previews so WebContentsView Canvas tabs match the app shell.
// Dependencies: main.js configures this preload for canvastab WebContentsViews.
const fs = require('fs')
const path = require('path')
const { webFrame, ipcRenderer } = require('electron')

// Match the slate overlay (slate.css) exactly so the page reveals on top of the
// slide with no color jump. background-attachment: fixed anchors the gradient to
// the viewport on every wrapper, so the stacked layers line up seamlessly and
// match the viewport-sized slate.
const CANVAS_THEME_GRADIENT = 'linear-gradient(135deg, #0c1224 0%, #050916 100%)'

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

const injection = fs.readFileSync(path.join(__dirname, '..', '..', 'injection.css'), 'utf-8')

webFrame.insertCSS(injection)

// Notify the main process when the visible region changes so it can refresh the
// Canvas visible-context. This replaces a fixed 200ms main-process poll: the
// main process only does work when the user actually scrolls. Capture phase
// catches scrolling inside nested scroll containers, not just the window.
let canvasScrollNotifyScheduled = false
function notifyCanvasScroll() {
  if (canvasScrollNotifyScheduled) return
  canvasScrollNotifyScheduled = true
  setTimeout(() => {
    canvasScrollNotifyScheduled = false
    try {
      ipcRenderer.send('canvas:scrolled')
    } catch (_error) {
      // Channel may be unavailable during teardown.
    }
  }, 120)
}

window.addEventListener('scroll', notifyCanvasScroll, true)
window.addEventListener('load', notifyCanvasScroll, { once: true })
