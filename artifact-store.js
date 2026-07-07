// Student artifact persistence.
// Functionality: stores artifact metadata and generated files under userData/artifacts.
// Dependencies: Electron app.getPath('userData') from main.js initializer.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ARTIFACT_TYPES = new Set(['docx', 'pptx', 'latex', 'chart', 'graph', 'table', 'html', 'flashcards'])

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'artifact'
}

function createArtifactStore({ rootDir }) {
  const artifactsDir = path.join(rootDir, 'artifacts')
  const filesDir = path.join(artifactsDir, 'files')
  const indexPath = path.join(artifactsDir, 'index.json')

  function ensureDirs() {
    fs.mkdirSync(filesDir, { recursive: true })
  }

  function readIndex() {
    ensureDirs()
    if (!fs.existsSync(indexPath)) {
      return { version: 1, artifacts: [] }
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      return {
        version: 1,
        artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : []
      }
    } catch {
      return { version: 1, artifacts: [] }
    }
  }

  function writeIndex(index) {
    ensureDirs()
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8')
  }

  function newId() {
    return `art_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
  }

  function artifactDir(id) {
    return path.join(filesDir, id)
  }

  function getById(id) {
    const index = readIndex()
    return index.artifacts.find(item => item.id === id) || null
  }

  function listArtifacts(filters = {}) {
    const index = readIndex()
    let items = [...index.artifacts]
    if (filters.workspaceId) {
      items = items.filter(item => item.workspaceId === filters.workspaceId)
    }
    if (filters.courseId) {
      items = items.filter(item => item.courseId === filters.courseId)
    }
    if (filters.type) {
      items = items.filter(item => item.type === filters.type)
    }
    items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    const limit = Number.isFinite(filters.limit) ? Math.max(1, Math.min(filters.limit, 200)) : 80
    return items.slice(0, limit)
  }

  function upsertArtifact(record) {
    const index = readIndex()
    const now = new Date().toISOString()
    const existingIndex = index.artifacts.findIndex(item => item.id === record.id)
    const base = existingIndex >= 0 ? index.artifacts[existingIndex] : null
    const next = {
      id: record.id || newId(),
      title: record.title || 'Untitled artifact',
      type: record.type,
      workspaceId: record.workspaceId || base?.workspaceId || '',
      courseId: record.courseId || base?.courseId || '',
      description: record.description || base?.description || '',
      previewPath: record.previewPath || base?.previewPath || '',
      downloadPath: record.downloadPath || base?.downloadPath || '',
      mimeType: record.mimeType || base?.mimeType || 'text/html',
      createdAt: base?.createdAt || now,
      updatedAt: now
    }
    if (!ARTIFACT_TYPES.has(next.type)) {
      throw new Error(`Unsupported artifact type: ${next.type}`)
    }
    if (existingIndex >= 0) {
      index.artifacts[existingIndex] = next
    } else {
      index.artifacts.push(next)
    }
    writeIndex(index)
    return next
  }

  function deleteArtifact(id) {
    const index = readIndex()
    const existingIndex = index.artifacts.findIndex(item => item.id === id)
    if (existingIndex === -1) {
      return { ok: false, error: 'Artifact not found.' }
    }
    const [removed] = index.artifacts.splice(existingIndex, 1)
    writeIndex(index)
    const dir = artifactDir(id)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    return { ok: true, artifact: removed }
  }

  function resolveArtifactPath(relativePath) {
    if (!relativePath) return ''
    const full = path.join(artifactsDir, relativePath)
    const normalizedRoot = path.resolve(artifactsDir)
    const normalizedFull = path.resolve(full)
    if (!normalizedFull.startsWith(normalizedRoot)) {
      return ''
    }
    return normalizedFull
  }

  function relativeArtifactPath(absolutePath) {
    if (!absolutePath) return ''
    return path.relative(artifactsDir, absolutePath).split(path.sep).join('/')
  }

  function ensureArtifactDir(id) {
    const dir = artifactDir(id)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  function buildFilename(title, ext) {
    return `${slugify(title)}.${ext}`
  }

  return {
    ARTIFACT_TYPES,
    artifactsDir,
    readIndex,
    getById,
    listArtifacts,
    upsertArtifact,
    deleteArtifact,
    resolveArtifactPath,
    relativeArtifactPath,
    ensureArtifactDir,
    buildFilename,
    newId
  }
}

module.exports = {
  createArtifactStore,
  ARTIFACT_TYPES
}
