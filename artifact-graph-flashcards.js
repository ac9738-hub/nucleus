// Build flashcard decks from the Canvas parser graph.
// Functionality: maps concepts, details, examples, problems, and learning blocks to cards.
// Dependencies: canvas_graph.json on disk; consumed by agent-artifacts.js.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DEFAULT_NODE_TYPES = ['concept', 'detail', 'example', 'problem', 'learningBlock']
const DEFAULT_MAX_CARDS = 120

function compactText(value = '', max = 480) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function cardId(prefix, parts) {
  const raw = [prefix, ...parts].filter(Boolean).join(':')
  return `card_${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10)}`
}

function parseChildRef(ref) {
  const text = String(ref || '')
  const parts = text.split(':')
  if (parts.length >= 3) {
    return { kind: parts[0], parentId: parts[1], name: parts.slice(2).join(':') }
  }
  return { kind: '', parentId: '', name: text }
}

function conceptMatchesFilter(concept, filters) {
  if (!concept) return false
  const courseId = String(filters.courseId || filters.course_id || '').trim()
  if (courseId && String(concept.courseid || '') !== courseId) return false
  const conceptIds = filters.conceptIds || filters.concept_ids || []
  if (conceptIds.length) {
    const id = String(concept.conceptid || concept.id || '')
    const name = String(concept.name || '')
    if (!conceptIds.some(item => item === id || item === name)) return false
  }
  return true
}

function sourcePagesLabel(sourcePages = []) {
  if (!Array.isArray(sourcePages) || !sourcePages.length) return ''
  const first = sourcePages[0] || {}
  const page = first.pageNumber != null ? `p.${first.pageNumber}` : ''
  const file = first.fileid ? `file ${first.fileid}` : ''
  return compactText([file, page].filter(Boolean).join(', '), 80)
}

function makeCard({
  front,
  back,
  hint = '',
  tags = [],
  deck = 'Course',
  cardType = 'basic',
  graph = {}
}) {
  const cleanFront = compactText(front, 220)
  const cleanBack = compactText(back, 900)
  if (!cleanFront || !cleanBack || cleanFront === cleanBack) return null
  return {
    id: cardId(graph.nodeType || 'card', [graph.nodeRef || cleanFront, cleanBack.slice(0, 40)]),
    front: cleanFront,
    back: cleanBack,
    hint: compactText(hint, 160),
    tags: [...new Set(tags.filter(Boolean))],
    deck,
    cardType,
    graph
  }
}

function cardsFromConcept(concept, allowedTypes) {
  if (!conceptMatchesFilter(concept, { courseId: concept.courseid })) return []
  const cards = []
  const conceptId = String(concept.conceptid || concept.id || '')
  const courseId = String(concept.courseid || '')
  const conceptName = String(concept.name || 'Concept')
  const baseGraph = {
    courseId,
    conceptId,
    nodeType: 'concept',
    nodeRef: conceptId || conceptName,
    sourcePages: concept.sourcePages || [],
    citeLabel: concept.citeLabel || ''
  }

  if (allowedTypes.includes('concept') && concept.description) {
    const card = makeCard({
      front: conceptName,
      back: concept.description,
      tags: ['concept', conceptName],
      deck: 'Concepts',
      graph: baseGraph
    })
    if (card) cards.push(card)
  }

  if (allowedTypes.includes('detail')) {
    for (const detail of concept.details || []) {
      if (!detail || !detail.name) continue
      const card = makeCard({
        front: detail.name,
        back: detail.description || `Part of ${conceptName}.`,
        hint: conceptName,
        tags: ['detail', conceptName],
        deck: 'Details',
        graph: {
          ...baseGraph,
          nodeType: 'detail',
          nodeRef: `detail:${conceptId}:${detail.name}`,
          sourcePages: detail.sourcePages || concept.sourcePages || []
        }
      })
      if (card) cards.push(card)
    }
  }

  if (allowedTypes.includes('example')) {
    for (const example of concept.examples || []) {
      if (!example || !example.name) continue
      const card = makeCard({
        front: `Example: ${example.name}`,
        back: example.description || example.name,
        hint: conceptName,
        tags: ['example', conceptName],
        deck: 'Examples',
        graph: {
          ...baseGraph,
          nodeType: 'example',
          nodeRef: `example:${conceptId}:${example.name}`,
          sourcePages: example.sourcePages || concept.sourcePages || []
        }
      })
      if (card) cards.push(card)
    }
  }

  return cards
}

