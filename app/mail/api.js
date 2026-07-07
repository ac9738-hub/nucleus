const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')
const { BrowserWindow } = require('electron')
const {
    classifyInboxMessage,
    heuristicClassify,
    HEURISTIC_LLM_THRESHOLD,
    NON_ACADEMIC,
    CAMPUS_EVENTS,
    ACADEMIC,
    normalizeClassificationLabel,
    isInboxSplitFolder
} = require('./classify')
const {
    getCachedInboxCategory,
    setCachedInboxCategory,
    getCachedMessageDetail,
    setCachedMessageDetail,
    getCachedThread,
    setCachedThread,
    shouldRefreshMessage
} = require('./cache')
const {
    heuristicExtractEvents,
    extractMailEvents,
    messageLikelyHasEvents
} = require('./events')
const { getThemeRuntime, readThemeCss } = require('../../theme-manager')
const { escapeHtml } = require('../../lib/dom-utils')
const { FOLDER_LABELS, MAIL_FOLDERS } = require('../../lib/mail-folders')

// Project root for resolving the active theme's mail stylesheet.
const MAIL_THEME_ROOT = path.join(__dirname, '..', '..')

const GMAIL_BASE = 'https://www.googleapis.com/gmail/v1/users/me'

let token = null
let cachedMailCss = null
const MAIL_EVENTS_LOG_PATH = path.join(__dirname, '..', '..', 'mail_events_log.json')
let mailEventsById = null
const backgroundClassificationQueue = new Set()
const backgroundClassificationInflight = new Set()
const backgroundClassificationSummaries = new Map()

const GMAIL_MAX_CONCURRENT = 6
const GMAIL_METADATA_BATCH_SIZE = 20
const GMAIL_METADATA_HEADERS = ['From', 'To', 'Subject', 'Date', 'Cc', 'Message-ID', 'References']

let gmailInFlight = 0
const gmailWaitQueue = []

function getLoggedInboxCategory(messageId) {
    const category = getCachedInboxCategory(messageId)
    return category ? normalizeClassificationLabel(category) : null
}

function logInboxCategory(message, category, meta = {}) {
    if (!message || !message.id) return
    setCachedInboxCategory(message.id, {
        category: normalizeClassificationLabel(category),
        date: message.date || '',
        receivedAtMs: Number(message.receivedAtMs) || 0,
        confidence: Number(meta.confidence) || 0,
        reason: String(meta.reason || '').slice(0, 120),
        loggedAt: Date.now()
    })
}

function queueBackgroundClassification(message) {
    if (!message || !message.id || backgroundClassificationQueue.has(message.id)) return
    backgroundClassificationSummaries.set(message.id, message)
    backgroundClassificationQueue.add(message.id)
    void drainBackgroundClassificationQueue()
}

async function drainBackgroundClassificationQueue() {
    while (backgroundClassificationQueue.size) {
        const iterator = backgroundClassificationQueue.values()
        const messageId = iterator.next().value
        if (!messageId) break
        backgroundClassificationQueue.delete(messageId)
        if (backgroundClassificationInflight.has(messageId)) continue
        backgroundClassificationInflight.add(messageId)
        try {
            const summary = backgroundClassificationSummaries.get(messageId)
                || getCachedMessageDetail(messageId)
                || { id: messageId }
            backgroundClassificationSummaries.delete(messageId)
            const classification = await classifyInboxMessage(summary)
            logInboxCategory(summary, classification && classification.label, classification || {})
        } catch (_) {
        } finally {
            backgroundClassificationInflight.delete(messageId)
        }
    }
}

function filterMessagesByInboxFolder(messages, folder) {
    const list = Array.isArray(messages) ? messages : []
    if (folder === 'secondary') {
        return list.filter(message => message && message.inboxCategory === NON_ACADEMIC)
    }
    if (folder === 'campus_events') {
        return list.filter(message => message && message.inboxCategory === CAMPUS_EVENTS)
    }
    if (folder === 'inbox') {
        return list.filter(message => message && message.inboxCategory === ACADEMIC)
    }
    return list
}

function loadMailEventsLog() {
    if (mailEventsById) return mailEventsById
    try {
        if (!fs.existsSync(MAIL_EVENTS_LOG_PATH)) {
            mailEventsById = {}
            return mailEventsById
        }
        const parsed = JSON.parse(fs.readFileSync(MAIL_EVENTS_LOG_PATH, 'utf8'))
        mailEventsById = parsed && typeof parsed === 'object' ? parsed : {}
    } catch (_) {
        mailEventsById = {}
    }
    return mailEventsById
}

function saveMailEventsLog() {
    try {
        const map = loadMailEventsLog()
        fs.writeFileSync(MAIL_EVENTS_LOG_PATH, JSON.stringify(map, null, 2), 'utf8')
    } catch (_) {}
}

function getLoggedMailEvents(messageId) {
    const map = loadMailEventsLog()
    const record = map && messageId ? map[messageId] : null
    return record && Array.isArray(record.events) ? record.events : null
}

function logMailEvents(message, events) {
    if (!message || !message.id) return
    const map = loadMailEventsLog()
    map[message.id] = {
        events: Array.isArray(events) ? events : [],
        loggedAt: Date.now()
    }
    saveMailEventsLog()
}

