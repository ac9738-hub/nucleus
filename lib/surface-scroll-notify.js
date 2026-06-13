'use strict'

const { ipcRenderer } = require('electron')

let scrollNotifyScheduled = false

function attachSurfaceScrollNotify(targetWindow = window) {
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

  targetWindow.addEventListener('scroll', notifyScroll, true)
  targetWindow.addEventListener('load', notifyScroll, { once: true })
}

module.exports = { attachSurfaceScrollNotify }
