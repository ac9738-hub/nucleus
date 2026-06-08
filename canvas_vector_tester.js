const fs = require('fs')
const path = require('path')
const https = require('https')

// Edit this global variable for quick local tests, or pass a query as CLI args.
global.query = global.query || ''

const TOP_K = 20
const EMBEDDING_MODEL = 'text-embedding-3-small'
const BASE_DIR = __dirname
const GRAPH_PATH = path.join(BASE_DIR, 'canvas_graph.json')
const ENV_PATH = path.join(BASE_DIR, '.env')

const query = String(
  global.query ||
  process.env.CANVAS_QUERY ||
  process.argv.slice(2).join(' ')
).trim()

const QUERY_PREFIXES = [
  'what is',
  'what are',
  'who is',
  'who are',
  'explain',
  'define',
  'find',
  'search for',
  'tell me about',
  'show me'
]

const INTENT_CONTEXT = {
  assignment: 'assignment homework problem set pset due description submission',
  practice: 'practice problem example solution concept worked exercise',
  concept: 'definition explanation concept detail example lecture notes',
  syllabus: 'syllabus course policy grading schedule class information',
  general: 'course concept assignment event file syllabus lecture material'
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]]) continue
    let value = match[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

function sanitizeQuery(value, maxChars = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

function normalizeAcademicQuery(value) {
  let normalized = sanitizeQuery(value).toLowerCase()
  for (const prefix of QUERY_PREFIXES) {
    if (normalized.startsWith(`${prefix} `)) {
      normalized = normalized.slice(prefix.length).trim()
      break
    }
  }
  return normalized
}

function classifyQueryIntent(value) {
  const normalized = normalizeAcademicQuery(value)
  if (/\b(due|deadline|submit|submission|assignment|homework|pset|problem set)\b/.test(normalized)) {
    return 'assignment'
  }
  if (/\b(example|practice|solve|solution|problem|exercise)\b/.test(normalized)) {
    return 'practice'
  }
  if (/\b(syllabus|grading|grade|policy|schedule|class time|office hour)\b/.test(normalized)) {
    return 'syllabus'
  }
  if (/\b(define|definition|concept|explain|meaning|what is|what are)\b/.test(normalized)) {
    return 'concept'
  }
  return 'general'
}

function prepareQueryForEmbedding(value) {
  const normalized = normalizeAcademicQuery(value)
  const intent = classifyQueryIntent(value)
  return `${normalized}. ${INTENT_CONTEXT[intent] || INTENT_CONTEXT.general}`
}

function asVector(value) {
  if (!Array.isArray(value)) return null
  return value.every(item => typeof item === 'number') ? value : null
}

function dotProduct(left, right) {
  const length = Math.min(left.length, right.length)
  let total = 0
  for (let index = 0; index < length; index += 1) {
    total += left[index] * right[index]
  }
  return total
}

function nodeId(type, node, fallback) {
  return String(
    node.conceptid ||
    node.problemid ||
    node.assignmentid ||
    node.eventid ||
    node.fileid ||
    node.courseid ||
    fallback ||
    `${type}:unknown`
  )
}

function addNode(nodes, type, node, fallbackId, parent = null) {
  if (!node || typeof node !== 'object') return
  const embedded = node.embedded && typeof node.embedded === 'object' ? node.embedded : {}
  const vectors = []

  for (const field of ['name', 'description']) {
    const vector = asVector(embedded[field])
    if (vector) vectors.push({ field, vector })
  }

  if (vectors.length === 0) return

  nodes.push({
    type,
    id: nodeId(type, node, fallbackId),
    name: node.name || node.title || node.courseid || 'Untitled',
    description: node.description || node.other || '',
    courseid: node.courseid || '',
    vectors,
    parent
  })
}

function flattenGraph(graph) {
  const nodes = []

  for (const concept of graph.concepts || []) {
    const conceptId = nodeId('concept', concept)
    addNode(nodes, 'concept', concept, conceptId)

    for (const [index, detail] of (concept.details || []).entries()) {
      addNode(nodes, 'detail', detail, `${conceptId}:detail:${index}`, conceptId)
    }

    for (const [index, example] of (concept.examples || []).entries()) {
      addNode(nodes, 'example', example, `${conceptId}:example:${index}`, conceptId)
    }
  }

  for (const problem of graph.problems || []) {
    addNode(nodes, 'problem', problem, nodeId('problem', problem))
  }

  for (const event of graph.events || []) {
    addNode(nodes, 'event', event, nodeId('event', event))
  }

  for (const [courseid, syllabus] of Object.entries(graph.syllabi || {})) {
    addNode(nodes, 'syllabus', syllabus, courseid)

    for (const assignment of syllabus.assignments || []) {
      addNode(nodes, 'assignment', assignment, nodeId('assignment', assignment), courseid)
    }
  }

  for (const [courseid, courseFiles] of Object.entries(graph.files || {})) {
    for (const [fileid, fileNode] of Object.entries(courseFiles || {})) {
      addNode(nodes, 'file', fileNode, fileid, courseid)
    }
  }

  return nodes
}

function requestJson({ hostname, path: requestPath, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      { hostname, path: requestPath, method, headers },
      response => {
        let data = ''
        response.setEncoding('utf8')
        response.on('data', chunk => {
          data += chunk
        })
        response.on('end', () => {
          let parsed
          try {
            parsed = JSON.parse(data)
          } catch (error) {
            reject(new Error(`OpenAI returned non-JSON response (${response.statusCode}): ${data.slice(0, 500)}`))
            return
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const message = parsed.error && parsed.error.message ? parsed.error.message : data.slice(0, 500)
            reject(new Error(`OpenAI embeddings request failed (${response.statusCode}): ${message}`))
            return
          }

          resolve(parsed)
        })
      }
    )

    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

async function embedQuery(value) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Set OPENAI_API_KEY in your environment or .env file before running this tester.')
  }

  const body = JSON.stringify({
    model: EMBEDDING_MODEL,
    input: prepareQueryForEmbedding(value)
  })

  const response = await requestJson({
    hostname: 'api.openai.com',
    path: '/v1/embeddings',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  })

  const vector = response.data && response.data[0] && response.data[0].embedding
  if (!Array.isArray(vector)) {
    throw new Error('OpenAI embeddings response did not include an embedding vector.')
  }
  return vector
}

function rankNodes(nodes, queryVector) {
  return nodes
    .map(node => {
      const fieldScores = node.vectors.map(({ field, vector }) => ({
        field,
        similarity: dotProduct(queryVector, vector)
      }))
      const best = fieldScores.reduce((current, next) => (
        next.similarity > current.similarity ? next : current
      ))

      return {
        ...node,
        similarity: best.similarity,
        matchedField: best.field
      }
    })
    .sort((left, right) => right.similarity - left.similarity)
}

function printResults(results) {
  console.log(`Query: ${query}`)
  console.log(`Top ${Math.min(TOP_K, results.length)} retrieved Canvas graph nodes:`)
  console.log('')

  for (const [index, result] of results.slice(0, TOP_K).entries()) {
    const description = sanitizeQuery(result.description, 260)
    console.log(`${index + 1}. [${result.type}] ${result.name}`)
    console.log(`   similarity: ${result.similarity.toFixed(6)} (${result.matchedField})`)
    console.log(`   id: ${result.id}`)
    if (result.courseid) console.log(`   courseid: ${result.courseid}`)
    if (result.parent) console.log(`   parent: ${result.parent}`)
    if (description) console.log(`   description: ${description}`)
    console.log('')
  }
}

async function main() {
  loadDotEnv(ENV_PATH)

  if (!query) {
    throw new Error('Set global.query at the top of this file, pass a CLI query, or set CANVAS_QUERY.')
  }

  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'))
  const nodes = flattenGraph(graph)
  console.log(`Loaded ${nodes.length} Canvas graph nodes with embedded vectors.`)

  const queryVector = await embedQuery(query)
  const results = rankNodes(nodes, queryVector)
  printResults(results)
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
