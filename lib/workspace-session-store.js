// Persist workspace session state to disk (.cache/workspace_sessions.json).

const fs = require('fs')
const path = require('path')
const { normalizeSession, createDefaultSession } = require('./workspace-session')

function createWorkspaceSessionStore(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..')
  const cachePath = options.cachePath || path.join(rootDir, '.cache', 'workspace_sessions.json')
  const sessions = new Map()

  function load() {
    try {
      if (!fs.existsSync(cachePath)) return
      const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
      const entries = raw && typeof raw === 'object' ? raw.sessions : null
      if (!entries || typeof entries !== 'object') return
      for (const [workspaceId, session] of Object.entries(entries)) {
        sessions.set(String(workspaceId), normalizeSession(session, workspaceId))
      }
    } catch (error) {
      console.error('Unable to load workspace sessions:', error)
    }
  }

  function save() {
    try {
      const dir = path.dirname(cachePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const entries = {}
      for (const [workspaceId, session] of sessions.entries()) {
        entries[workspaceId] = session
      }
      fs.writeFileSync(cachePath, JSON.stringify({ sessions: entries }, null, 2), 'utf8')
    } catch (error) {
      console.error('Unable to save workspace sessions:', error)
    }
  }

  function get(workspaceId) {
    const id = String(workspaceId || '')
    if (!id) return createDefaultSession()
    if (!sessions.has(id)) {
      sessions.set(id, createDefaultSession(id))
    }
    return normalizeSession(sessions.get(id), id)
  }

  function set(workspaceId, session) {
    const id = String(workspaceId || '')
    if (!id) return null
    const next = normalizeSession(session, id)
    sessions.set(id, next)
    save()
    return next
  }

  function mergeFromRenderer(incoming) {
    if (!incoming || typeof incoming !== 'object') return
    for (const [workspaceId, session] of Object.entries(incoming)) {
      if (!workspaceId) continue
      sessions.set(String(workspaceId), normalizeSession(session, workspaceId))
    }
    save()
  }

  function getAll() {
    const out = {}
    for (const [workspaceId, session] of sessions.entries()) {
      out[workspaceId] = session
    }
    return out
  }

  load()

  return {
    cachePath,
    get,
    set,
    getAll,
    mergeFromRenderer,
    save
  }
}

module.exports = {
  createWorkspaceSessionStore
}
