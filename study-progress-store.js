// Durable study-section progress store.
// Keeps Canvas-derived study task progress across task refreshes and app restarts.
const fs = require('fs')
const path = require('path')

function readProgressFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { tasks: {} }
    }
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = raw.trim() ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && parsed.tasks && typeof parsed.tasks === 'object'
      ? parsed
      : { tasks: {} }
  } catch (error) {
    console.error('Unable to read study progress:', error)
    return { tasks: {} }
  }
}

function normalizeProgress(progress) {
  if (!progress || typeof progress !== 'object') {
    return null
  }

  const completedSectionIds = Array.from(new Set(
    (Array.isArray(progress.completedSectionIds) ? progress.completedSectionIds : [])
      .map(value => String(value))
      .filter(Boolean)
  ))
  const updatedAt = progress.updatedAt ? String(progress.updatedAt) : new Date().toISOString()
  return { completedSectionIds, updatedAt }
}

function writeProgressFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  fs.renameSync(tmpPath, filePath)
}

function createStudyProgressStore(filePath) {
  let state = readProgressFile(filePath)

  function persist() {
    try {
      writeProgressFile(filePath, state)
    } catch (error) {
      console.error('Unable to persist study progress:', error)
    }
  }

  return {
    get(taskId) {
      const progress = state.tasks[String(taskId)]
      return progress ? { ...progress, completedSectionIds: [...(progress.completedSectionIds || [])] } : null
    },

    set(taskId, progress) {
      const normalized = normalizeProgress(progress)
      if (!normalized) return
      state.tasks[String(taskId)] = normalized
      persist()
    }
  }
}

module.exports = {
  createStudyProgressStore,
  readProgressFile,
  normalizeProgress
}
