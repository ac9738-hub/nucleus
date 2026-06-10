// Saved contact chat store for Gmail.
// Functionality: persists contacts + routed chat messages in mail_contacts.json,
// routes matching inbox senders into per-contact chat lists, and summarizes new mail.

const fs = require('fs')
const path = require('path')
const { extractEmail, getMailMessage } = require('./api')
const {
    summarizeEmailMessage,
    buildFallbackSummary,
    shouldSummarizeMailBody
} = require('./summarize')

const STORE_PATH = path.join(__dirname, '..', '..', 'mail_contacts.json')

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase()
}

function createEmptyStore() {
    return {
        contacts: {},
        chats: {}
    }
}

function loadStore() {
    try {
        if (!fs.existsSync(STORE_PATH)) {
            return createEmptyStore()
        }
        const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
        return {
            contacts: parsed && parsed.contacts && typeof parsed.contacts === 'object' ? parsed.contacts : {},
            chats: parsed && parsed.chats && typeof parsed.chats === 'object' ? parsed.chats : {}
        }
    } catch (_) {
        return createEmptyStore()
    }
}

function saveStore(store) {
    const payload = JSON.stringify(store, null, 2)
    fs.writeFileSync(STORE_PATH, payload, 'utf8')
}

function getContactLabel(contact) {
    if (!contact) return 'Contact'
    if (contact.name) return contact.name
    return contact.email || 'Contact'
}

function getAllRoutedMessageIds(store) {
    const ids = new Set()
    Object.values(store.chats || {}).forEach(entries => {
        if (!Array.isArray(entries)) return
        entries.forEach(entry => {
            if (entry && entry.messageId) ids.add(entry.messageId)
        })
    })
    return Array.from(ids)
}

function serializeContactsState(store) {
    const contacts = {}
    Object.keys(store.contacts || {}).sort().forEach(email => {
        const contact = store.contacts[email]
        contacts[email] = {
            email,
            name: contact && contact.name ? contact.name : '',
            label: getContactLabel({ email, name: contact && contact.name }),
            addedAt: contact && contact.addedAt ? contact.addedAt : ''
        }
    })

    const chats = {}
    Object.keys(store.chats || {}).forEach(email => {
        const entries = Array.isArray(store.chats[email]) ? store.chats[email] : []
        chats[email] = entries
            .slice()
            .sort((left, right) => {
                const leftTime = Date.parse(left && (left.date || left.addedAt)) || 0
                const rightTime = Date.parse(right && (right.date || right.addedAt)) || 0
                return leftTime - rightTime
            })
            .map(entry => ({
                messageId: entry.messageId,
                threadId: entry.threadId || '',
                subject: entry.subject || '',
                from: entry.from || '',
                sender: entry.sender || '',
                to: entry.to || '',
                date: entry.date || '',
                dateLabel: entry.dateLabel || '',
                snippet: entry.snippet || '',
                summary: entry.summary || '',
                summaryStatus: entry.summaryStatus || 'pending',
                direction: entry.direction || 'incoming',
                addedAt: entry.addedAt || ''
            }))
    })

    return {
        contacts,
        chats,
        routedMessageIds: getAllRoutedMessageIds(store)
    }
}

function hasChatMessage(store, contactEmail, messageId) {
    const entries = store.chats[contactEmail]
    if (!Array.isArray(entries)) return false
    return entries.some(entry => entry && entry.messageId === messageId)
}

