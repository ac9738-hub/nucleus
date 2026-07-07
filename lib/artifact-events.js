// Artifact IPC event helpers (main + renderer).
// Functionality: tag artifact broadcasts by source so LUMI/Synapse don't duplicate UI.
// Dependencies: main.js broadcastArtifactEvent; renderer/artifacts.js listeners.

function artifactBroadcastPayload(artifact, source = 'lumi') {
  return {
    artifact,
    source: source || 'lumi'
  }
}

function shouldHandleArtifactInLumi(payload) {
  if (!payload) return false
  return payload.source !== 'synapse'
}

module.exports = {
  artifactBroadcastPayload,
  shouldHandleArtifactInLumi
}