function cardsFromProblems(graph, filters, allowedTypes) {
  if (!allowedTypes.includes('problem')) return []
  const courseId = String(filters.courseId || filters.course_id || '').trim()
  const cards = []
  for (const problem of graph.problems || []) {
    if (!problem || !problem.name) continue
    if (courseId && String(problem.courseid || '') !== courseId) continue
    const answer = String(problem.answer || '').trim()
    const back = answer && answer !== 'None'
      ? answer
      : compactText((problem.steps || []).join(' → '), 900) || 'Review the worked steps in course materials.'
    const card = makeCard({
      front: problem.name,
      back,
      tags: ['problem'],
      deck: 'Problems',
      cardType: answer && answer !== 'None' ? 'basic' : 'basic',
      graph: {
        courseId: problem.courseid || courseId,
        conceptId: (problem.incomingConceptNodeIds || [])[0] || '',
        nodeType: 'problem',
        nodeRef: String(problem.problemid || problem.name),
        sourcePages: problem.sourcePages || []
      }
    })
    if (card) cards.push(card)
  }
  return cards
}

function cardsFromLearningBlocks(graph, filters, allowedTypes) {
  if (!allowedTypes.includes('learningBlock')) return []
  const courseId = String(filters.courseId || filters.course_id || '').trim()
  const conceptIds = new Set(filters.conceptIds || filters.concept_ids || [])
  const blockIds = new Set(filters.blockIds || filters.block_ids || [])
  const conceptById = new Map()
  for (const concept of graph.concepts || []) {
    const id = String(concept.conceptid || concept.id || '')
    if (id) conceptById.set(id, concept)
  }

  const cards = []
  const blocksByCourse = graph.learningBlocks || {}
  for (const [rawCourseId, blocks] of Object.entries(blocksByCourse)) {
    if (courseId && String(rawCourseId) !== courseId) continue
    for (const block of blocks || []) {
      if (!block) continue
      if (blockIds.size && !blockIds.has(String(block.blockId || ''))) continue
      const conceptId = String(block.conceptId || '')
      if (conceptIds.size && !conceptIds.has(conceptId)) continue
      const concept = conceptById.get(conceptId)
      const conceptName = concept ? concept.name : conceptId || 'Topic'
      const card = makeCard({
        front: conceptName,
        back: block.explanation || (concept && concept.description) || conceptName,
        hint: block.detailRefs && block.detailRefs.length ? `${block.detailRefs.length} linked details` : '',
        tags: ['learning-block', conceptName],
        deck: 'Learning blocks',
        graph: {
          courseId: block.courseid || rawCourseId,
          conceptId,
          nodeType: 'learningBlock',
          nodeRef: String(block.blockId || ''),
          sourceRefs: block.sourceRefs || [],
          detailRefs: block.detailRefs || [],
          examples: block.examples || []
        }
      })
      if (card) cards.push(card)
    }
  }
  return cards
}

