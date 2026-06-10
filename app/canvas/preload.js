// Canvas tab preload.
// Functionality: injects Canvas-specific CSS into main frames and selected
// iframe previews so WebContentsView Canvas tabs match the app shell.
// Dependencies: main.js configures this preload for canvastab WebContentsViews.
const fs = require('fs')
const path = require('path')
const { webFrame, ipcRenderer } = require('electron')

const criticalInjection = `
  html,
  body {
    background: #181a1f !important;
  }

  body,
  #application,
  .ic-app,
  .ic-Layout-wrapper,
  .ic-app-main-content,
  .ic-Layout-contentWrapper {
    background-color: #181a1f !important;
  }
`

webFrame.insertCSS(criticalInjection)

if (document.documentElement) {
  document.documentElement.style.backgroundColor = '#181a1f'
}

if (document.body) {
  document.body.style.backgroundColor = '#181a1f'
} else {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.style.backgroundColor = '#181a1f'
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
