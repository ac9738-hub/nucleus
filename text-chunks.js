// Stable text chunks with cite labels for grounded sidekick answers.
// Mirrors canvas_parser/content/text_chunks.py for the live screen pipeline.

const DEFAULT_MAX_CHUNKS = 48
const DEFAULT_MAX_CHUNK_CHARS = 420
const DEFAULT_MAX_PROMPT_CHARS = 8000
const RAG_LAYER_MAX_CHARS = 14000
const SCREEN_LAYER_MAX_CHARS = 6000
const CACHE_LAYER_SEPARATOR = '---------------------------'
const CITE_PATTERN = /\[C(\d+)\]/gi
const RETRIEVAL_CITE_PATTERN = /\[R(\d+)\]/gi

function compactChunkText(value, maxLength = DEFAULT_MAX_CHUNK_CHARS) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function makeFileBlockChunkId(courseid, fileid, pageNumber, blockIndex) {
  const page = pageNumber == null || pageNumber === '' ? 0 : pageNumber
  return `file:${courseid}/${fileid}/p${page}/b${blockIndex}`
}

function makeScreenBlockChunkId(surfaceKind, blockIndex) {
  const kind = String(surfaceKind || 'screen')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'screen'
  return `screen:${kind}/b${blockIndex}`
}

function assignRetrievalCiteLabels(chunks) {
  return (Array.isArray(chunks) ? chunks : []).map((chunk, index) => ({
    ...chunk,
    citeLabel: `R${index + 1}`
  }))
}

function formatRetrievalChunksForGrounding(chunks, {
  title = 'Retrieved source chunks (cite inline as [R#] when used):',
  maxChars = DEFAULT_MAX_PROMPT_CHARS
} = {}) {
  const labeled = assignRetrievalCiteLabels(chunks)
  if (!labeled.length) return ''
  const lines = [title]
  let chars = title.length
  for (const chunk of labeled) {
    const cite = chunk.citeLabel || ''
    const text = String(chunk.text || '').trim()
    if (!cite || !text) continue
    const source = chunk.source && typeof chunk.source === 'object' ? chunk.source : {}
    const edgeNames = (chunk.edges || [])
      .map(edge => edge && edge.name)
      .filter(Boolean)
      .slice(0, 2)
    const metaBits = []
    if (source.fileid) metaBits.push(`file=${source.fileid}`)
    if (source.pageNumber != null && source.pageNumber !== '') metaBits.push(`p.${source.pageNumber}`)
    if (edgeNames.length) metaBits.push(edgeNames.join('; '))
    const meta = metaBits.length ? ` (${metaBits.join(', ')})` : ''
    const line = `[${cite}]${meta} ${text}`
    if (chars + line.length + 1 > maxChars) {
      lines.push('… (additional retrieved chunks omitted)')
      break
    }
    lines.push(line)
    chars += line.length + 1
  }
  return lines.join('\n')
}

function parseRetrievalCiteLabels(text) {
  const labels = []
  const source = String(text || '')
  let match = RETRIEVAL_CITE_PATTERN.exec(source)
  while (match) {
    const label = `R${match[1]}`
    if (!labels.includes(label)) labels.push(label)
    match = RETRIEVAL_CITE_PATTERN.exec(source)
  }
  RETRIEVAL_CITE_PATTERN.lastIndex = 0
  return labels
}

function assignCiteLabels(chunks) {
  return (Array.isArray(chunks) ? chunks : []).map((chunk, index) => ({
    ...chunk,
    citeLabel: `C${index + 1}`
  }))
}

function chunkFromScreenBlocks(blocks, {
  surfaceKind = 'screen',
  url = '',
  courseid = '',
  fileid = '',
  maxChunks = DEFAULT_MAX_CHUNKS,
  maxChunkChars = DEFAULT_MAX_CHUNK_CHARS
} = {}) {
  const chunks = []
  for (let blockIndex = 0; blockIndex < (blocks || []).length; blockIndex += 1) {
    const block = blocks[blockIndex]
    if (!block || !block.text) continue
    const text = compactChunkText(block.text, maxChunkChars)
    if (!text) continue
    chunks.push({
      chunkId: makeScreenBlockChunkId(surfaceKind, blockIndex),
      text,
      source: {
        type: 'screen-block',
        surfaceKind: String(surfaceKind || ''),
        url: String(url || ''),
        courseid: String(courseid || ''),
        fileid: String(fileid || ''),
        blockIndex,
        tag: String(block.tag || ''),
        pageNumber: block.pageNumber == null ? null : block.pageNumber,
        y: block.y == null ? null : block.y
      }
    })
    if (chunks.length >= maxChunks) break
  }
  return assignCiteLabels(chunks)
}