function attachListEvents(message) {
    if (!message || message.inboxCategory === NON_ACADEMIC) {
        return { ...message, events: [] }
    }
    const cached = getLoggedMailEvents(message.id)
    if (cached) {
        return { ...message, events: cached }
    }
    if (!messageLikelyHasEvents(message)) {
        return { ...message, events: [] }
    }
    const events = heuristicExtractEvents(message)
    if (events.length) logMailEvents(message, events)
    return { ...message, events }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryableGmailError(status, message) {
    const text = String(message || '').toLowerCase()
    return status === 429
        || status === 503
        || text.includes('too many concurrent')
        || text.includes('rate limit')
        || text.includes('user-rate limit')
}

async function acquireGmailSlot() {
    if (gmailInFlight < GMAIL_MAX_CONCURRENT) {
        gmailInFlight += 1
        return
    }
    await new Promise(resolve => gmailWaitQueue.push(resolve))
    gmailInFlight += 1
}

function releaseGmailSlot() {
    gmailInFlight = Math.max(0, gmailInFlight - 1)
    const next = gmailWaitQueue.shift()
    if (next) next()
}

async function mapWithConcurrency(items, mapper, concurrency = GMAIL_MAX_CONCURRENT) {
    if (!items.length) return []
    const results = new Array(items.length)
    let index = 0
    const limit = Math.max(1, Math.min(concurrency, items.length))

    async function worker() {
        while (index < items.length) {
            const current = index
            index += 1
            results[current] = await mapper(items[current], current)
        }
    }

    await Promise.all(Array.from({ length: limit }, () => worker()))
    return results
}

function buildMetadataQueryString() {
    return `format=metadata&${GMAIL_METADATA_HEADERS.map(header => `metadataHeaders=${encodeURIComponent(header)}`).join('&')}`
}

function parseBatchMultipartResponse(responseText, responseContentType) {
    const boundaryMatch = String(responseContentType || '').match(/boundary=([^;\s]+)/i)
    if (!boundaryMatch) {
        throw new Error('Invalid Gmail batch response.')
    }

    const boundary = boundaryMatch[1].replace(/^"|"$/g, '')
    const parts = responseText.split(`--${boundary}`)
    const results = []

    for (const part of parts) {
        const trimmed = part.trim()
        if (!trimmed || trimmed === '--') continue

        const statusMatch = part.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/)
        const jsonMatch = part.match(/\{[\s\S]*\}/)
        if (!statusMatch || !jsonMatch) continue

        const status = Number(statusMatch[1])
        const payload = JSON.parse(jsonMatch[0])
        if (status < 200 || status >= 300) {
            const message = payload && payload.error && payload.error.message
                ? payload.error.message
                : `Gmail batch sub-request failed (${status})`
            throw new Error(message)
        }

        results.push(payload)
    }

    return results
}

const MAIL_AUTH_PATH = path.join(__dirname, '..', '..', 'mail_auth.json')
const MAIL_ENV_PATH = path.join(__dirname, '..', '..', '.env')
const GMAIL_AUTH_PARTITION = 'persist:nucleus-gmail-oauth'
const GMAIL_OAUTH_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_GMAIL_CLIENT_ID = '184291192111-g8r7ul70jbvn0jhsv64ums89q47udebb.apps.googleusercontent.com'
const DEFAULT_GMAIL_CLIENT_SECRET = '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'
const DEFAULT_GMAIL_REDIRECT_URI = 'http://localhost:3000/callback'

function parseEnvValue(value) {
    const text = String(value || '').trim()
    if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
        return text.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    return text
}

