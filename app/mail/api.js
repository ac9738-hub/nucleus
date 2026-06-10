const http = require('http')
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')
const { BrowserWindow } = require('electron')

const GMAIL_BASE = 'https://www.googleapis.com/gmail/v1/users/me'

const FOLDER_LABELS = {
    inbox: 'INBOX',
    starred: 'STARRED',
    sent: 'SENT',
    drafts: 'DRAFT',
    spam: 'SPAM',
    trash: 'TRASH'
}

const MAIL_FOLDERS = [
    { id: 'inbox', label: 'Inbox', icon: 'IN' },
    { id: 'starred', label: 'Starred', icon: '★' },
    { id: 'sent', label: 'Sent', icon: '→' },
    { id: 'drafts', label: 'Drafts', icon: '✎' },
    { id: 'spam', label: 'Spam', icon: '!' },
    { id: 'trash', label: 'Trash', icon: '⌫' }
]

let token = null
let cachedMailCss = null

const GMAIL_MAX_CONCURRENT = 6
const GMAIL_METADATA_BATCH_SIZE = 20
const GMAIL_METADATA_HEADERS = ['From', 'To', 'Subject', 'Date', 'Cc', 'Message-ID', 'References']

let gmailInFlight = 0
const gmailWaitQueue = []

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

const oauth2Client = new google.auth.OAuth2(
    '184291192111-g8r7ul70jbvn0jhsv64ums89q47udebb.apps.googleusercontent.com',
    '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',
    'http://localhost:3000/callback'
)

function loadSavedMailAuth() {
    try {
        if (!fs.existsSync(MAIL_AUTH_PATH)) return null
        const parsed = JSON.parse(fs.readFileSync(MAIL_AUTH_PATH, 'utf8'))
        if (!parsed || !parsed.access_token) return null
        return parsed
    } catch (_) {
        return null
    }
}

function saveMailAuth(tokens) {
    if (!tokens || !tokens.access_token) return
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

oauth2Client.on('tokens', (tokens) => {
    const next = { ...(token || {}), ...tokens }
    if (tokens.refresh_token) {
        next.refresh_token = tokens.refresh_token
    }
    setMailAuthTokens(next)
    saveMailAuth(next)
})

const savedMailAuth = loadSavedMailAuth()
if (savedMailAuth) {
    setMailAuthTokens(savedMailAuth)
}

function getMailCss() {
    if (!cachedMailCss) {
        cachedMailCss = fs.readFileSync(path.join(__dirname, 'mail.css'), 'utf8')
    }
    return cachedMailCss
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
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

function formatMessageSummary(message) {
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
        unread: hasLabel(message, 'UNREAD'),
        starred: hasLabel(message, 'STARRED')
    }
}

function formatMessageDetail(message) {
    const body = extractBody(message.payload)
    return {
        ...formatMessageSummary(message),
        cc: getHeader(message, 'Cc'),
        bcc: getHeader(message, 'Bcc'),
        messageId: getHeader(message, 'Message-ID'),
        references: getHeader(message, 'References'),
        bodyHtml: body.html,
        bodyText: body.text
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
    const labelId = FOLDER_LABELS[folder]
    if (labelId && !q) params.set('labelIds', labelId)
    if (q) params.set('q', q)
    if (pageToken) params.set('pageToken', pageToken)

    const list = await gmailRequest(`/messages?${params.toString()}`)
    const refs = Array.isArray(list.messages) ? list.messages : []
    const ids = refs.map(item => item && item.id).filter(Boolean)
    const messages = ids.length ? await batchGetMessageMetadata(ids) : []
    return {
        messages: messages.map(formatMessageSummary),
        nextPageToken: list.nextPageToken || '',
        resultSizeEstimate: list.resultSizeEstimate || messages.length
    }
}

async function getMailMessage(id) {
    const message = await gmailRequest(
        `/messages/${id}?format=full&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Cc&metadataHeaders=Bcc&metadataHeaders=Message-ID&metadataHeaders=References`
    )
    return formatMessageDetail(message)
}

async function getMailThread(threadId) {
    const thread = await gmailRequest(`/threads/${threadId}?format=full`)
    const messages = Array.isArray(thread.messages) ? thread.messages.map(formatMessageDetail) : []
    return { id: thread.id, messages }
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
        resultSizeEstimate: list.resultSizeEstimate
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

async function creategmailauthview() {
    const saved = loadSavedMailAuth()
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        ...(!saved || !saved.refresh_token ? { prompt: 'consent' } : {}),
        scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify'
        ]
    })

    const authview = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: { nodeIntegration: false }
    })

    authview.loadURL(authUrl)
    token = await startCallbackServer(authview)
    return token
}

async function startCallbackServer(authview) {
    return new Promise((resolve) => {
        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url, 'http://localhost:3000/')
            const code = url.searchParams.get('code')
            if (!code) return

            const { tokens } = await oauth2Client.getToken(code)
            setMailAuthTokens(tokens)
            saveMailAuth(tokens)

            res.end('Auth complete, you can close this window.')
            server.close()
            authview.close()
            resolve(tokens)
        })

        server.listen(3000)
    })
}

async function ensureMailAuth() {
    if (!get_token()) {
        const saved = loadSavedMailAuth()
        if (saved) setMailAuthTokens(saved)
    }

    if (get_token()) {
        try {
            await getProfile()
            return true
        } catch (_) {
            clearSavedMailAuth()
        }
    }

    await creategmailauthview()
    return Boolean(get_token())
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
    sendMailMessage,
    modifyMailMessage,
    trashMailMessage,
    untrashMailMessage,
    deleteMailMessage,
    buildHtml,
    getInboxHtml,
    getmail,
    getmailmeta,
    extractEmail,
    MAIL_FOLDERS,
    FOLDER_LABELS
}