function chunkFromPageBlocks(pages, {
  courseid = '',
  fileid = '',
  maxChunks = DEFAULT_MAX_CHUNKS,
  maxChunkChars = DEFAULT_MAX_CHUNK_CHARS
} = {}) {
  const chunks = []
  for (const page of pages || []) {
    if (!page || typeof page !== 'object') continue
    const pageNumber = page.pageNumber
    const pageid = String(page.pageid || '')
    const blocks = Array.isArray(page.blocks) ? page.blocks : []
    if (!blocks.length) {
      const pageText = compactChunkText(page.text, maxChunkChars)
      if (pageText) {
        chunks.push({
          chunkId: makeFileBlockChunkId(courseid, fileid, pageNumber, 0),
          text: pageText,
          source: {
            type: 'file-page',
            courseid: String(courseid || ''),
            fileid: String(fileid || ''),
            pageNumber,
            pageid,
            blockIndex: 0
          }
        })
      }
      continue
    }
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex]
      if (!block || !block.text) continue
      const text = compactChunkText(block.text, maxChunkChars)
      if (!text) continue
      chunks.push({
        chunkId: makeFileBlockChunkId(courseid, fileid, pageNumber, blockIndex),
        text,
        source: {
          type: 'file-block',
          courseid: String(courseid || ''),
          fileid: String(fileid || ''),
          pageNumber,
          pageid,
          blockIndex,
          yRatio0: block.yRatio0,
          yRatio1: block.yRatio1
        }
      })
      if (chunks.length >= maxChunks) break
    }
    if (chunks.length >= maxChunks) break
  }
  return assignCiteLabels(chunks)
}

function formatChunksForGrounding(chunks, {
  title = 'Source chunks (cite inline as [C#] when used):',
  maxChars = DEFAULT_MAX_PROMPT_CHARS
} = {}) {
  const labeled = assignCiteLabels(chunks)
  if (!labeled.length) return ''
  const lines = [title]
  let chars = title.length
  for (const chunk of labeled) {
    const cite = chunk.citeLabel || ''
    const text = String(chunk.text || '').trim()
    if (!cite || !text) continue
    const source = chunk.source && typeof chunk.source === 'object' ? chunk.source : {}
    const metaBits = []
    if (source.fileid) metaBits.push(`file=${source.fileid}`)
    if (source.pageNumber != null && source.pageNumber !== '') metaBits.push(`p.${source.pageNumber}`)
    if (source.tag) metaBits.push(String(source.tag))
    const meta = metaBits.length ? ` (${metaBits.join(', ')})` : ''
    const line = `[${cite}]${meta} ${text}`
    if (chars + line.length + 1 > maxChars) {
      lines.push('… (additional chunks omitted)')
      break
    }
    lines.push(line)
    chars += line.length + 1
  }
  return lines.join('\n')
}

function parseCiteLabels(text) {
  const labels = []
  const source = String(text || '')
  let match = CITE_PATTERN.exec(source)
  while (match) {
    const label = `C${match[1]}`
    if (!labels.includes(label)) labels.push(label)
    match = CITE_PATTERN.exec(source)
  }
  CITE_PATTERN.lastIndex = 0
  return labels
}

function resolveCitations(answerText, chunks) {
  const labels = parseCiteLabels(answerText)
  if (!labels.length) return []
  const byLabel = Object.fromEntries(
    (chunks || [])
      .filter(chunk => chunk && chunk.citeLabel)
      .map(chunk => [chunk.citeLabel, chunk])
  )
  return labels.map(label => byLabel[label]).filter(Boolean)
}

function resolveRetrievalCitations(answerText, chunks) {
  const labels = parseRetrievalCiteLabels(answerText)
  if (!labels.length) return []
  const byLabel = Object.fromEntries(
    (chunks || [])
      .filter(chunk => chunk && chunk.citeLabel)
      .map(chunk => [chunk.citeLabel, chunk])
  )
  return labels.map(label => byLabel[label]).filter(Boolean)
}