function stripHtmlForPreview(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

function parseRecipientEmails(value) {
    return String(value || '')
        .split(/[,;]/)
        .map(part => normalizeEmail(extractEmail(part.trim())))
        .filter(email => email.includes('@'))
}

function buildOutgoingChatEntry(payload = {}, sentMessage = {}) {
    const bodyPreview = stripHtmlForPreview(payload.body)
    const now = new Date()
    const useRawSummary = bodyPreview && !shouldSummarizeMailBody(bodyPreview)

    return {
        messageId: sentMessage.id,
        threadId: sentMessage.threadId || payload.threadId || '',
        subject: sentMessage.subject || payload.subject || '',
        from: sentMessage.from || '',
        sender: sentMessage.sender || 'You',
        to: payload.to || '',
        date: sentMessage.date || now.toUTCString(),
        dateLabel: sentMessage.dateLabel || now.toLocaleString(),
        snippet: bodyPreview.slice(0, 240),
        summary: useRawSummary
            ? bodyPreview
            : '',
        summaryStatus: useRawSummary ? 'ready' : 'pending',
        direction: 'outgoing',
        addedAt: now.toISOString()
    }
}

function getMailContactsState() {
    return serializeContactsState(loadStore())
}

function addMailContact(payload = {}) {
    const email = normalizeEmail(payload.email)
    if (!email || !email.includes('@')) {
        throw new Error('A valid email address is required.')
    }

    const store = loadStore()
    const name = String(payload.name || '').trim()
    const existing = store.contacts[email] || {}

    store.contacts[email] = {
        email,
        name: name || existing.name || '',
        addedAt: existing.addedAt || new Date().toISOString()
    }

    if (!Array.isArray(store.chats[email])) {
        store.chats[email] = []
    }

    saveStore(store)
    return serializeContactsState(store)
}

function routeInboxMessages(messages = []) {
    const store = loadStore()
    const contactEmails = new Set(Object.keys(store.contacts || {}))
    const newEntries = []

    if (!contactEmails.size || !Array.isArray(messages) || !messages.length) {
        return { store, newEntries, state: serializeContactsState(store) }
    }

    messages.forEach(message => {
        if (!message || !message.id) return

        const senderEmail = normalizeEmail(extractEmail(message.from))
        if (!contactEmails.has(senderEmail)) return
        if (hasChatMessage(store, senderEmail, message.id)) return

        const entry = {
            messageId: message.id,
            threadId: message.threadId || '',
            subject: message.subject || '',
            from: message.from || '',
            sender: message.sender || '',
            date: message.date || '',
            dateLabel: message.dateLabel || '',
            snippet: message.snippet || '',
            summary: '',
            summaryStatus: 'pending',
            direction: 'incoming',
            addedAt: new Date().toISOString()
        }

        if (!Array.isArray(store.chats[senderEmail])) {
            store.chats[senderEmail] = []
        }

        store.chats[senderEmail].push(entry)
        newEntries.push({ contactEmail: senderEmail, entry })
    })

    if (newEntries.length) {
        saveStore(store)
    }

    return {
        store,
        newEntries,
        state: serializeContactsState(store)
    }
}

async function summarizeNewChatEntries(store, newEntries, onUpdate) {
    for (const item of newEntries) {
        const { contactEmail, entry } = item
        const entries = store.chats[contactEmail]
        const target = Array.isArray(entries)
            ? entries.find(row => row && row.messageId === entry.messageId)
            : null

        if (!target) continue

        target.summaryStatus = 'pending'
        saveStore(store)
        if (typeof onUpdate === 'function') {
            onUpdate(serializeContactsState(store))
        }

        try {
            const fullMessage = await getMailMessage(entry.messageId)
            target.subject = fullMessage.subject || target.subject
            target.from = fullMessage.from || target.from
            target.sender = fullMessage.sender || target.sender
            target.date = fullMessage.date || target.date
            target.dateLabel = fullMessage.dateLabel || target.dateLabel
            target.snippet = fullMessage.snippet || target.snippet
            target.summary = await summarizeEmailMessage({
                ...fullMessage,
                direction: target.direction || 'incoming'
            })
            target.summaryStatus = 'ready'
        } catch (_) {
            target.summary = buildFallbackSummary(target)
            target.summaryStatus = 'failed'
        }

        saveStore(store)
        if (typeof onUpdate === 'function') {
            onUpdate(serializeContactsState(store))
        }
    }
}

function startMailContactsSync(messages = [], onUpdate) {
    const { store, newEntries, state } = routeInboxMessages(messages)

    if (!newEntries.length) {
        return Promise.resolve(state)
    }

    return summarizeNewChatEntries(store, newEntries, onUpdate).then(() => serializeContactsState(loadStore()))
}

function addOutgoingMailToContactChat(payload = {}, sentMessage = {}) {
    const store = loadStore()
    const contactEmails = new Set(Object.keys(store.contacts || {}))
    const newEntries = []

    if (!contactEmails.size || !sentMessage || !sentMessage.id) {
        return { store, newEntries, state: serializeContactsState(store) }
    }

    const recipients = parseRecipientEmails(payload.to)
    let added = false

    recipients.forEach(contactEmail => {
        if (!contactEmails.has(contactEmail)) return
        if (hasChatMessage(store, contactEmail, sentMessage.id)) return

        const entry = buildOutgoingChatEntry(payload, sentMessage)
        if (!Array.isArray(store.chats[contactEmail])) {
            store.chats[contactEmail] = []
        }
        store.chats[contactEmail].push(entry)
        added = true
        if (entry.summaryStatus === 'pending') {
            newEntries.push({ contactEmail, entry })
        }
    })

    if (added) {
        saveStore(store)
    }

    return {
        store,
        newEntries,
        state: serializeContactsState(store)
    }
}

async function addOutgoingMailToContactChatAsync(payload = {}, sentMessage = {}, onUpdate) {
    const { store, newEntries, state } = addOutgoingMailToContactChat(payload, sentMessage)

    if (!newEntries.length) {
        return state
    }

    return summarizeNewChatEntries(store, newEntries, onUpdate).then(() => serializeContactsState(loadStore()))
}

module.exports = {
    STORE_PATH,
    getMailContactsState,
    addMailContact,
    addOutgoingMailToContactChat,
    addOutgoingMailToContactChatAsync,
    routeInboxMessages,
    startMailContactsSync,
    serializeContactsState,
    normalizeEmail
}
