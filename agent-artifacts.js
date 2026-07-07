// Agent artifact orchestration for the Electron main process.
// Functionality: creates/updates student artifacts via Node or Python generators.
// Dependencies: artifact-store.js, artifact-generators.js, agent_artifacts/build.py.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { generateInProcessArtifact, writePreviewFile } = require('./artifact-generators')
const {
  buildFlashcardsFromGraph,
  mergeFlashcardContent,
  resolveGraphPath,
  loadGraphFromPath
} = require('./artifact-graph-flashcards')

const IN_PROCESS_TYPES = new Set(['table', 'chart', 'graph', 'html', 'latex', 'flashcards'])
const PYTHON_TYPES = new Set(['docx', 'pptx'])

function createAgentArtifacts({ store, repoRoot }) {
  const pythonScript = path.join(repoRoot, 'agent_artifacts', 'build.py')

  function runPythonBuild(payload) {
    const proc = spawnSync('python', [pythonScript], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    })
    if (proc.error) {
      throw proc.error
    }
    if (proc.status !== 0) {
      const stderr = String(proc.stderr || '').trim()
      throw new Error(stderr || `Python artifact build failed with code ${proc.status}`)
    }
    const stdout = String(proc.stdout || '').trim()
    if (!stdout) {
      throw new Error('Python artifact build returned no output.')
    }
    return JSON.parse(stdout)
  }

  function writeBinaryArtifact(dir, filename, buffer) {
    const fullPath = path.join(dir, filename)
    fs.writeFileSync(fullPath, buffer)
    return fullPath
  }

  function resolveFlashcardContent(content = {}) {
    const next = { ...content }
    if (!(next.from_graph || next.fromGraph)) return next
    const graphPath = next.graph_path || next.graphPath || resolveGraphPath(repoRoot)
    const graph = loadGraphFromPath(graphPath)
    const graphResult = buildFlashcardsFromGraph(graph, {
      ...next,
      courseId: next.courseId || next.course_id || ''
    })
    const merged = mergeFlashcardContent(graphResult, next)
    delete merged.from_graph
    delete merged.fromGraph
    return merged
  }

  function buildArtifactRecord({
    id,
    title,
    type,
    workspaceId = '',
    courseId = '',
    description = '',
    content = {}
  }) {
    if (!store.ARTIFACT_TYPES.has(type)) {
      throw new Error(`Unsupported artifact type: ${type}`)
    }
    const artifactId = id || store.newId()
    const dir = store.ensureArtifactDir(artifactId)

    if (IN_PROCESS_TYPES.has(type)) {
      let resolvedContent = { ...content, title: content.title || title }
      if (type === 'flashcards') {
        resolvedContent = resolveFlashcardContent(resolvedContent)
        resolvedContent.courseId = resolvedContent.courseId || resolvedContent.course_id || courseId || ''
        resolvedContent.title = resolvedContent.title || title
      }
      const generated = generateInProcessArtifact(type, resolvedContent)
      const previewName = store.buildFilename(title, 'preview.html')
      const previewPath = writePreviewFile(dir, previewName, generated.previewHtml)
      let downloadPath = previewPath
      if (type === 'latex' && generated.payload?.source) {
        downloadPath = path.join(dir, store.buildFilename(title, 'tex'))
        fs.writeFileSync(downloadPath, generated.payload.source, 'utf8')
      } else if (type === 'flashcards' && generated.payload) {
        downloadPath = path.join(dir, store.buildFilename(title, 'json'))
        fs.writeFileSync(downloadPath, JSON.stringify(generated.payload, null, 2), 'utf8')
        if (generated.exports?.ankiTsv) {
          fs.writeFileSync(path.join(dir, store.buildFilename(title, 'anki.tsv')), generated.exports.ankiTsv, 'utf8')
        }
        if (generated.exports?.quizletCsv) {
          fs.writeFileSync(path.join(dir, store.buildFilename(title, 'quizlet.csv')), generated.exports.quizletCsv, 'utf8')
        }
      } else if (generated.downloadExt !== 'html') {
        downloadPath = path.join(dir, store.buildFilename(title, generated.downloadExt))
        fs.copyFileSync(previewPath, downloadPath)
      } else {
        downloadPath = path.join(dir, store.buildFilename(title, 'html'))
        fs.copyFileSync(previewPath, downloadPath)
      }
      return store.upsertArtifact({
        id: artifactId,
        title,
        type,
        workspaceId,
        courseId,
        description,
        previewPath: store.relativeArtifactPath(previewPath),
        downloadPath: store.relativeArtifactPath(downloadPath),
        mimeType: generated.mimeType
      })
    }

    if (PYTHON_TYPES.has(type)) {
      const result = runPythonBuild({
        id: artifactId,
        title,
        type,
        output_dir: dir,
        content: { ...content, title: content.title || title }
      })
      return store.upsertArtifact({
        id: artifactId,
        title,
        type,
        workspaceId,
        courseId,
        description,
        previewPath: result.previewPath || '',
        downloadPath: result.downloadPath || '',
        mimeType: result.mimeType || 'application/octet-stream'
      })
    }

    throw new Error(`No builder registered for artifact type: ${type}`)
  }

  function updateArtifactRecord({
    id,
    title,
    content = {},
    description = ''
  }) {
    const existing = store.getById(id)
    if (!existing) {
      throw new Error('Artifact not found.')
    }
    return buildArtifactRecord({
      id,
      title: title || existing.title,
      type: existing.type,
      workspaceId: existing.workspaceId,
      courseId: existing.courseId,
      description: description || existing.description,
      content
    })
  }

  function getArtifactForTool(id) {
    const artifact = store.getById(id)
    if (!artifact) {
      return { ok: false, error: 'Artifact not found.' }
    }
    return {
      ok: true,
      artifact: {
        id: artifact.id,
        title: artifact.title,
        type: artifact.type,
        workspaceId: artifact.workspaceId,
        courseId: artifact.courseId,
        description: artifact.description,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt
      }
    }
  }

  function listArtifactsForTool(filters = {}) {
    return {
      ok: true,
      artifacts: store.listArtifacts(filters).map(item => ({
        id: item.id,
        title: item.title,
        type: item.type,
        workspaceId: item.workspaceId,
        courseId: item.courseId,
        updatedAt: item.updatedAt
      }))
    }
  }

  function getArtifactPreviewPayload(id) {
    const artifact = store.getById(id)
    if (!artifact) {
      return { ok: false, error: 'Artifact not found.' }
    }
    const previewAbs = store.resolveArtifactPath(artifact.previewPath)
    const downloadAbs = store.resolveArtifactPath(artifact.downloadPath)
    return {
      ok: true,
      artifact,
      previewAbs,
      downloadAbs
    }
  }

  return {
    buildArtifactRecord,
    updateArtifactRecord,
    getArtifactForTool,
    listArtifactsForTool,
    getArtifactPreviewPayload
  }
}

module.exports = {
  createAgentArtifacts,
  IN_PROCESS_TYPES,
  PYTHON_TYPES
}
