const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createArtifactStore } = require('../artifact-store')
const { createAgentArtifacts } = require('../agent-artifacts')
const { generateFlashcardArtifact } = require('../artifact-generators')
const {
  buildFlashcardsFromGraph,
  exportAnkiTsv,
  exportQuizletCsv,
  mergeFlashcardContent
} = require('../artifact-graph-flashcards')

const SAMPLE_GRAPH = {
  concepts: [
    {
      courseid: 'demo',
      conceptid: 'concept-matrix',
      name: 'Matrix multiplication',
      description: 'Combines rows of the first matrix with columns of the second.',
      details: [
        {
          name: 'Row-column rule',
          description: 'Each entry is a dot product of a row and a column.'
        }
      ],
      examples: [
        {
          name: '2x2 product',
          description: 'Multiply [[1,2],[3,4]] by [[5,6],[7,8]].'
        }
      ],
      sourcePages: [{ fileid: '1001', pageNumber: 2 }]
    }
  ],
  problems: [
    {
      courseid: 'demo',
      name: 'Problem 4',
      problemid: 'Problem 4id',
      answer: '[[19,22],[43,50]]',
      steps: ['Set up dimensions', 'Compute dot products']
    }
  ],
  learningBlocks: {
    demo: [
      {
        blockId: 'demo-concept-matrix-block-1',
        courseid: 'demo',
        conceptId: 'concept-matrix',
        explanation: 'Matrix multiplication is only defined when inner dimensions match.',
        detailRefs: ['detail:concept-matrix:Row-column rule']
      }
    ]
  }
}

test('buildFlashcardsFromGraph maps graph node types to cards', () => {
  const result = buildFlashcardsFromGraph(SAMPLE_GRAPH, {
    courseId: 'demo',
    nodeTypes: ['concept', 'detail', 'example', 'problem', 'learningBlock']
  })
  assert.ok(result.cards.length >= 5)
  assert.ok(result.cards.some(card => card.graph.nodeType === 'concept'))
  assert.ok(result.cards.some(card => card.graph.nodeType === 'detail'))
  assert.ok(result.cards.some(card => card.graph.nodeType === 'example'))
  assert.ok(result.cards.some(card => card.graph.nodeType === 'problem'))
  assert.ok(result.cards.some(card => card.graph.nodeType === 'learningBlock'))
  assert.ok(result.cards.some(card => card.front.includes('Matrix multiplication')))
})

test('flashcard exports match Anki and Quizlet formats', () => {
  const result = buildFlashcardsFromGraph(SAMPLE_GRAPH, { courseId: 'demo', maxCards: 3 })
  const anki = exportAnkiTsv(result.cards)
  const quizlet = exportQuizletCsv(result.cards)
  assert.match(anki, /Matrix multiplication/)
  assert.match(quizlet, /"term","definition"/)
  assert.match(quizlet, /Matrix multiplication/)
})

test('generateFlashcardArtifact renders interactive study preview', () => {
  const merged = mergeFlashcardContent(
    buildFlashcardsFromGraph(SAMPLE_GRAPH, { courseId: 'demo' }),
    { title: 'Linear algebra deck', cards: [{ front: 'Eigenvalue', back: 'Scalar λ where Av = λv.' }] }
  )
  const generated = generateFlashcardArtifact(merged)
  assert.match(generated.previewHtml, /fc-card/)
  assert.match(generated.previewHtml, /Know it/)
  assert.match(generated.previewHtml, /Still learning/)
  assert.ok(Array.isArray(generated.payload.cards))
  assert.ok(generated.payload.cards.length >= 6)
})

test('agent artifacts builds flashcards from graph with json and sidecar exports', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nucleus-flashcards-'))
  const repoRoot = path.join(__dirname, '..')
  process.env.NUCLEUS_GRAPH_PATH = path.join(rootDir, 'graph.json')
  fs.writeFileSync(process.env.NUCLEUS_GRAPH_PATH, JSON.stringify(SAMPLE_GRAPH), 'utf8')

  const store = createArtifactStore({ rootDir })
  const artifacts = createAgentArtifacts({ store, repoRoot })
  const record = artifacts.buildArtifactRecord({
    title: 'Demo deck',
    type: 'flashcards',
    courseId: 'demo',
    content: {
      from_graph: true,
      course_id: 'demo',
      node_types: ['concept', 'detail', 'problem']
    }
  })

  const jsonAbs = store.resolveArtifactPath(record.downloadPath)
  const previewAbs = store.resolveArtifactPath(record.previewPath)
  assert.equal(record.type, 'flashcards')
  assert.ok(fs.existsSync(jsonAbs))
  assert.ok(fs.existsSync(previewAbs))
  const deck = JSON.parse(fs.readFileSync(jsonAbs, 'utf8'))
  assert.ok(deck.cards.length >= 3)
  assert.match(fs.readFileSync(previewAbs, 'utf8'), /fc-card/)

  delete process.env.NUCLEUS_GRAPH_PATH
})
