// Generic web-view preload.
// Functionality: notifies the main process whenever the page scrolls so the
// render-context "screen" slice can be refreshed event-driven (on every y-scroll
// change of the active tab) instead of on a fixed poll. Attached to every plain
// browsertab WebContentsView in main.js createView().
// Dependencies: main.js listens for the 'surface:scrolled' channel.
const { ipcRenderer } = require('electron')

let scrollNotifyScheduled = false
function notifyScroll() {
  if (scrollNotifyScheduled) return
  scrollNotifyScheduled = true
  setTimeout(() => {
    scrollNotifyScheduled = false
    try {
      ipcRenderer.send('surface:scrolled')
    } catch (_error) {
      // Channel may be unavailable during teardown.
    }
  }, 120)
}

// Capture phase catches scrolling inside nested scroll containers, not just the window.
window.addEventListener('scroll', notifyScroll, true)
window.addEventListener('load', () => notifyScroll(), { once: true })
