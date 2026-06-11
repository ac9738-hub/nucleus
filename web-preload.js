// Generic web-view preload.
// Functionality: notifies the main process whenever the page scrolls so the
// render-context "screen" slice can be refreshed event-driven (on every y-scroll
// change of the active tab) instead of on a fixed poll. Intercepts nucleus://
// links so they stay inside the app instead of being handed to Windows.
// Dependencies: main.js listens for the 'surface:scrolled' and
// 'engine:internal-navigate' channels.
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

function navigateInternal(url) {
  if (!url) return
  try {
    ipcRenderer.send('engine:internal-navigate', url)
  } catch (_error) {
    window.location.href = url
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest && event.target.closest('a[href^="nucleus://"]')
  if (!link) return
  event.preventDefault()
  event.stopPropagation()
  const href = link.getAttribute('href')
  if (!href) return
  navigateInternal(href)
}, true)

// Capture phase catches scrolling inside nested scroll containers, not just the window.
window.addEventListener('scroll', notifyScroll, true)
window.addEventListener('load', () => notifyScroll(), { once: true })
