const fs = require('fs')
const path = require('path')

const MAIL_CACHE_ROOT = path.join(__dirname, '..', '..', '.cache', 'mail')
const MAIL_MESSAGES_DIR = path.join(MAIL_CACHE_ROOT, 'messages')
const MAIL_THREADS_DIR = path.join(MAIL_CACHE_ROOT, 'threads')
const MAIL_CLASSIFICATIONS_PATH = path.join(MAIL_CACHE_ROOT, 'classifications.json')
const LEGACY_CLASSIFICATIONS_PATH = path.join(__dirname, '..', '..', 'mail_classification_log.json')

const MESSAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CLASSIFICATION_SAVE_DEBOUNCE_MS = 400

const messageMemoryCache = new Map()
const threadMemoryCache = new Map()
let classificationMemoryCache = null
let classificationDirty = false
let classificationSaveTimer = null

function ensureDir(dirPath) {
    try {
        fs.mkdirSync(dirPath, { recursive: true })
    } catch (_) {}
}

function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        return parsed && typeof parsed === 'object' ? parsed : fallback
    } catch (_) {
        return fallback
    }
}

function writeJsonFile(filePath, value) {
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function loadClassificationMap() {
    if (classificationMemoryCache) return classificationMemoryCache
    const fromCache = readJsonFile(MAIL_CLASSIFICATIONS_PATH, null)
    if (fromCache && Object.keys(fromCache).length) {
        classificationMemoryCache = fromCache
        return classificationMemoryCache
    }
    classificationMemoryCache = readJsonFile(LEGACY_CLASSIFICATIONS_PATH, {})
    return classificationMemoryCache
}

function flushClassificationMap() {
    if (!classificationDirty || !classificationMemoryCache) return
    classificationDirty = false
    try {
        writeJsonFile(MAIL_CLASSIFICATIONS_PATH, classificationMemoryCache)
    } catch (_) {}
}

function scheduleClassificationSave() {
    classificationDirty = true
    if (classificationSaveTimer) return
    classificationSaveTimer = setTimeout(() => {
        classificationSaveTimer = null
        flushClassificationMap()
    }, CLASSIFICATION_SAVE_DEBOUNCE_MS)
}

function getCachedInboxCategory(messageId) {
    const map = loadClassificationMap()
    const record = map && messageId ? map[messageId] : null
    if (!record || typeof record !== 'object') return null
    return record.category || null
}

function setCachedInboxCategory(messageId, record) {
    if (!messageId || !record || typeof record !== 'object') return
    const map = loadClassificationMap()
    map[messageId] = record
    classificationMemoryCache = map
    scheduleClassificationSave()
}

function messageCachePath(id) {
    return path.join(MAIL_MESSAGES_DIR, `${id}.json`)
}

function threadCachePath(threadId) {
    return path.join(MAIL_THREADS_DIR, `${threadId}.json`)
}

function isFreshTimestamp(cachedAt, ttlMs = MESSAGE_CACHE_TTL_MS) {
    const ts = Number(cachedAt) || 0
    if (!ts) return false
    return Date.now() - ts <= ttlMs
}

function getCachedMessageDetail(id) {
    if (!id) return null
    const memory = messageMemoryCache.get(id)
    if (memory && memory.message) return memory.message

    const disk = readJsonFile(messageCachePath(id), null)
    if (!disk || !disk.message) return null
    messageMemoryCache.set(id, disk)
    return disk.message
}

function setCachedMessageDetail(id, message, meta = {}) {
    if (!id || !message) return
    const entry = {
        message,
        cachedAt: Date.now(),
        historyId: meta.historyId || ''
    }
    messageMemoryCache.set(id, entry)
    ensureDir(MAIL_MESSAGES_DIR)
    try {
        fs.writeFileSync(messageCachePath(id), JSON.stringify(entry), 'utf8')
    } catch (_) {}
}

function getCachedThread(threadId) {
    if (!threadId) return null
    const memory = threadMemoryCache.get(threadId)
    if (memory && memory.thread) return memory.thread

    const disk = readJsonFile(threadCachePath(threadId), null)
    if (!disk || !disk.thread) return null
    threadMemoryCache.set(threadId, disk)
    return disk.thread
}

function setCachedThread(threadId, thread) {
    if (!threadId || !thread) return
    const entry = {
        thread,
        cachedAt: Date.now()
    }
    threadMemoryCache.set(threadId, entry)
    ensureDir(MAIL_THREADS_DIR)
    try {
        fs.writeFileSync(threadCachePath(threadId), JSON.stringify(entry), 'utf8')
    } catch (_) {}
}

function shouldRefreshMessage(id, staleAfterMs = 5 * 60 * 1000) {
    const memory = messageMemoryCache.get(id)
    if (memory && isFreshTimestamp(memory.cachedAt, staleAfterMs)) return false
    const disk = readJsonFile(messageCachePath(id), null)
    if (disk && isFreshTimestamp(disk.cachedAt, staleAfterMs)) {
        messageMemoryCache.set(id, disk)
        return false
    }
    return true
}

module.exports = {
    MAIL_CLASSIFICATIONS_PATH,
    getCachedInboxCategory,
    setCachedInboxCategory,
    getCachedMessageDetail,
    setCachedMessageDetail,
    getCachedThread,
    setCachedThread,
    shouldRefreshMessage,
    flushClassificationMap
}