function compactCitationItem(chunk, citeLabel) {
  const source = chunk.source && typeof chunk.source === 'object' ? chunk.source : {}
  const weekly = (chunk.edges || []).find(edge => edge && edge.type === 'weekly-item')
  return {
    citeLabel: String(citeLabel || chunk.citeLabel || ''),
    chunkId: String(chunk.chunkId || ''),
    text: String(chunk.text || '').slice(0, 220),
    fileid: String(source.fileid || ''),
    pageNumber: source.pageNumber == null ? null : source.pageNumber,
    weekLabel: weekly ? String(weekly.weekLabel || '') : '',
    itemType: weekly ? String(weekly.itemType || '') : '',
    itemName: weekly ? String(weekly.name || '') : ''
  }
}

function buildGroundingCatalog({ screenChunks = [], retrievalStartpoints = [] } = {}) {
  const catalog = []
  const seen = new Set()
  const addChunk = chunk => {
    if (!chunk || !chunk.citeLabel || seen.has(chunk.citeLabel)) return
    seen.add(chunk.citeLabel)
    catalog.push(chunk)
  }
  for (const chunk of screenChunks || []) addChunk(chunk)
  let rIndex = 1
  for (const startpoint of retrievalStartpoints || []) {
    for (const chunk of (startpoint && startpoint.chunks) || []) {
      addChunk({
        ...chunk,
        citeLabel: `R${rIndex++}`
      })
    }
  }
  return catalog
}

function normalizeRetrievalStartpoints(startpoints = []) {
  let rIndex = 1
  return (startpoints || []).map(item => {
    const chunks = (item.chunks || []).map(chunk => ({
      ...chunk,
      citeLabel: `R${rIndex++}`
    }))
    return {
      ...item,
      chunks,
      chunkText: formatRetrievalChunksForGrounding(chunks)
    }
  })
}

function groundingLabels(catalog = []) {
  const retrieval = []
  const screen = []
  for (const chunk of catalog || []) {
    const label = String(chunk.citeLabel || '')
    if (!label) continue
    if (label.startsWith('R')) retrieval.push(label)
    if (label.startsWith('C')) screen.push(label)
  }
  return { retrieval, screen }
}

function resolveAllCitations(answerText, catalog) {
  const labels = [
    ...parseCiteLabels(answerText),
    ...parseRetrievalCiteLabels(answerText)
  ]
  if (!labels.length) return []
  const byLabel = Object.fromEntries(
    (catalog || [])
      .filter(chunk => chunk && chunk.citeLabel)
      .map(chunk => [chunk.citeLabel, chunk])
  )
  const items = []
  for (const label of labels) {
    const chunk = byLabel[label]
    if (!chunk) continue
    items.push(compactCitationItem(chunk, label))
  }
  return items
}

function chunkIdsUnique(chunks) {
  const ids = (chunks || []).map(chunk => String(chunk.chunkId || '')).filter(Boolean)
  return ids.length === new Set(ids).size
}

function summarizeChunks(chunks) {
  const labeled = assignCiteLabels(chunks)
  return {
    count: labeled.length,
    uniqueIds: chunkIdsUnique(labeled),
    totalChars: labeled.reduce((sum, chunk) => sum + String(chunk.text || '').length, 0),
    labels: labeled.map(chunk => chunk.citeLabel)
  }
}

