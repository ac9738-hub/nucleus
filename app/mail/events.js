// Academic mail event extraction.
// Functionality: detect deadlines, exams, meetings, and other dated items in Gmail messages.

const OLLAMA_CHAT_URL = process.env.OLLAMA_CHAT_URL || 'http://127.0.0.1:11434/api/chat'
const OLLAMA_MAIL_EVENTS_MODEL = process.env.OLLAMA_MAIL_EVENTS_MODEL
    || process.env.OLLAMA_MAIL_CLASSIFY_MODEL
    || 'llama3.2:3b'

const EVENT_TYPES = new Set([
    'deadline',
    'exam',
    'meeting',
    'office_hours',
    'submission',
    'lecture',
    'reminder'
])

const MONTH_MAP = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
}

const EVENT_SIGNAL_PATTERN = new RegExp(
    [
        '\\b(?:due|deadline|submit(?:ted)?\\s+by|exam|midterm|final\\s+exam|quiz|test)\\b',
        '\\b(?:meeting|office\\s+hours|zoom|teams|lecture|seminar|section)\\b',
        '\\b(?:reminder|rsvp|attend|schedule[d]?)\\b'
    ].join('|'),
    'i'
)

const TYPE_RULES = [
    { type: 'exam', pattern: /\b(?:midterm|final\s+exam|finals?\b|quiz|exam|test)\b/i },
    { type: 'office_hours', pattern: /\boffice\s+hours?\b/i },
    { type: 'meeting', pattern: /\b(?:meeting|zoom|teams|sync|call|conference)\b/i },
    { type: 'lecture', pattern: /\b(?:lecture|seminar|section|recitation|lab\s+session)\b/i },
    { type: 'deadline', pattern: /\b(?:due|deadline|by\s+(?:mon|tue|wed|thu|fri|sat|sun)\b)/i },
    { type: 'submission', pattern: /\b(?:submit|submission|turn\s+in|hand\s+in)\b/i },
    { type: 'reminder', pattern: /\b(?:reminder|don'?t\s+forget|upcoming)\b/i }
]

const MAIL_EVENTS_SYSTEM_PROMPT = [
    'Extract dated academic events from an email.',
    'Return STRICT JSON only:',
    '{"events":[{"type":"deadline|exam|meeting|office_hours|submission|lecture|reminder","title":"short label","date":"YYYY-MM-DD or empty","time":"HH:MM or empty","confidence":0.0}]}',
    '',
    'Rules:',
    '- Only include real scheduled items with a date or clear time reference',
    '- type must be one of the allowed values',
    '- title <= 80 chars, plain text',
    '- confidence 0 to 1',
    '- max 5 events',
    '- no markdown or prose outside JSON'
].join('\n')

function stripHtml(value) {
    return String(value || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim()
}

function getMessageText(message) {
    const subject = String(message && message.subject || '').trim()
    const body = String(message && message.bodyText || '').trim()
        || stripHtml(message && message.bodyHtml)
        || String(message && message.snippet || '').trim()
    return { subject, body, combined: `${subject}\n${body}`.trim() }
}

function defaultYear(referenceMs) {
    const ref = Number(referenceMs) > 0 ? new Date(referenceMs) : new Date()
    return ref.getFullYear()
}

function pad2(value) {
    return String(value).padStart(2, '0')
}

function formatIsoDate(year, month, day) {
    if (!year || !month || !day) return ''
    if (month < 1 || month > 12 || day < 1 || day > 31) return ''
    return `${year}-${pad2(month)}-${pad2(day)}`
}

function formatDateLabel(isoDate) {
    if (!isoDate) return ''
    const date = new Date(`${isoDate}T12:00:00`)
    if (Number.isNaN(date.getTime())) return isoDate
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function inferYear(month, day, referenceMs) {
    let year = defaultYear(referenceMs)
    const ref = Number(referenceMs) > 0 ? new Date(referenceMs) : new Date()
    const candidate = new Date(year, month - 1, day, 12, 0, 0)
    if (candidate.getTime() < ref.getTime() - (120 * 24 * 60 * 60 * 1000)) {
        year += 1
    }
    return year
}

function parseMonthName(token) {
    return MONTH_MAP[String(token || '').toLowerCase()] || 0
}

function parseDateMatch(match, referenceMs) {
    if (!match) return null

    if (match.monthName) {
        const month = parseMonthName(match.monthName)
        const day = Number(match.day)
        const year = Number(match.year) || inferYear(month, day, referenceMs)
        const iso = formatIsoDate(year, month, day)
        return iso ? { iso, label: formatDateLabel(iso) } : null
    }

    if (match.month && match.day) {
        const month = Number(match.month)
        const day = Number(match.day)
        let year = Number(match.year)
        if (year && year < 100) year += 2000
        if (!year) year = inferYear(month, day, referenceMs)
        const iso = formatIsoDate(year, month, day)
        return iso ? { iso, label: formatDateLabel(iso) } : null
    }

    return null
}

function findDatesInText(text, referenceMs) {
    const results = []
    const seen = new Set()
    const source = String(text || '')

    const patterns = [
        {
            regex: /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi,
            map: match => ({ monthName: match[1], day: match[2], year: match[3] })
        },
        {
            regex: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g,
            map: match => ({ month: match[1], day: match[2], year: match[3] })
        },
        {
            regex: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
            map: match => ({ month: match[2], day: match[3], year: match[1] })
        }
    ]

    patterns.forEach(({ regex, map }) => {
        let hit = regex.exec(source)
        while (hit) {
            const parsed = parseDateMatch(map(hit), referenceMs)
            if (parsed && !seen.has(parsed.iso)) {
                seen.add(parsed.iso)
                results.push(parsed)
            }
            hit = regex.exec(source)
        }
    })

    return results
}

function findTimeInText(text) {
    const match = String(text || '').match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
        || String(text || '').match(/\b(\d{1,2}):(\d{2})\b/)
    if (!match) return ''
    if (match[3]) {
        let hour = Number(match[1])
        const minute = match[2] ? pad2(match[2]) : '00'
        const meridiem = match[3].toLowerCase()
        if (meridiem === 'pm' && hour < 12) hour += 12
        if (meridiem === 'am' && hour === 12) hour = 0
        return `${pad2(hour)}:${minute}`
    }
    return `${pad2(match[1])}:${pad2(match[2])}`
}

function inferEventType(text) {
    for (const rule of TYPE_RULES) {
        if (rule.pattern.test(text)) return rule.type
    }
    return 'reminder'
}

function buildEventTitle(subject, text, type) {
    const cleanSubject = String(subject || '').trim()
    if (cleanSubject && cleanSubject.length <= 80) return cleanSubject
    const snippet = String(text || '').trim().slice(0, 80)
    if (snippet) return snippet
    return type.replace(/_/g, ' ')
}

function normalizeExtractedEvent(raw, message, index) {
    if (!raw || typeof raw !== 'object') return null
    const type = String(raw.type || '').trim().toLowerCase()
    if (!EVENT_TYPES.has(type)) return null
    const title = String(raw.title || '').trim().slice(0, 80)
    if (!title) return null
    const date = String(raw.date || '').trim()
    const time = String(raw.time || '').trim()
    const confidence = Number(raw.confidence)
    return {
        id: `${message && message.id ? message.id : 'msg'}:${index}`,
        messageId: message && message.id ? message.id : '',
        type,
        title,
        date,
        dateLabel: formatDateLabel(date),
        time,
        source: String(raw.source || 'heuristic'),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7
    }
}

function heuristicExtractEvents(message) {
    const { subject, body, combined } = getMessageText(message)
    if (!EVENT_SIGNAL_PATTERN.test(combined)) return []

    const referenceMs = Number(message && message.receivedAtMs) || Date.now()
    const dates = findDatesInText(combined, referenceMs)
    if (!dates.length) return []

    const type = inferEventType(combined)
    const time = findTimeInText(combined)
    const primaryDate = dates[0]
    const event = normalizeExtractedEvent({
        type,
        title: buildEventTitle(subject, combined, type),
        date: primaryDate.iso,
        time,
        confidence: dates.length > 1 ? 0.72 : 0.8,
        source: 'heuristic'
    }, message, 0)

    const extras = dates.slice(1, 3).map((entry, offset) => normalizeExtractedEvent({
        type,
        title: buildEventTitle(subject, `${type} on ${entry.label}`, type),
        date: entry.iso,
        time: '',
        confidence: 0.62,
        source: 'heuristic'
    }, message, offset + 1)).filter(Boolean)

    return event ? [event, ...extras] : []
}

function parseEventsJson(raw) {
    const text = String(raw || '').trim()
    if (!text) return []
    try {
        const parsed = JSON.parse(text)
        const events = parsed && Array.isArray(parsed.events) ? parsed.events : []
        return events
    } catch (_) {
        const block = text.match(/\{[\s\S]*\}/)
        if (!block) return []
        try {
            const parsed = JSON.parse(block[0])
            return parsed && Array.isArray(parsed.events) ? parsed.events : []
        } catch (_) {
            return []
        }
    }
}

function buildEventsPrompt(message) {
    const { subject, body } = getMessageText(message)
    return [
        'Extract dated academic events from this email.',
        `Subject: ${subject}`,
        `Date received: ${message.date || message.dateLabel || ''}`,
        '',
        body.slice(0, 5000),
        '',
        'Return strict JSON only.'
    ].join('\n')
}

async function extractMailEvents(message, options = {}) {
    const heuristic = heuristicExtractEvents(message)
    if (!options.allowLlm) return heuristic
    if (heuristic.length && heuristic[0].confidence >= 0.78) return heuristic

    try {
        const response = await fetch(OLLAMA_CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MAIL_EVENTS_MODEL,
                stream: false,
                format: 'json',
                messages: [
                    { role: 'system', content: MAIL_EVENTS_SYSTEM_PROMPT },
                    { role: 'user', content: buildEventsPrompt(message) }
                ],
                options: {
                    temperature: 0,
                    top_p: 0.05,
                    num_predict: 220
                }
            })
        })
        if (!response.ok) return heuristic
        const data = await response.json()
        const content = data && data.message && data.message.content ? data.message.content : ''
        const llmEvents = parseEventsJson(content)
            .map((item, index) => normalizeExtractedEvent({ ...item, source: 'llm' }, message, index))
            .filter(Boolean)
        return llmEvents.length ? llmEvents : heuristic
    } catch (_) {
        return heuristic
    }
}

function messageLikelyHasEvents(message) {
    const { combined } = getMessageText(message)
    return EVENT_SIGNAL_PATTERN.test(combined)
}

module.exports = {
    EVENT_TYPES,
    heuristicExtractEvents,
    extractMailEvents,
    messageLikelyHasEvents,
    formatDateLabel,
    getMessageText
}
