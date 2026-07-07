// Sidekick retrieval budgets: cache-friendly layers + prune only when confidently irrelevant.
const {
  buildGroundingCatalog,
  normalizeRetrievalStartpoints,
  formatLayeredGroundingContext,
  groundingLabels,
  chunkFromScreenBlocks,
  pruneConfidentlyIrrelevantCatalog
} = require('./text-chunks')

const SIDEKICK_RETRIEVAL_K = 8
const MAX_RETRIEVAL_STARTPOINTS = 12
const MAX_CHUNKS_PER_STARTPOINT = 10
const MAX_GROUNDING_CATALOG_CHUNKS = 40
const SOFT_CATALOG_CEILING = 48
const MAX_TOOL_SUMMARY_ITEMS = 12
const PREVIEW_CHARS = 160

function withScreenChunks(screen) {
  if (!screen || typeof screen !== 'object') return screen
  if (Array.isArray(screen.chunks) && screen.chunks.length) return screen
  const blocks = Array.isArray(screen.text) ? screen.text : []
  if (!blocks.length) return screen
  const canvas = screen.canvas && typeof screen.canvas === 'object' ? screen.canvas : {}
  return {
    ...screen,
    chunks: chunkFromScreenBlocks(blocks, {
      surfaceKind: String(screen.surfaceKind || ''),
      url: String(screen.url || ''),
      courseid: String(canvas.courseid || ''),
      fileid: String(canvas.fileid || '')
    })
  }
}

function filterEmptyChunks(chunks) {
  return (Array.isArray(chunks) ? chunks : []).filter(chunk => {
    const text = String(chunk && chunk.text || '').trim()
    return Boolean(text)
  })
}

function prepareRetrievalStartpoints(startpoints, {
  maxStartpoints = MAX_RETRIEVAL_STARTPOINTS,
  maxChunksPerStartpoint = MAX_CHUNKS_PER_STARTPOINT
} = {}) {
  const input = Array.isArray(startpoints) ? startpoints : []
  const prepared = input.slice(0, maxStartpoints).map(startpoint => {
    const chunks = filterEmptyChunks(startpoint.chunks).slice(0, maxChunksPerStartpoint)
    return { ...startpoint, chunks }
  }).filter(item => item.chunks.length > 0)
  const startpointCapHit = input.length > maxStartpoints
  return {
    startpoints: prepared,
    truncated: startpointCapHit
  }
}

function finalizeGroundingCatalog(catalog, pruneOptions = {}) {
  const items = Array.isArray(catalog) ? catalog : []
  const { catalog: pruned, truncated: prunedTruncated, prunedCount } = pruneConfidentlyIrrelevantCatalog(
    items,
    {
      softCeiling: SOFT_CATALOG_CEILING,
      hardCeiling: MAX_GROUNDING_CATALOG_CHUNKS,
      ...pruneOptions
    }
  )
  return {
    catalog: pruned,
    truncated: prunedTruncated,
    prunedCount
  }
}

function mergeGroundingCatalogs(existing, incoming) {
  const merged = []
  const seen = new Set()
  const add = chunk => {
    if (!chunk || !chunk.citeLabel) return
    const chunkId = String(chunk.chunkId || chunk.citeLabel)
    if (seen.has(chunkId)) return
    seen.add(chunkId)
    merged.push(chunk)
  }
  for (const chunk of existing || []) add(chunk)
  for (const chunk of incoming || []) add(chunk)
  return merged
}

function buildGroundingPayload({
  startpoints,
  screenSlice,
  courseGraphContext = '',
  maxCatalogChunks = MAX_GROUNDING_CATALOG_CHUNKS,
  pruneOptions = {}
} = {}) {
  const { startpoints: prepared, truncated: rankTruncated } = prepareRetrievalStartpoints(startpoints)
  const screen = withScreenChunks(screenSlice)
  const screenChunks = screen && Array.isArray(screen.chunks) ? screen.chunks : []
  const normalized = normalizeRetrievalStartpoints(prepared)
  const fullCatalog = buildGroundingCatalog({
    screenChunks,
    retrievalStartpoints: normalized
  })
  const { catalog, truncated: catalogTruncated, prunedCount } = finalizeGroundingCatalog(
    fullCatalog,
    pruneOptions
  )
  const layers = formatLayeredGroundingContext({
    courseGraphContext,
    catalog
  })
  return {
    capped: prepared,
    normalized,
    catalog,
    ...layers,
    callContext: layers.callContext,
    groundingLabels: groundingLabels(catalog),
    truncated: rankTruncated || catalogTruncated,
    prunedCount
  }
}

function buildSlimRetrievalToolResponse({ normalized, catalog, callContext = '', truncated = false }) {
  const retrievalChunks = (catalog || []).filter(chunk => String(chunk.citeLabel || '').startsWith('R'))
  const labels = retrievalChunks.map(chunk => chunk.citeLabel)
  const labelByChunkId = new Map(
    (catalog || [])
      .filter(chunk => chunk && chunk.chunkId)
      .map(chunk => [String(chunk.chunkId), chunk.citeLabel])
  )
  const summary = []
  for (const startpoint of (normalized || []).slice(0, MAX_TOOL_SUMMARY_ITEMS)) {
    const chunks = startpoint.chunks || []
    const chunkLabels = chunks
      .map(chunk => labelByChunkId.get(String(chunk.chunkId || '')) || chunk.citeLabel)
      .filter(Boolean)
    const previewSource = chunks[0] && chunks[0].text ? chunks[0].text : (startpoint.name || '')
    summary.push({
      type: startpoint.type || 'item',
      name: startpoint.name || '',
      courseid: startpoint.courseid || '',
      labels: chunkLabels,
      preview: String(previewSource || '').replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS)
    })
  }
  return {
    ok: true,
    count: Array.isArray(normalized) ? normalized.length : 0,
    chunkCount: retrievalChunks.length,
    labels,
    summary,
    groundingContext: String(callContext || '').trim(),
    truncated: Boolean(truncated),
    note: (
      'Use groundingContext for passage text and cite inline [R#] / [C#]. '
      + 'This tool result omits duplicate per-chunk bodies.'
    )
  }
}

module.exports = {
  SIDEKICK_RETRIEVAL_K,
  MAX_RETRIEVAL_STARTPOINTS,
  MAX_CHUNKS_PER_STARTPOINT,
  MAX_GROUNDING_CATALOG_CHUNKS,
  SOFT_CATALOG_CEILING,
  prepareRetrievalStartpoints,
  finalizeGroundingCatalog,
  mergeGroundingCatalogs,
  buildGroundingPayload,
  buildSlimRetrievalToolResponse,
  withScreenChunks
}