function formatGroundingCatalog(catalog, {
  title = 'Grounded source chunks (cite inline using the exact [C#] or [R#] labels shown):',
  maxChars = DEFAULT_MAX_PROMPT_CHARS
} = {}) {
  const items = Array.isArray(catalog) ? catalog : []
  if (!items.length) return ''
  const lines = [title]
  let chars = title.length
  for (const chunk of items) {
    const cite = String(chunk.citeLabel || '').trim()
    const text = String(chunk.text || '').trim()
    if (!cite || !text) continue
    const source = chunk.source && typeof chunk.source === 'object' ? chunk.source : {}
    const metaBits = []
    if (source.fileid) metaBits.push(`file=${source.fileid}`)
    if (source.pageNumber != null && source.pageNumber !== '') metaBits.push(`p.${source.pageNumber}`)
    if (source.tag) metaBits.push(String(source.tag))
    const meta = metaBits.length ? ` (${metaBits.join(', ')})` : ''
    const line = `[${cite}]${meta} ${text}`
    if (chars + line.length + 1 > maxChars) {
      lines.push('… (additional chunks omitted)')
      break
    }
    lines.push(line)
    chars += line.length + 1
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

function queryTermsFromText(query) {
  return String(query || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []
}

function isConfidentlyIrrelevantChunk(chunk, {
  queryTerms = [],
  focusCourseIds = [],
  contextLock = 'balanced',
  restrictToFocus = false
} = {}) {
  const label = String(chunk.citeLabel || '')
  if (label.startsWith('C')) return false
  const text = String(chunk.text || '').trim()
  if (!text) return true

  const hay = text.toLowerCase()
  const courseid = String((chunk.source && chunk.source.courseid) || '')
  const outOfScope = focusCourseIds.length && courseid && !focusCourseIds.includes(courseid)

  if (outOfScope) {
    if (restrictToFocus || contextLock === 'strict') return true
    if (queryTerms.some(term => hay.includes(term))) return false
    return true
  }

  if (queryTerms.some(term => hay.includes(term))) return false

  return false
}

function pruneConfidentlyIrrelevantCatalog(catalog, {
  query = '',
  focusCourseIds = [],
  contextLock = 'balanced',
  restrictToFocus = false,
  softCeiling = 48,
  hardCeiling = 40
} = {}) {
  const items = Array.isArray(catalog) ? catalog : []
  const queryTerms = queryTermsFromText(query)
  const pruneArgs = { queryTerms, focusCourseIds, contextLock, restrictToFocus }
  let kept = items.filter(chunk => !isConfidentlyIrrelevantChunk(chunk, pruneArgs))
  let prunedCount = items.length - kept.length
  let truncated = false

  if (kept.length > softCeiling) {
    const stillIrrelevant = kept.filter(chunk => isConfidentlyIrrelevantChunk(chunk, pruneArgs))
    if (stillIrrelevant.length) {
      const drop = new Set(stillIrrelevant)
      kept = kept.filter(chunk => !drop.has(chunk))
      prunedCount += stillIrrelevant.length
    }
  }

  if (kept.length > hardCeiling) {
    const retrievalTail = kept.filter(chunk => String(chunk.citeLabel || '').startsWith('R'))
    const screenHead = kept.filter(chunk => !String(chunk.citeLabel || '').startsWith('R'))
    const dropCount = kept.length - hardCeiling
    const trimmedRetrieval = retrievalTail.slice(0, Math.max(retrievalTail.length - dropCount, 0))
    kept = [...screenHead, ...trimmedRetrieval]
    truncated = true
    prunedCount += dropCount
  }

  return { catalog: kept, truncated, prunedCount }
}

function splitCatalogByLayer(catalog) {
  const screen = []
  const retrieval = []
  for (const chunk of catalog || []) {
    const label = String(chunk.citeLabel || '')
    if (label.startsWith('C')) screen.push(chunk)
    else retrieval.push(chunk)
  }
  return { screen, retrieval }
}

function formatLayeredGroundingContext({ courseGraphContext = '', catalog = [] } = {}) {
  const { screen, retrieval } = splitCatalogByLayer(catalog)
  const courseGraph = String(courseGraphContext || '').trim()
  const ragContext = formatGroundingCatalog(retrieval, {
    title: 'Retrieved Canvas passages (cite inline as [R#]):',
    maxChars: RAG_LAYER_MAX_CHARS
  })
  const screenContext = formatGroundingCatalog(screen, {
    title: 'On-screen source chunks (cite inline as [C#]):',
    maxChars: SCREEN_LAYER_MAX_CHARS
  })
  const callContext = [
    courseGraph,
    ragContext,
    screenContext
  ].filter(Boolean).join(`\n\n${CACHE_LAYER_SEPARATOR}\n\n`)
  return {
    courseGraphContext: courseGraph,
    ragContext,
    screenContext,
    callContext
  }
}

module.exports = {
  DEFAULT_MAX_CHUNKS,
  DEFAULT_MAX_CHUNK_CHARS,
  DEFAULT_MAX_PROMPT_CHARS,
  compactChunkText,
  makeFileBlockChunkId,
  makeScreenBlockChunkId,
  assignCiteLabels,
  assignRetrievalCiteLabels,
  chunkFromScreenBlocks,
  chunkFromPageBlocks,
  formatChunksForGrounding,
  formatRetrievalChunksForGrounding,
  parseCiteLabels,
  parseRetrievalCiteLabels,
  resolveCitations,
  resolveRetrievalCitations,
  resolveAllCitations,
  buildGroundingCatalog,
  normalizeRetrievalStartpoints,
  groundingLabels,
  formatGroundingCatalog,
  splitCatalogByLayer,
  formatLayeredGroundingContext,
  pruneConfidentlyIrrelevantCatalog,
  CACHE_LAYER_SEPARATOR,
  RAG_LAYER_MAX_CHARS,
  compactCitationItem,
  chunkIdsUnique,
  summarizeChunks
}
