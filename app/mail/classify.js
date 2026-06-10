// Local Ollama classification for inbox routing.
// Functionality: classify inbox emails into academic vs non-academic categories.

const OLLAMA_CHAT_URL = process.env.OLLAMA_CHAT_URL || 'http://127.0.0.1:11434/api/chat'
const OLLAMA_MAIL_CLASSIFY_MODEL = process.env.OLLAMA_MAIL_CLASSIFY_MODEL
    || process.env.OLLAMA_CLASSIFY_MODEL
    || 'llama3.2:3b'

const ACADEMIC = 'academic'
const NON_ACADEMIC = 'non_academic'
const VALID_LABELS = new Set([ACADEMIC, NON_ACADEMIC])

const CLASSIFY_SYSTEM_PROMPT = [
    'Classify email into one of two labels: academic or non_academic.',
    '',
    'Return STRICT JSON only, exactly this shape:',
    '{"label":"academic|non_academic","confidence":0.0,"reason":"<=120 chars"}',
    '',
    'Rules:',
    '- label must be exactly "academic" or "non_academic"',
    '- confidence must be a number from 0 to 1',
    '- reason must be short plain text',
    '- no extra keys',
    '- no markdown, no code fences, no prose outside JSON',
    '',
    'Use label=academic for course/class/school/research/admissions/teaching',
    'or messages from .edu institutions, advisors, professors, registrars,',
    'financial aid, enrollment, assignments, deadlines, exams, labs, or office hours.',
    '',
    'Use label=non_academic for promotions, social, ecommerce, newsletters,',
    'entertainment, travel, receipts unrelated to school, banking, and personal mail.'
].join('\n')

function extractEmail(value) {
    const raw = String(value || '').trim()
    const match = raw.match(/<([^>]+)>/)
    return (match ? match[1] : raw).toLowerCase()
}

function clamp01(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0
    if (numeric < 0) return 0
    if (numeric > 1) return 1
    return numeric
}

function normalizeModelResponse(payload) {
    if (!payload || typeof payload !== 'object') return null
    const label = String(payload.label || '').trim().toLowerCase()
    if (!VALID_LABELS.has(label)) return null
    const reason = String(payload.reason || '').trim().slice(0, 120)
    return {
        label,
        confidence: clamp01(payload.confidence),
        reason
    }
}

function parseStrictJson(raw) {
    const text = String(raw || '').trim()
    if (!text) return null
    try {
        return normalizeModelResponse(JSON.parse(text))
    } catch (_) {
        const block = text.match(/\{[\s\S]*\}/)
        if (!block) return null
        try {
            return normalizeModelResponse(JSON.parse(block[0]))
        } catch (_) {
            return null
        }
    }
}

function heuristicClassify(message) {
    const sender = extractEmail(message && message.from)
    const subject = String(message && message.subject || '').toLowerCase()
    const snippet = String(message && message.snippet || '').toLowerCase()
    const combined = `${subject} ${snippet}`

    const academicKeywords = [
        'assignment', 'professor', 'course', 'class', 'university', 'college',
        'syllabus', 'grade', 'exam', 'midterm', 'final', 'office hours',
        'canvas', 'blackboard', 'enrollment', 'registrar', 'financial aid',
        'research', 'thesis', 'seminar', 'lab', 'lecture', 'homework', 'advisor',
        'deadline', 'tuition', 'scholarship'
    ]

    const nonAcademicKeywords = [
        'unsubscribe', 'sale', 'deal', 'promotion', 'promo', 'coupon',
        'delivery', 'shipment', 'order', 'receipt', 'invoice', 'newsletter',
        'social', 'password reset', 'security alert', 'travel', 'hotel', 'flight'
    ]

    if (sender.endsWith('.edu') || sender.includes('.edu.')) {
        return { label: ACADEMIC, confidence: 0.82, reason: 'Sender uses .edu domain.' }
    }

    if (academicKeywords.some(keyword => combined.includes(keyword))) {
        return { label: ACADEMIC, confidence: 0.76, reason: 'Academic keywords found.' }
    }

    if (nonAcademicKeywords.some(keyword => combined.includes(keyword))) {
        return { label: NON_ACADEMIC, confidence: 0.76, reason: 'Non-academic keywords found.' }
    }

    return { label: ACADEMIC, confidence: 0.5, reason: 'Default fallback classification.' }
}

function buildPrompt(message) {
    return [
        'Classify this inbox email.',
        `From: ${message && message.from ? message.from : ''}`,
        `Subject: ${message && message.subject ? message.subject : ''}`,
        `Snippet: ${message && message.snippet ? message.snippet : ''}`,
        `To: ${message && message.to ? message.to : ''}`,
        '',
        'Return strict JSON only.'
    ].join('\n')
}

async function classifyInboxMessage(message) {
    const fallback = heuristicClassify(message)
    try {
        const response = await fetch(OLLAMA_CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MAIL_CLASSIFY_MODEL,
                stream: false,
                format: 'json',
                messages: [
                    { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
                    { role: 'user', content: buildPrompt(message) }
                ],
                options: {
                    temperature: 0,
                    top_p: 0.05,
                    top_k: 20,
                    seed: 7,
                    num_predict: 80
                }
            })
        })
        if (!response.ok) return fallback
        const data = await response.json()
        const content = data && data.message && data.message.content ? data.message.content : ''
        return parseStrictJson(content) || fallback
    } catch (_) {
        return fallback
    }
}

module.exports = {
    ACADEMIC,
    NON_ACADEMIC,
    classifyInboxMessage
}
