'use strict'

// Canvas disk recovery + in-memory caching are disabled for now.
// Sync is live-only: data exists in the running session after an explicit sync,
// not by reloading canvas_data.json / canvas_graph.json from disk.
function canvasDiskRecoveryEnabled() {
  return false
}

function canvasMemoryCacheEnabled() {
  return false
}

function parserDiskRecoveryEnabled() {
  return false
}

module.exports = {
  canvasDiskRecoveryEnabled,
  canvasMemoryCacheEnabled,
  parserDiskRecoveryEnabled
}
