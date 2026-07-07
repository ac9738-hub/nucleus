// Sidekick retrieval session store (P1): slot-based RAG context across tool rounds.
const {
  MAX_GROUNDING_CATALOG_CHUNKS,
  MAX_TOOL_SUMMARY_ITEMS,
  finalizeGroundingCatalog
} = require('./sidekick-retrieval-budget')

const {
  buildGroundingCatalog,
  formatLayeredGroundingContext,
  groundingLabels
} = require('./text-chunks')

const PREVIEW_CHARS = 160
const MAX_ACTIVE_SLOTS = 8

function nextSlotId(counter) {
  return `ret-${counter}`
}

function summarizeStartpoints(normalized, labelByChunkId) {
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
  return summary
}

function rawRetrievalChunks(payload) {
  const chunks = []
  for (const startpoint of payload.normalized || []) {
    for (const chunk of startpoint.chunks || []) {
      if (chunk && chunk.chunkId) chunks.push(chunk)
    }
  }
  return chunks
}

class RetrievalSessionStore {
  constructor() {
    this.reset()
  }

  reset() {
    this._counter = 0
    this._screenCatalog = []
    this._slots = new Map()
    this._activeSlotIds = []
    this._ephemeralCallContext = ''
    this._courseGraphContext = ''
    this._pruneOptions = {}
    this._dirty = false
  }

  setPruneOptions(options) {
    this._pruneOptions = options && typeof options === 'object' ? { ...options } : {}
    this._dirty = true
  }

  setScreenCatalog(catalog) {
    this._screenCatalog = Array.isArray(catalog)
      ? catalog.filter(chunk => String(chunk.citeLabel || '').startsWith('C'))
      : []
    this._dirty = true
  }

  setCourseGraphContext(text) {
    this._courseGraphContext = String(text || '').trim()
    this._dirty = true
  }

  _removeSlots(slotIds) {
    const ids = Array.isArray(slotIds) ? slotIds.map(String) : []
    for (const id of ids) {
      this._slots.delete(id)
      this._activeSlotIds = this._activeSlotIds.filter(activeId => activeId !== id)
    }
    if (ids.length) this._dirty = true
  }

  _allActiveRawChunks() {
    const chunks = []
    const seen = new Set()
    for (const slotId of this._activeSlotIds) {
      const slot = this._slots.get(slotId)
      if (!slot) continue
      for (const chunk of slot.rawChunks || []) {
        const chunkId = String(chunk.chunkId || '')
        if (!chunkId || seen.has(chunkId)) continue
        seen.add(chunkId)
        chunks.push(chunk)
      }
    }
    return chunks
  }

  _rebuildMergedCatalog(maxChunks = MAX_GROUNDING_CATALOG_CHUNKS) {
    const rawChunks = this._allActiveRawChunks()
    const fullCatalog = buildGroundingCatalog({
      screenChunks: this._screenCatalog,
      retrievalStartpoints: rawChunks.length ? [{ chunks: rawChunks }] : []
    })
    const { catalog, truncated, prunedCount } = finalizeGroundingCatalog(
      fullCatalog,
      this._pruneOptions
    )
    const layers = formatLayeredGroundingContext({
      courseGraphContext: this._courseGraphContext,
      catalog
    })
    const labelByChunkId = new Map(
      catalog.filter(chunk => chunk && chunk.chunkId).map(chunk => [String(chunk.chunkId), chunk.citeLabel])
    )
    return {
      catalog,
      ...layers,
      callContext: [
        layers.callContext,
        this._ephemeralCallContext
      ].filter(Boolean).join('\n\n'),
      groundingLabels: groundingLabels(catalog),
      labelByChunkId,
      truncated,
      prunedCount
    }
  }

  seedTurnZero({ query = '', payload }) {
    if (!payload || !rawRetrievalChunks(payload).length) return null
    return this.addRetrieval({
      query: query || 'turn prefetch',
      payload,
      keep: true,
      replaceSlots: [],
      slotKind: 'prefetch'
    })
  }

