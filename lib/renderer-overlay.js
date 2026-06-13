// Renderer overlay coordinator.
// Functionality: tracks modal/overlay depth in the renderer shell and tells the
// main process to hide native WebContentsViews while overlays are open. Electron
// paints WebContentsViews above the renderer DOM, so CSS z-index cannot cover them.
(function () {
  'use strict'

  let depth = 0
  let syncPromise = null

  async function pushToMain() {
    if (!window.nucleus || typeof window.nucleus.setRendererOverlay !== 'function') {
      return
    }
    const open = depth > 0
    if (syncPromise) {
      await syncPromise
    }
    syncPromise = window.nucleus.setRendererOverlay({ open }).finally(() => {
      syncPromise = null
    })
    await syncPromise
  }

  window.NucleusRendererOverlay = {
    isOpen() {
      return depth > 0
    },

    async open() {
      depth += 1
      if (depth === 1) {
        await pushToMain()
      }
    },

    async close() {
      if (depth <= 0) return
      depth -= 1
      if (depth === 0) {
        await pushToMain()
      }
    },

    async closeAll() {
      if (depth <= 0) return
      depth = 0
      await pushToMain()
    }
  }
})()