function dedupeCards(cards) {
  const seen = new Set()
  const out = []
  for (const card of cards) {
    const key = `${card.front}::${card.back}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(card)
  }
  return out
}

function buildFlashcardsFromGraph(graph, options = {}) {
  if (!graph || typeof graph !== 'object') {
    return { cards: [], meta: { error: 'Graph unavailable.' } }
  }

  const filters = {
    courseId: options.courseId || options.course_id || '',
    conceptIds: options.conceptIds || options.concept_ids || [],
    blockIds: options.blockIds || options.block_ids || []
  }
  const allowedTypes = Array.isArray(options.nodeTypes || options.node_types)
    ? (options.nodeTypes || options.node_types).map(String)
    : DEFAULT_NODE_TYPES.slice()
  const maxCards = Number.isFinite(options.maxCards || options.max_cards)
    ? Math.max(1, Math.min(options.maxCards || options.max_cards, 400))
    : DEFAULT_MAX_CARDS

  let cards = []
  for (const concept of graph.concepts || []) {
    if (!conceptMatchesFilter(concept, filters)) continue
    cards = cards.concat(cardsFromConcept(concept, allowedTypes))
  }
  cards = cards.concat(cardsFromProblems(graph, filters, allowedTypes))
  cards = cards.concat(cardsFromLearningBlocks(graph, filters, allowedTypes))
  cards = dedupeCards(cards).slice(0, maxCards)

  const decks = {}
  cards.forEach(card => {
    const label = card.deck || 'Cards'
    decks[label] = (decks[label] || 0) + 1
  })

  return {
    cards,
    meta: {
      courseId: filters.courseId,
      cardCount: cards.length,
      decks,
      nodeTypes: allowedTypes,
      grounded: true
    }
  }
}

function mergeFlashcardContent(graphResult, manualContent = {}) {
  const manualCards = Array.isArray(manualContent.cards) ? manualContent.cards : []
  const normalizedManual = manualCards
    .map(card => makeCard({
      front: card.front || card.term || card.question,
      back: card.back || card.definition || card.answer,
      hint: card.hint || '',
      tags: card.tags || [],
      deck: card.deck || 'Added',
      cardType: card.cardType || card.card_type || 'basic',
      graph: card.graph || { nodeType: 'manual' }
    }))
    .filter(Boolean)

  const merged = dedupeCards([...(graphResult.cards || []), ...normalizedManual])
  return {
    ...manualContent,
    cards: merged,
    meta: {
      ...(graphResult.meta || {}),
      manualCount: normalizedManual.length,
      totalCount: merged.length
    }
  }
}

function resolveGraphPath(repoRoot = path.join(__dirname)) {
  const envPath = process.env.NUCLEUS_GRAPH_PATH
  if (envPath && fs.existsSync(envPath)) return envPath
  const primary = path.join(repoRoot, 'canvas_graph.json')
  if (fs.existsSync(primary)) return primary
  return path.join(repoRoot, 'tests', 'fixtures', 'sample-graph.json')
}

function loadGraphFromPath(graphPath) {
  if (!graphPath || !fs.existsSync(graphPath)) return null
  try {
    return JSON.parse(fs.readFileSync(graphPath, 'utf8'))
  } catch {
    return null
  }
}

function exportAnkiTsv(cards = []) {
  return cards.map(card => {
    const tags = (card.tags || []).join(' ')
    return [card.front, card.back, tags].map(value => String(value || '').replace(/\t/g, ' ')).join('\t')
  }).join('\n')
}

function exportQuizletCsv(cards = []) {
  const rows = [['term', 'definition']]
  cards.forEach(card => {
    rows.push([
      String(card.front || '').replace(/"/g, '""'),
      String(card.back || '').replace(/"/g, '""')
    ])
  })
  return rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
}

function buildDeckPayload(content = {}) {
  const cards = Array.isArray(content.cards) ? content.cards : []
  const deckCounts = {}
  cards.forEach(card => {
    const deck = card.deck || 'Cards'
    deckCounts[deck] = (deckCounts[deck] || 0) + 1
  })
  return {
    version: 1,
    title: content.title || 'Flashcards',
    courseId: content.courseId || content.course_id || content.meta?.courseId || '',
    settings: {
      newCardsPerDay: Number(content.newCardsPerDay || content.new_cards_per_day) || 20,
      direction: content.direction || 'term_first',
      shuffle: content.shuffle !== false
    },
    meta: content.meta || {},
    decks: Object.entries(deckCounts).map(([label, count]) => ({ id: label.toLowerCase().replace(/\s+/g, '-'), label, count })),
    cards
  }
}

module.exports = {
  DEFAULT_NODE_TYPES,
  buildFlashcardsFromGraph,
  mergeFlashcardContent,
  resolveGraphPath,
  loadGraphFromPath,
  exportAnkiTsv,
  exportQuizletCsv,
  buildDeckPayload,
  compactText,
  makeCard
}