function loadEnvValue(name, fallback = '') {
    if (process.env[name]) return String(process.env[name]).trim()
    try {
        if (!fs.existsSync(MAIL_ENV_PATH)) return fallback
        const pattern = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*=\\s*(.*)\\s*$`)
        const lines = fs.readFileSync(MAIL_ENV_PATH, 'utf8').split(/\r?\n/)
        for (const line of lines) {
            const match = line.match(pattern)
            if (match) return parseEnvValue(match[1])
        }
    } catch (_) {}
    return fallback
}

function getGmailRedirectUri() {
    return loadEnvValue('GMAIL_REDIRECT_URI', DEFAULT_GMAIL_REDIRECT_URI)
}

function createOAuthClient() {
    return new google.auth.OAuth2(
        loadEnvValue('GMAIL_CLIENT_ID', DEFAULT_GMAIL_CLIENT_ID),
        loadEnvValue('GMAIL_CLIENT_SECRET', DEFAULT_GMAIL_CLIENT_SECRET),
        getGmailRedirectUri()
    )
}

const oauth2Client = createOAuthClient()

function parseOAuthCallbackUrl(callbackUrl, redirectUri = getGmailRedirectUri()) {
    const url = new URL(String(callbackUrl || ''))
    const expected = new URL(redirectUri)
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
        return { error: 'Unexpected Gmail OAuth redirect URL.' }
    }

    const oauthError = url.searchParams.get('error')
    if (oauthError) {
        const description = url.searchParams.get('error_description')
        return { error: description || oauthError }
    }

    const code = url.searchParams.get('code')
    if (!code) {
        return { error: 'Gmail auth callback did not include an authorization code.' }
    }

    return { code }
}

function loadSavedMailAuth() {
    try {
        if (!fs.existsSync(MAIL_AUTH_PATH)) return null
        const parsed = JSON.parse(fs.readFileSync(MAIL_AUTH_PATH, 'utf8'))
        if (!parsed || (!parsed.access_token && !parsed.refresh_token)) return null
        return parsed
    } catch (_) {
        return null
    }
}

function saveMailAuth(tokens) {
    if (!tokens || (!tokens.access_token && !tokens.refresh_token)) return
    fs.writeFileSync(MAIL_AUTH_PATH, JSON.stringify(tokens, null, 2), 'utf8')
}

function clearSavedMailAuth() {
    token = null
    oauth2Client.setCredentials({})
    try {
        if (fs.existsSync(MAIL_AUTH_PATH)) {
            fs.unlinkSync(MAIL_AUTH_PATH)
        }
    } catch (_) {}
}

function mergeMailAuthTokens(existing, incoming) {
    const next = { ...(existing || {}), ...(incoming || {}) }
    if (!next.refresh_token && existing && existing.refresh_token) {
        next.refresh_token = existing.refresh_token
    }
    return next
}

function setMailAuthTokens(tokens) {
    if (!tokens || !tokens.access_token) {
        token = null
        oauth2Client.setCredentials({})
        return false
    }

    token = tokens
    oauth2Client.setCredentials(tokens)
    return true
}

async function refreshMailAccessToken() {
    const saved = loadSavedMailAuth()
    if (!saved || !saved.refresh_token) return false

    setMailAuthTokens(saved)
    try {
        const { credentials } = await oauth2Client.refreshAccessToken()
        const merged = mergeMailAuthTokens(saved, credentials)
        setMailAuthTokens(merged)
        saveMailAuth(merged)
        return true
    } catch (error) {
        const message = String((error && error.message) || '').toLowerCase()
        if (message.includes('invalid_grant') || message.includes('token has been expired or revoked')) {
            clearSavedMailAuth()
        }
        return false
    }
}

oauth2Client.on('tokens', (tokens) => {
    const next = mergeMailAuthTokens(token || loadSavedMailAuth(), tokens)
    setMailAuthTokens(next)
    saveMailAuth(next)
})

const savedMailAuth = loadSavedMailAuth()
if (savedMailAuth && savedMailAuth.access_token) {
    setMailAuthTokens(savedMailAuth)
}

// Returns the active theme's mail stylesheet, prefixed with the app-wide :root
// palette tokens so embedded/standalone mail HTML matches the current theme.
// Cached per theme so a runtime switch picks up the new skin on next render.
function getMailCss() {
    let runtime = null
    try {
        runtime = getThemeRuntime(MAIL_THEME_ROOT)
    } catch (_error) {
        runtime = null
    }
    const themeName = runtime && runtime.name ? runtime.name : 'default'
    if (cachedMailCss && cachedMailCss.theme === themeName) {
        return cachedMailCss.css
    }

    const mailSheet = runtime && Array.isArray(runtime.rendererStylesheets)
        ? runtime.rendererStylesheets.find(href => href.endsWith('mail.css'))
        : null
    const themedCss = mailSheet ? readThemeCss(MAIL_THEME_ROOT, mailSheet, '') : ''
    const baseCss = themedCss || fs.readFileSync(path.join(__dirname, 'mail.css'), 'utf8')
    const varsCss = runtime && runtime.varsCss ? runtime.varsCss + '\n' : ''
    cachedMailCss = { theme: themeName, css: varsCss + baseCss }
    return cachedMailCss.css
}

function get_token() {
    return token && token.access_token ? token.access_token : null
}

function getHeader(message, name) {
    const headers = message && message.payload && Array.isArray(message.payload.headers)
        ? message.payload.headers
        : []
    const match = headers.find(header => header && header.name && header.name.toLowerCase() === name.toLowerCase())
    return match && match.value ? match.value : ''
}

function parseSender(fromValue) {
    const raw = String(fromValue || '').trim()
    if (!raw) return 'Unknown sender'
    const named = raw.match(/^(.+?)\s*<[^>]+>$/)
    if (named) return named[1].replace(/^["']|["']$/g, '').trim() || raw
    return raw
}

function extractEmail(value) {
    const raw = String(value || '').trim()
    const match = raw.match(/<([^>]+)>/)
    return match ? match[1].trim() : raw
}

function hasLabel(message, label) {
    return Array.isArray(message && message.labelIds) && message.labelIds.includes(label)
}

function formatMailDate(dateValue) {
    if (!dateValue) return ''
    const date = new Date(dateValue)
    if (Number.isNaN(date.getTime())) return ''

    const now = new Date()
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    }

    const sameYear = date.getFullYear() === now.getFullYear()
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' })
    })
}

function decodeBase64Url(data) {
    const normalized = String(data || '').replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
    return Buffer.from(normalized + padding, 'base64').toString('utf8')
}

function encodeBase64Url(value) {
    return Buffer.from(String(value || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
}

function extractBody(payload) {
    let html = ''
    let text = ''

    function walk(part) {
        if (!part) return
        const mime = String(part.mimeType || '')
        if (part.body && part.body.data) {
            const decoded = decodeBase64Url(part.body.data)
            if (mime === 'text/html' && !html) html = decoded
            if (mime === 'text/plain' && !text) text = decoded
        }
        if (Array.isArray(part.parts)) {
            part.parts.forEach(walk)
        }
    }

    walk(payload)
    return { html, text }
}

function extractAttachments(payload) {
    const attachments = []

    function walk(part) {
        if (!part) return
        const filename = String(part.filename || '').trim()
        if (filename && part.body && (part.body.attachmentId || Number(part.body.size) > 0)) {
            attachments.push({
                filename,
                mimeType: String(part.mimeType || ''),
                size: Number(part.body.size) || 0,
                attachmentId: part.body.attachmentId || ''
            })
        }
        if (Array.isArray(part.parts)) part.parts.forEach(walk)
    }

    walk(payload)
    return attachments
}

function formatAttachmentSize(bytes) {
    const size = Number(bytes) || 0
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatMessageSummary(message) {
    const receivedAtMs = Number(message && message.internalDate)
        || Date.parse(getHeader(message, 'Date'))
        || 0
    const attachments = message && message.payload ? extractAttachments(message.payload) : []
    return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds || [],
        snippet: message.snippet || '',
        subject: getHeader(message, 'Subject') || '(no subject)',
        from: getHeader(message, 'From'),
        sender: parseSender(getHeader(message, 'From')),
        to: getHeader(message, 'To'),
        date: getHeader(message, 'Date'),
        dateLabel: formatMailDate(getHeader(message, 'Date')),
        receivedAtMs,
        unread: hasLabel(message, 'UNREAD'),
        starred: hasLabel(message, 'STARRED'),
        hasAttachments: attachments.length > 0,
        attachmentCount: attachments.length,
        inboxCategory: 'academic'
    }
}

function formatMessageDetail(message) {
    const body = extractBody(message.payload)
    const attachments = extractAttachments(message.payload)
    return {
        ...formatMessageSummary(message),
        cc: getHeader(message, 'Cc'),
        bcc: getHeader(message, 'Bcc'),
        messageId: getHeader(message, 'Message-ID'),
        references: getHeader(message, 'References'),
        bodyHtml: body.html,
        bodyText: body.text,
        attachments: attachments.map(item => ({
            ...item,
            sizeLabel: formatAttachmentSize(item.size)
        }))
    }
}

async function gmailRequest(pathname, options = {}, attempt = 0) {
    const authtoken = get_token()
    if (!authtoken) {
        throw new Error('No token available')
    }

    await acquireGmailSlot()
    try {
        const response = await fetch(`${GMAIL_BASE}${pathname}`, {
            method: options.method || 'GET',
            headers: {
                Authorization: `Bearer ${authtoken}`,
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {})
            },
            body: options.body || undefined
        })

        if (response.status === 204) {
            return { ok: true }
        }

        const data = await response.json()
        if (!response.ok) {
            const message = data && data.error && data.error.message ? data.error.message : `Gmail API error ${response.status}`
            if (response.status === 401 && attempt === 0 && await refreshMailAccessToken()) {
                return gmailRequest(pathname, options, attempt + 1)
            }
            if (attempt < 3 && isRetryableGmailError(response.status, message)) {
                await sleep((attempt + 1) * 700 + Math.floor(Math.random() * 250))
                return gmailRequest(pathname, options, attempt + 1)
            }
            throw new Error(message)
        }

        return data
    } finally {
        releaseGmailSlot()
    }
}

async function gmailBatchGetMessages(ids, attempt = 0) {
    if (!ids.length) return []

    const authtoken = get_token()
    if (!authtoken) {
        throw new Error('No token available')
    }

    const boundary = `batch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const query = buildMetadataQueryString()
    const body = ids.map((id, index) => (
        `--${boundary}\r\n` +
        'Content-Type: application/http\r\n' +
        `Content-ID: <item${index}>\r\n` +
        '\r\n' +
        `GET /gmail/v1/users/me/messages/${id}?${query}\r\n`
    )).join('') + `--${boundary}--\r\n`

    await acquireGmailSlot()
    try {
        const response = await fetch('https://www.googleapis.com/batch/gmail/v1', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${authtoken}`,
                'Content-Type': `multipart/mixed; boundary=${boundary}`
            },
            body
        })

        const responseText = await response.text()
        const contentType = response.headers.get('content-type') || ''

        if (!response.ok) {
            let message = `Gmail batch error ${response.status}`
            try {
                const data = JSON.parse(responseText)
                if (data && data.error && data.error.message) message = data.error.message
            } catch (_) {}
            if (attempt < 3 && isRetryableGmailError(response.status, message)) {
                await sleep((attempt + 1) * 700 + Math.floor(Math.random() * 250))
                return gmailBatchGetMessages(ids, attempt + 1)
            }
            throw new Error(message)
        }

        const parsed = parseBatchMultipartResponse(responseText, contentType)
        if (parsed.length !== ids.length) {
            throw new Error('Gmail batch response was incomplete.')
        }
        return parsed
    } finally {
        releaseGmailSlot()
    }
}

async function batchGetMessageMetadata(ids) {
    const chunks = []
    for (let index = 0; index < ids.length; index += GMAIL_METADATA_BATCH_SIZE) {
        chunks.push(ids.slice(index, index + GMAIL_METADATA_BATCH_SIZE))
    }

    const messages = []
    for (const chunk of chunks) {
        try {
            const batchMessages = await gmailBatchGetMessages(chunk)
            messages.push(...batchMessages)
        } catch (_) {
            const fallback = await mapWithConcurrency(
                chunk,
                id => getMessageMetadata(id),
                Math.max(2, Math.floor(GMAIL_MAX_CONCURRENT / 2))
            )
            messages.push(...fallback)
        }
    }
    return messages
}

async function getProfile() {
    const profile = await gmailRequest('/profile')
    return {
        emailAddress: profile.emailAddress || '',
        messagesTotal: profile.messagesTotal || 0,
        threadsTotal: profile.threadsTotal || 0,
        historyId: profile.historyId || ''
    }
}

async function getLabelStats() {
    const data = await gmailRequest('/labels')
    const labels = Array.isArray(data.labels) ? data.labels : []
    const stats = {}
    labels.forEach(label => {
        if (!label || !label.id) return
        stats[label.id] = {
            id: label.id,
            name: label.name,
            type: label.type,
            messagesTotal: label.messagesTotal || 0,
            messagesUnread: label.messagesUnread || 0
        }
    })
    return stats
}

async function getMessageMetadata(id) {
    return gmailRequest(
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Cc&metadataHeaders=Message-ID&metadataHeaders=References`
    )
}

async function listMailMessages(options = {}) {
    const folder = options.folder || 'inbox'
    const q = String(options.q || '').trim()
    const maxResults = Number(options.maxResults) > 0 ? Number(options.maxResults) : 50
    const pageToken = options.pageToken || ''

    const params = new URLSearchParams({ maxResults: String(maxResults) })
    const normalizedFolder = (folder === 'secondary' || folder === 'campus_events') ? 'inbox' : folder
    const labelId = FOLDER_LABELS[normalizedFolder]
    if (labelId && !q) params.set('labelIds', labelId)
    if (q) params.set('q', q)
    if (pageToken) params.set('pageToken', pageToken)

    const list = await gmailRequest(`/messages?${params.toString()}`)
    const refs = Array.isArray(list.messages) ? list.messages : []
    const ids = refs.map(item => item && item.id).filter(Boolean)
    const messages = ids.length ? await batchGetMessageMetadata(ids) : []
    let summaries = messages.map(formatMessageSummary)
    if (isInboxSplitFolder(folder) && !q) {
        summaries = await classifyInboxMessages(summaries)
    } else {
        summaries = summaries.map(message => {
            const loggedCategory = getLoggedInboxCategory(message && message.id)
            const withCategory = loggedCategory
                ? { ...message, inboxCategory: loggedCategory }
                : message
            return attachListEvents(withCategory)
        })
    }
    if (!q && isInboxSplitFolder(folder)) {
        summaries = filterMessagesByInboxFolder(summaries, folder)
    }
    summaries.sort((a, b) => (Number(b && b.receivedAtMs) || 0) - (Number(a && a.receivedAtMs) || 0))
    return {
        messages: summaries,
        nextPageToken: list.nextPageToken || '',
        resultSizeEstimate: list.resultSizeEstimate || summaries.length
    }
}

async function classifyInboxMessages(messages, options = {}) {
    const list = Array.isArray(messages) ? messages : []
    if (!list.length) return list

    const classified = list.map(message => {
        if (!message) return message
        if (!Array.isArray(message.labelIds) || !message.labelIds.includes('INBOX')) {
            return { ...message, inboxCategory: ACADEMIC, events: [] }
        }

        const loggedCategory = getLoggedInboxCategory(message.id)
        let inboxCategory = loggedCategory
        if (!inboxCategory) {
            const heuristic = heuristicClassify(message)
            inboxCategory = normalizeClassificationLabel(heuristic && heuristic.label)
            logInboxCategory(message, inboxCategory, heuristic || {})
            if (!options.skipBackgroundLlm && heuristic.confidence < HEURISTIC_LLM_THRESHOLD) {
                queueBackgroundClassification(message)
            }
        }

        const withCategory = { ...message, inboxCategory }
        if (inboxCategory === NON_ACADEMIC) {
            return { ...withCategory, events: [] }
        }
        return attachListEvents(withCategory)
    })

    return classified
}

async function classifyNewIncomingInboxMessages(messages) {
    return classifyInboxMessages(messages)
}

async function fetchAndCacheMailMessage(id, options = {}) {
    const message = await gmailRequest(
        `/messages/${id}?format=full&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Cc&metadataHeaders=Bcc&metadataHeaders=Message-ID&metadataHeaders=References`
    )
    const detail = formatMessageDetail(message)
    const loggedCategory = getLoggedInboxCategory(detail.id)
    if (loggedCategory) {
        detail.inboxCategory = loggedCategory
    } else if (Array.isArray(detail.labelIds) && detail.labelIds.includes('INBOX')) {
        const heuristic = heuristicClassify(detail)
        detail.inboxCategory = normalizeClassificationLabel(heuristic && heuristic.label)
        logInboxCategory(detail, detail.inboxCategory, heuristic || {})
        if (heuristic.confidence < HEURISTIC_LLM_THRESHOLD) {
            queueBackgroundClassification(detail)
        }
    }

    if (detail.inboxCategory !== NON_ACADEMIC) {
        const cachedEvents = getLoggedMailEvents(detail.id)
        if (cachedEvents) {
            detail.events = cachedEvents
        } else if (options.skipEvents) {
            detail.events = messageLikelyHasEvents(detail) ? heuristicExtractEvents(detail) : []
        } else {
            detail.events = heuristicExtractEvents(detail)
            if (detail.events.length) {
                logMailEvents(detail, detail.events)
            } else if (messageLikelyHasEvents(detail)) {
                void extractMailEvents(detail, { allowLlm: true }).then(events => {
                    if (events.length) logMailEvents(detail, events)
                }).catch(() => {})
            }
        }
    } else {
        detail.events = []
    }

    setCachedMessageDetail(id, detail)
    return detail
}

async function getMailMessage(id) {
    const cached = getCachedMessageDetail(id)
    if (cached) {
        if (shouldRefreshMessage(id)) {
            void fetchAndCacheMailMessage(id, { skipEvents: true }).catch(() => {})
        }
        return cached
    }
    return fetchAndCacheMailMessage(id)
}

async function fetchAndCacheMailThread(threadId) {
    const thread = await gmailRequest(`/threads/${threadId}?format=full`)
    const messages = Array.isArray(thread.messages) ? thread.messages.map(formatMessageDetail) : []
    const payload = { id: thread.id, messages }
    setCachedThread(threadId, payload)
    messages.forEach(message => {
        if (message && message.id) {
            setCachedMessageDetail(message.id, message)
        }
    })
    return payload
}

async function getMailThread(threadId) {
    const cached = getCachedThread(threadId)
    if (cached) {
        void fetchAndCacheMailThread(threadId).catch(() => {})
        return cached
    }
    return fetchAndCacheMailThread(threadId)
}

async function prefetchMailMessages(ids = [], options = {}) {
    const unique = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))]
        .filter(id => !getCachedMessageDetail(id))
        .slice(0, Number(options.limit) > 0 ? Number(options.limit) : 24)
    if (!unique.length) return { ok: true, prefetched: 0 }

    await mapWithConcurrency(
        unique,
        id => fetchAndCacheMailMessage(id, { skipEvents: true }).catch(() => null),
        Math.max(1, Math.min(3, GMAIL_MAX_CONCURRENT))
    )
    return { ok: true, prefetched: unique.length }
}

