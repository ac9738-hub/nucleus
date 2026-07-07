// Main-process helper: load teaching-block curricula from canvas_graph.json.
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const GRAPH_PATH = process.env.NUCLEUS_GRAPH_PATH || path.join(ROOT, 'canvas_graph.json')
const FIXTURE_GRAPH = path.join(ROOT, 'tests', 'fixtures', 'sample-graph.json')
const CACHE_DIR = path.join(ROOT, '.cache', 'synapse_teaching')
const COMMAND_TIMEOUT_MS = 120000
const MAX_STDOUT_BYTES = 50 * 1024 * 1024
const DEFAULT_MAX_LESSONS = 300
const CURRICULUM_LOGIC_VERSION = 17

const memory = {
  graphMeta: null,
  courses: null,
  curricula: new Map()
}

const inflight = {
  courses: null,
  curricula: new Map()
}

function graphExists() {
  return fs.existsSync(GRAPH_PATH)
}

function resolveGraphMeta() {
  const useFixture = !graphExists()
  const graphPath = useFixture ? FIXTURE_GRAPH : GRAPH_PATH
  const stat = fs.statSync(graphPath)
  return {
    graphPath,
    useFixture,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    logicVersion: CURRICULUM_LOGIC_VERSION
  }
}

function metaMatches(cachedMeta, liveMeta) {
  return Boolean(
    cachedMeta &&
    liveMeta &&
    cachedMeta.graphPath === liveMeta.graphPath &&
    cachedMeta.mtimeMs === liveMeta.mtimeMs &&
    cachedMeta.size === liveMeta.size &&
    cachedMeta.logicVersion === liveMeta.logicVersion
  )
}

function cacheMetaPath(kind, courseId = '') {
  const suffix = courseId ? `-${courseId}` : ''
  return path.join(CACHE_DIR, `${kind}${suffix}.meta.json`)
}

function cacheDataPath(kind, courseId = '') {
  const suffix = courseId ? `-${courseId}` : ''
  return path.join(CACHE_DIR, `${kind}${suffix}.json`)
}

function readDiskCache(kind, liveMeta, courseId = '') {
  try {
    const metaPath = cacheMetaPath(kind, courseId)
    const dataPath = cacheDataPath(kind, courseId)
    if (!fs.existsSync(metaPath) || !fs.existsSync(dataPath)) return null
    const cachedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    if (!metaMatches(cachedMeta, liveMeta)) return null
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  } catch (_error) {
    return null
  }
}

function writeDiskCache(kind, liveMeta, data, courseId = '') {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(cacheMetaPath(kind, courseId), JSON.stringify(liveMeta), 'utf8')
    fs.writeFileSync(cacheDataPath(kind, courseId), JSON.stringify(data), 'utf8')
  } catch (_error) {
    // Cache is best-effort; live fetch still works.
  }
}

function pythonEnv() {
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  }
}

function runTeachingCommand(args) {
  return new Promise((resolve) => {
    const child = spawn('python', ['-m', 'canvas_parser.synapse_teaching', ...args], {
      cwd: ROOT,
      env: pythonEnv(),
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let settled = false

    function finish(result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, error: 'synapse_teaching timed out' })
    }, COMMAND_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      stdoutBytes += Buffer.byteLength(text, 'utf8')
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        child.kill()
        finish({ ok: false, error: 'synapse_teaching output exceeded size limit' })
        return
      }
      stdout += text
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      finish({ ok: false, error: error.message || String(error) })
    })

    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        const detail = String(stderr || stdout || '').trim()
        finish({ ok: false, error: detail || `synapse_teaching exited with code ${code}` })
        return
      }
      try {
        finish({ ok: true, data: JSON.parse(stdout || '{}') })
      } catch (error) {
        finish({ ok: false, error: `Invalid JSON from synapse_teaching: ${error.message}` })
      }
    })
  })
}

function graphArgs(meta) {
  const args = []
  if (meta.useFixture) args.push('--fixture')
  else args.push('--graph', meta.graphPath)
  return args
}

async function fetchCoursesFromGraph(meta) {
  const args = ['list-courses', '--teachable-only', ...graphArgs(meta)]
  const result = await runTeachingCommand(args)
  if (!result.ok) return result
  const courses = result.data.courses || []
  memory.graphMeta = liveMetaSnapshot(meta)
  memory.courses = courses
  writeDiskCache('courses', meta, courses)
  return { ok: true, courses }
}

async function fetchCurriculumFromGraph(meta, courseId) {
  const id = String(courseId || '').trim()
  const args = [
    'curriculum',
    '--course-id', id,
    '--max-lessons', String(DEFAULT_MAX_LESSONS),
    ...graphArgs(meta)
  ]
  const result = await runTeachingCommand(args)
  if (!result.ok) return result
  const payload = {
    courseId: result.data.courseId || id,
    lessons: result.data.lessons || []
  }
  memory.curricula.set(id, payload)
  writeDiskCache('curriculum', meta, payload, id)
  return { ok: true, ...payload }
}

function liveMetaSnapshot(meta) {
  return {
    graphPath: meta.graphPath,
    mtimeMs: meta.mtimeMs,
    size: meta.size,
    logicVersion: CURRICULUM_LOGIC_VERSION
  }
}

function invalidateMemoryIfStale(meta) {
  if (!metaMatches(memory.graphMeta, meta)) {
    memory.graphMeta = null
    memory.courses = null
    memory.curricula.clear()
  }
}

async function listTeachingCourses(options = {}) {
  const meta = resolveGraphMeta()
  invalidateMemoryIfStale(meta)

  if (!options.refresh && memory.courses) {
    return { ok: true, courses: memory.courses, cached: true }
  }

  if (!options.refresh) {
    const diskCourses = readDiskCache('courses', meta)
    if (diskCourses) {
      memory.graphMeta = liveMetaSnapshot(meta)
      memory.courses = diskCourses
      return { ok: true, courses: diskCourses, cached: true }
    }
  }

  if (inflight.courses) return inflight.courses

  inflight.courses = fetchCoursesFromGraph(meta).finally(() => {
    inflight.courses = null
  })

  return inflight.courses
}

async function getTeachingCurriculum(courseId, options = {}) {
  const id = String(courseId || '').trim()
  if (!id) return { ok: false, error: 'courseId is required' }

  const meta = resolveGraphMeta()
  invalidateMemoryIfStale(meta)

  if (!options.refresh && memory.curricula.has(id)) {
    const cached = memory.curricula.get(id)
    return { ok: true, ...cached, cached: true }
  }

  if (!options.refresh) {
    const diskCurriculum = readDiskCache('curriculum', meta, id)
    if (diskCurriculum) {
      memory.graphMeta = liveMetaSnapshot(meta)
      memory.curricula.set(id, diskCurriculum)
      return { ok: true, ...diskCurriculum, cached: true }
    }
  }

  if (inflight.curricula.has(id)) return inflight.curricula.get(id)

  const pending = fetchCurriculumFromGraph(meta, id).finally(() => {
    inflight.curricula.delete(id)
  })
  inflight.curricula.set(id, pending)
  return pending
}

function prewarmTeachingCache() {
  return listTeachingCourses().catch(() => ({ ok: false }))
}

module.exports = {
  listTeachingCourses,
  getTeachingCurriculum,
  prewarmTeachingCache,
  graphExists,
  GRAPH_PATH,
  FIXTURE_GRAPH,
  CACHE_DIR,
  DEFAULT_MAX_LESSONS
}