  addRetrieval({
    query = '',
    payload,
    keep = true,
    replaceSlots = [],
    keepSlots = null,
    maxChunks = MAX_GROUNDING_CATALOG_CHUNKS,
    slotKind = 'retrieve'
  }) {
    if (!payload) return null

    this._removeSlots(replaceSlots)
    if (Array.isArray(keepSlots)) {
      const keepSet = new Set(keepSlots.map(String))
      const drop = this._activeSlotIds.filter(id => !keepSet.has(id))
      this._removeSlots(drop)
    }

    const rawChunks = rawRetrievalChunks(payload)
    if (!rawChunks.length) return null

    const slotId = slotKind === 'prefetch'
      ? 'prefetch'
      : nextSlotId((this._counter += 1))

    const slot = {
      id: slotId,
      query: String(query || '').trim(),
      kind: slotKind,
      rawChunks,
      labels: [],
      chunkCount: rawChunks.length,
      summary: [],
      truncated: Boolean(payload.truncated),
      keep: Boolean(keep),
      createdAt: Date.now()
    }

    this._slots.set(slotId, slot)

    if (keep) {
      if (slotKind === 'prefetch') {
        this._activeSlotIds = ['prefetch', ...this._activeSlotIds.filter(id => id !== 'prefetch')]
      } else if (!this._activeSlotIds.includes(slotId)) {
        this._activeSlotIds.push(slotId)
      }
      while (this._activeSlotIds.length > MAX_ACTIVE_SLOTS) {
        const removedId = this._activeSlotIds.shift()
        this._slots.delete(removedId)
      }
      this._ephemeralCallContext = ''
    } else {
      const ephemeralCatalog = buildGroundingCatalog({
        screenChunks: [],
        retrievalStartpoints: [{ chunks: rawChunks }]
      })
      const layers = formatLayeredGroundingContext({ catalog: ephemeralCatalog })
      this._ephemeralCallContext = layers.ragContext || layers.callContext
    }

    const merged = this._rebuildMergedCatalog(maxChunks)
    slot.labels = rawChunks
      .map(chunk => merged.labelByChunkId.get(String(chunk.chunkId || '')))
      .filter(Boolean)
    slot.summary = summarizeStartpoints(payload.normalized, merged.labelByChunkId)
    slot.truncated = Boolean(slot.truncated || merged.truncated)

    this._dirty = true
    return slot
  }

  getMergedCatalog() {
    return this._rebuildMergedCatalog().catalog
  }

  getLayeredContext() {
    return this._rebuildMergedCatalog()
  }

  getCallContext() {
    return this.getLayeredContext().callContext
  }

  getGroundingLabels() {
    return this._rebuildMergedCatalog().groundingLabels
  }

  getCitationCatalog() {
    return this.getMergedCatalog()
  }

  toSnapshot() {
    const merged = this._rebuildMergedCatalog()
    return {
      callContext: merged.callContext,
      courseGraphContext: merged.courseGraphContext,
      ragContext: merged.ragContext,
      screenContext: merged.screenContext,
      groundingLabels: merged.groundingLabels,
      activeSlots: this._activeSlotIds.map(id => {
        const slot = this._slots.get(id)
        if (!slot) return null
        return {
          id: slot.id,
          query: slot.query,
          kind: slot.kind,
          labels: slot.labels,
          chunkCount: slot.chunkCount,
          truncated: slot.truncated
        }
      }).filter(Boolean),
      truncated: merged.truncated
    }
  }

  consumeDirty() {
    const dirty = this._dirty
    this._dirty = false
    return dirty
  }

  buildSlotToolResponse(slot) {
    if (!slot) {
      return { ok: false, count: 0, note: 'No retrieval results for query.' }
    }
    return {
      ok: true,
      slotId: slot.id,
      query: slot.query,
      labels: slot.labels,
      chunkCount: slot.chunkCount,
      summary: slot.summary,
      truncated: Boolean(slot.truncated),
      activeSlots: [...this._activeSlotIds],
      note: (
        'Passage text for active slot labels is in Active retrieval slots (system prompt). '
        + 'Cite inline [R#] / [C#]; this tool result is slot metadata only.'
      )
    }
  }
}

module.exports = {
  RetrievalSessionStore,
  MAX_ACTIVE_SLOTS
}