function buildRawEmail({ from, to, cc, bcc, subject, body, inReplyTo, references }) {
    const lines = []
    if (from) lines.push(`From: ${from}`)
    lines.push(`To: ${to}`)
    if (cc) lines.push(`Cc: ${cc}`)
    if (bcc) lines.push(`Bcc: ${bcc}`)
    lines.push(`Subject: ${subject}`)
    if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`)
    if (references) lines.push(`References: ${references}`)
    lines.push('MIME-Version: 1.0')
    lines.push('Content-Type: text/html; charset="UTF-8"')
    lines.push('Content-Transfer-Encoding: 7bit')
    lines.push('')
    lines.push(body)
    return lines.join('\r\n')
}

async function sendMailMessage(payload = {}) {
    const profile = await getProfile()
    const from = profile.emailAddress || 'me'
    const to = String(payload.to || '').trim()
    const subject = String(payload.subject || '').trim()
    const body = String(payload.body || '').trim()

    if (!to) throw new Error('Recipient is required.')
    if (!subject) throw new Error('Subject is required.')
    if (!body) throw new Error('Message body is required.')

    const raw = buildRawEmail({
        from,
        to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject,
        body,
        inReplyTo: payload.inReplyTo,
        references: payload.references
    })

    const requestBody = { raw: encodeBase64Url(raw) }
    if (payload.threadId) requestBody.threadId = payload.threadId

    const sent = await gmailRequest('/messages/send', {
        method: 'POST',
        body: JSON.stringify(requestBody)
    })

    return formatMessageSummary(await getMessageMetadata(sent.id))
}

async function modifyMailMessage(id, changes = {}) {
    const addLabelIds = Array.isArray(changes.add) ? changes.add : []
    const removeLabelIds = Array.isArray(changes.remove) ? changes.remove : []
    const updated = await gmailRequest(`/messages/${id}/modify`, {
        method: 'POST',
        body: JSON.stringify({ addLabelIds, removeLabelIds })
    })
    return formatMessageSummary(updated)
}

async function trashMailMessage(id) {
    const updated = await gmailRequest(`/messages/${id}/trash`, { method: 'POST' })
    return formatMessageSummary(updated)
}

async function untrashMailMessage(id) {
    const updated = await gmailRequest(`/messages/${id}/untrash`, { method: 'POST' })
    return formatMessageSummary(updated)
}

async function deleteMailMessage(id) {
    await gmailRequest(`/messages/${id}`, { method: 'DELETE' })
    return { ok: true, id }
}

async function getMailViewData(options = {}) {
    const folder = options.folder || 'inbox'
    const q = String(options.q || '').trim()
    const [list, profile, labelStats] = await Promise.all([
        listMailMessages({ folder, q, maxResults: options.maxResults, pageToken: options.pageToken }),
        getProfile(),
        getLabelStats()
    ])

    return {
        folder,
        q,
        folders: MAIL_FOLDERS,
        profile,
        labelStats,
        messages: list.messages,
        nextPageToken: list.nextPageToken,
        resultSizeEstimate: list.resultSizeEstimate,
        academicEvents: (list.messages || [])
            .filter(message => message && message.inboxCategory === ACADEMIC)
            .flatMap(message => (Array.isArray(message.events) ? message.events : [])),
        campusEvents: (list.messages || [])
            .filter(message => message && message.inboxCategory === CAMPUS_EVENTS)
            .flatMap(message => (Array.isArray(message.events) ? message.events : []))
    }
}

function renderMailSidebar(viewData) {
    const labelStats = viewData && viewData.labelStats ? viewData.labelStats : {}
    const activeFolder = viewData && viewData.folder ? viewData.folder : 'inbox'
    const inboxUnread = labelStats.INBOX ? labelStats.INBOX.messagesUnread : 0

    const items = MAIL_FOLDERS.map(folder => {
        const activeClass = folder.id === activeFolder ? ' is-active' : ''
        const unread = folder.id === 'inbox' ? inboxUnread : 0
        const count = unread > 0 ? `<span class="mail-nav-count">${unread}</span>` : ''
        return (
            `<button type="button" class="mail-nav-item${activeClass}" data-mail-folder="${escapeHtml(folder.id)}">` +
            `<span class="mail-nav-icon" aria-hidden="true">${escapeHtml(folder.icon)}</span>` +
            `<span>${escapeHtml(folder.label)}</span>${count}</button>`
        )
    }).join('')

    return (
        '<aside class="mail-sidebar" aria-label="Mail folders">' +
        '<div class="mail-brand">' +
        '<span class="mail-brand-mark" aria-hidden="true"></span>' +
        '<div><p class="mail-eyebrow">Nucleus Mail</p><h2>Gmail</h2></div>' +
        '</div>' +
        '<button type="button" class="mail-compose-button" data-mail-compose>Compose</button>' +
        `<nav class="mail-nav">${items}</nav>` +
        '</aside>'
    )
}

function renderMailRow(message, selectedId) {
    const selected = selectedId && message.id === selectedId ? ' is-selected' : ''
    const unread = message.unread ? ' is-unread' : ''
    const starred = message.starred ? ' is-starred' : ''
    return (
        `<article class="mail-row${unread}${starred}${selected}" data-mail-id="${escapeHtml(message.id)}" data-mail-thread="${escapeHtml(message.threadId)}" tabindex="0" role="button">` +
        `<button type="button" class="mail-row-star-button" data-mail-star="${escapeHtml(message.id)}" aria-label="${message.starred ? 'Unstar' : 'Star'}">${message.starred ? '★' : '☆'}</button>` +
        `<span class="mail-row-sender">${escapeHtml(message.sender)}</span>` +
        `<span class="mail-row-subject">${escapeHtml(message.subject)}</span>` +
        `<span class="mail-row-snippet">${escapeHtml(message.snippet)}</span>` +
        `<time class="mail-row-date">${escapeHtml(message.dateLabel)}</time>` +
        '</article>'
    )
}

function folderTitle(folder, q) {
    if (q) return `Search: ${q}`
    const match = MAIL_FOLDERS.find(item => item.id === folder)
    return match ? match.label : 'Inbox'
}

function buildHtml(viewData, options = {}) {
    const embedStyles = options.embedStyles !== false
    const standalone = Boolean(options.standalone)
    const errorMessage = typeof viewData === 'string' ? viewData : (options.error || '')
    const data = typeof viewData === 'string' ? null : (viewData || {})
    const messages = data && Array.isArray(data.messages) ? data.messages : []
    const selectedId = options.selectedId || null
    const folder = data && data.folder ? data.folder : 'inbox'
    const q = data && data.q ? data.q : ''
    const title = folderTitle(folder, q)

    const body = (
        '<section class="mail-shell" data-mail-app>' +
        renderMailSidebar(data || { folder: 'inbox', labelStats: {} }) +
        '<main class="mail-main">' +
        '<header class="mail-toolbar">' +
        '<div class="mail-toolbar-copy">' +
        `<p class="mail-eyebrow">${q ? 'Search' : 'Primary'}</p>` +
        `<h1>${escapeHtml(title)}${messages.length ? ` <span>(${messages.length})</span>` : ''}</h1>` +
        '</div>' +
        '<div class="mail-toolbar-actions">' +
        `<input class="mail-search" type="search" placeholder="Search mail" aria-label="Search mail" data-mail-search value="${escapeHtml(q)}" />` +
        '<button type="button" class="mail-icon-button" data-mail-refresh>Refresh</button>' +
        '</div></header>' +
        (errorMessage
            ? `<div class="mail-list"><div class="mail-error"><h3>Unable to load mail</h3><p>${escapeHtml(errorMessage)}</p></div></div>`
            : (!messages.length
                ? '<div class="mail-list"><div class="mail-empty"><h3>No messages</h3><p>This folder is empty.</p></div></div>'
                : `<div class="mail-list"><div class="mail-list-header" aria-hidden="true"><span></span><span>From</span><span>Subject</span><span>Preview</span><span>Date</span></div>${messages.map(message => renderMailRow(message, selectedId)).join('')}</div>`)) +
        '</main></section>'
    )

    const styleBlock = embedStyles ? `<style>${getMailCss()}</style>` : ''
    if (!standalone) return `${styleBlock}${body}`
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Nucleus Mail</title>${styleBlock}</head><body>${body}</body></html>`
}

