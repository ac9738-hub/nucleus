// Canvas tab preload.
// Functionality: injects Canvas-specific CSS into main frames and selected
// iframe previews so WebContentsView Canvas tabs match the app shell.
// Dependencies: main.js configures this preload for canvastab WebContentsViews.
const path = require('path')
const { webFrame } = require('electron')
const { getCanvasThemeConfig, readThemeCss } = require('../../theme-manager')
const { attachSurfaceScrollNotify } = require('../../lib/surface-scroll-notify')

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

// Notify the main process when the visible region changes (shared with web-preload.js).
attachSurfaceScrollNotify(window)