async function getInboxHtml(options = {}) {
    try {
        const viewData = await getMailViewData({ folder: 'inbox' })
        return buildHtml(viewData, { embedStyles: options.embedStyles })
    } catch (error) {
        return buildHtml(error.message, { embedStyles: options.embedStyles })
    }
}

async function exchangeGmailAuthCode(code) {
    const saved = loadSavedMailAuth()
    const { tokens } = await oauth2Client.getToken(code)
    const merged = mergeMailAuthTokens(saved, tokens)
    if (!merged.access_token && !merged.refresh_token) {
        throw new Error('Google did not return Gmail tokens.')
    }
    setMailAuthTokens(merged)
    saveMailAuth(merged)
    return merged
}

async function runGmailOAuthFlow() {
    const redirectUri = getGmailRedirectUri()
    const redirectPrefix = `${new URL(redirectUri).origin}${new URL(redirectUri).pathname}`
    const saved = loadSavedMailAuth()

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        include_granted_scopes: true,
        scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify'
        ],
        ...(!saved || !saved.refresh_token ? { prompt: 'consent' } : { prompt: 'select_account' })
    })

    return new Promise((resolve, reject) => {
        let settled = false

        const settle = (handler, value) => {
            if (settled) return
            settled = true
            cleanup()
            handler(value)
        }

        const authview = new BrowserWindow({
            width: 520,
            height: 720,
            show: true,
            autoHideMenuBar: true,
            title: 'Sign in to Gmail',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition: GMAIL_AUTH_PARTITION
            }
        })

        const requestFilter = { urls: [`${redirectPrefix}*`] }
        const onBeforeRequest = (details, callback) => {
            if (settled) {
                callback({})
                return
            }

            if (!String(details.url || '').startsWith(redirectPrefix)) {
                callback({})
                return
            }

            callback({ cancel: true })

            const parsed = parseOAuthCallbackUrl(details.url, redirectUri)
            if (parsed.error) {
                settle(reject, new Error(parsed.error))
                return
            }

            exchangeGmailAuthCode(parsed.code)
                .then(tokens => settle(resolve, tokens))
                .catch(error => settle(reject, error))
        }

        const cleanup = () => {
            clearTimeout(timeoutId)
            try {
                authview.webContents.session.webRequest.onBeforeRequest(requestFilter, null)
            } catch (_) {}
            if (authview && !authview.isDestroyed()) {
                authview.removeAllListeners('closed')
                authview.close()
            }
        }

        authview.on('closed', () => {
            settle(reject, new Error('Gmail sign-in window was closed before authentication finished.'))
        })

        const timeoutId = setTimeout(() => {
            settle(reject, new Error('Gmail sign-in timed out. Please try again.'))
        }, GMAIL_OAUTH_TIMEOUT_MS)

        authview.webContents.session.webRequest.onBeforeRequest(requestFilter, onBeforeRequest)
        authview.loadURL(authUrl).catch(error => {
            settle(reject, new Error(error && error.message ? error.message : 'Unable to open Gmail sign-in page.'))
        })
    })
}

async function creategmailauthview() {
    const tokens = await runGmailOAuthFlow()
    token = tokens
    return tokens
}

async function ensureMailAuth() {
    const saved = loadSavedMailAuth()
    if (saved) setMailAuthTokens(saved)

    if (get_token()) {
        try {
            await getProfile()
            return true
        } catch (_) {
            if (await refreshMailAccessToken()) {
                try {
                    await getProfile()
                    return true
                } catch (_) {}
            }
            clearSavedMailAuth()
        }
    } else if (saved && saved.refresh_token && await refreshMailAccessToken()) {
        try {
            await getProfile()
            return true
        } catch (_) {
            clearSavedMailAuth()
        }
    }

    await creategmailauthview()
    if (!get_token()) {
        throw new Error('Gmail authentication completed without an access token.')
    }

    try {
        await getProfile()
    } catch (error) {
        clearSavedMailAuth()
        throw new Error((error && error.message) || 'Gmail authentication failed.')
    }

    return true
}

// --- Inbox watcher (Gmail history delta sync) ---
// Polls users.history.list against a stored historyId to detect new/removed
// inbox messages, then pushes the deltas to the renderer via onDelta.

const MAIL_WATCH_DEFAULT_INTERVAL = 15000

let mailWatchTimer = null
let mailWatchHistoryId = null
let mailWatchPolling = false
let mailWatchOnDelta = null
let mailWatchIntervalMs = MAIL_WATCH_DEFAULT_INTERVAL

async function safeLabelStats() {
    try {
        return await getLabelStats()
    } catch (_) {
        return null
    }
}

async function listMailHistory(startHistoryId) {
    const events = []
    let pageToken = ''
    let latestHistoryId = startHistoryId

    do {
        const params = new URLSearchParams({ startHistoryId: String(startHistoryId), maxResults: '500' })
        params.append('historyTypes', 'messageAdded')
        params.append('historyTypes', 'messageDeleted')
        params.append('historyTypes', 'labelAdded')
        params.append('historyTypes', 'labelRemoved')
        if (pageToken) params.set('pageToken', pageToken)

        const data = await gmailRequest(`/history?${params.toString()}`)
        if (Array.isArray(data.history)) events.push(...data.history)
        if (data.historyId) latestHistoryId = data.historyId
        pageToken = data.nextPageToken || ''
    } while (pageToken)

    return { events, historyId: latestHistoryId }
}

function collectHistoryChanges(events) {
    const addedIds = new Set()
    const removedIds = new Set()

    events.forEach(item => {
        if (!item) return
        ;(item.messagesAdded || []).forEach(entry => {
            const msg = entry && entry.message
            if (msg && msg.id && Array.isArray(msg.labelIds) && msg.labelIds.includes('INBOX')) {
                addedIds.add(msg.id)
            }
        })
        ;(item.labelsAdded || []).forEach(entry => {
            const msg = entry && entry.message
            const labels = entry && Array.isArray(entry.labelIds) ? entry.labelIds : []
            if (msg && msg.id && labels.includes('INBOX')) addedIds.add(msg.id)
        })
        ;(item.messagesDeleted || []).forEach(entry => {
            const msg = entry && entry.message
            if (msg && msg.id) removedIds.add(msg.id)
        })
        ;(item.labelsRemoved || []).forEach(entry => {
            const msg = entry && entry.message
            const labels = entry && Array.isArray(entry.labelIds) ? entry.labelIds : []
            if (msg && msg.id && labels.includes('INBOX')) removedIds.add(msg.id)
        })
    })

    // A message that was added and then left the inbox in the same window is a removal.
    removedIds.forEach(id => addedIds.delete(id))
    return { addedIds, removedIds }
}

async function pollMailHistory() {
    if (mailWatchPolling || !get_token()) return null
    mailWatchPolling = true

    try {
        if (!mailWatchHistoryId) {
            const profile = await getProfile()
            mailWatchHistoryId = profile.historyId || null
            return null
        }

        let result
        try {
            result = await listMailHistory(mailWatchHistoryId)
        } catch (error) {
            // A 404 means the stored historyId is older than Gmail's retention
            // window; re-baseline and ask the renderer to reload from scratch.
            const message = String((error && error.message) || '').toLowerCase()
            if (message.includes('404') || message.includes('not found') || message.includes('invalid')) {
                const profile = await getProfile()
                mailWatchHistoryId = profile.historyId || null
                return { reset: true, historyId: mailWatchHistoryId, labelStats: await safeLabelStats() }
            }
            throw error
        }

        mailWatchHistoryId = result.historyId || mailWatchHistoryId

        const { addedIds, removedIds } = collectHistoryChanges(result.events)
        if (!addedIds.size && !removedIds.size) return null

        let added = []
        if (addedIds.size) {
            const metadata = await batchGetMessageMetadata([...addedIds])
            added = await classifyNewIncomingInboxMessages(metadata
                .map(formatMessageSummary)
                .filter(msg => Array.isArray(msg.labelIds) && msg.labelIds.includes('INBOX')))
            added.sort((a, b) => (Number(b && b.receivedAtMs) || 0) - (Number(a && a.receivedAtMs) || 0))
        }

        return {
            added,
            removedIds: [...removedIds],
            labelStats: await safeLabelStats(),
            historyId: mailWatchHistoryId
        }
    } finally {
        mailWatchPolling = false
    }
}

async function runMailWatchTick() {
    try {
        const delta = await pollMailHistory()
        if (delta && typeof mailWatchOnDelta === 'function') {
            mailWatchOnDelta(delta)
        }
    } catch (_) {
        // Swallow transient polling errors; the next tick retries.
    }
}

async function startMailWatcher(options = {}) {
    if (typeof options.onDelta === 'function') mailWatchOnDelta = options.onDelta
    const interval = Number(options.intervalMs)
    mailWatchIntervalMs = interval > 0 ? interval : MAIL_WATCH_DEFAULT_INTERVAL

    if (mailWatchTimer) {
        return { ok: true, historyId: mailWatchHistoryId }
    }

    // Seed the baseline historyId now so the first tick can already report deltas.
    if (!mailWatchHistoryId && get_token()) {
        try {
            const profile = await getProfile()
            mailWatchHistoryId = profile.historyId || null
        } catch (_) {}
    }

    mailWatchTimer = setInterval(runMailWatchTick, mailWatchIntervalMs)
    if (mailWatchTimer && typeof mailWatchTimer.unref === 'function') mailWatchTimer.unref()
    return { ok: true, historyId: mailWatchHistoryId }
}

function stopMailWatcher() {
    if (mailWatchTimer) {
        clearInterval(mailWatchTimer)
        mailWatchTimer = null
    }
    mailWatchOnDelta = null
    return { ok: true }
}

// Legacy aliases
async function getmail(options = {}) {
    return listMailMessages(options)
}

async function getmailmeta(id) {
    return getMessageMetadata(id)
}

module.exports = {
    creategmailauthview,
    get_token,
    ensureMailAuth,
    getMailViewData,
    getMailMessage,
    getMailThread,
    prefetchMailMessages,
    sendMailMessage,
    modifyMailMessage,
    trashMailMessage,
    untrashMailMessage,
    deleteMailMessage,
    startMailWatcher,
    stopMailWatcher,
    buildHtml,
    getInboxHtml,
    getmail,
    getmailmeta,
    extractEmail,
    MAIL_FOLDERS,
    FOLDER_LABELS,
    parseOAuthCallbackUrl,
    getGmailRedirectUri,
    exchangeGmailAuthCode,
    classifyInboxMessages
}
