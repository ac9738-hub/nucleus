// Inbox classification for academic vs non-academic Gmail routing.
// Functionality: heuristic-first splitting with optional Ollama refinement.

const OLLAMA_CHAT_URL = process.env.OLLAMA_CHAT_URL || 'http://127.0.0.1:11434/api/chat'
const OLLAMA_MAIL_CLASSIFY_MODEL = process.env.OLLAMA_MAIL_CLASSIFY_MODEL
    || process.env.OLLAMA_CLASSIFY_MODEL
    || 'llama3.2:3b'

const ACADEMIC = 'academic'
const NON_ACADEMIC = 'non_academic'
const CAMPUS_EVENTS = 'campus_events'
const VALID_LABELS = new Set([ACADEMIC, NON_ACADEMIC, CAMPUS_EVENTS])
const INBOX_SPLIT_FOLDERS = new Set(['inbox', 'secondary', 'campus_events'])

const HEURISTIC_LLM_THRESHOLD = Number(process.env.MAIL_CLASSIFY_LLM_THRESHOLD || 0.74)

const GMAIL_NON_ACADEMIC_LABELS = new Set([
    'CATEGORY_PROMOTIONS',
    'CATEGORY_SOCIAL'
])

const GMAIL_NEUTRAL_LABELS = new Set([
    'CATEGORY_UPDATES',
    'CATEGORY_FORUMS',
    'CATEGORY_PERSONAL'
])

const ACADEMIC_SENDER_PATTERNS = [
    /\.edu$/i,
    /@(?:[\w.-]+\.)?edu[.>]/i,
    /instructure\.com/i,
    /canvas/i,
    /blackboard/i,
    /registrar/i,
    /financial\.aid/i,
    /bursar/i,
    /dean(?:ofstudents|ofstudents)?/i,
    /library@/i,
    /academic/i,
    /coursemail/i,
    /coursework/i,
    /gradschool/i,
    /admissions@/i
]

const CAMPUS_EVENTS_SENDER_PATTERNS = [
    /events@/i,
    /event@/i,
    /calendar@/i,
    /studentactivities/i,
    /student\.activities/i,
    /studentaffairs/i,
    /student-affairs/i,
    /campuslife/i,
    /campus-life/i,
    /athletics/i,
    /varsity/i,
    /recreation@/i,
    /careerservices/i,
    /career-services/i,
    /career@/i,
    /performingarts/i,
    /studentorgs?/i,
    /student.?life/i,
    /tigertickets/i,
    /ticketoffice/i,
    /ods@/i,
    /deanofstudents/i
]

const CAMPUS_EVENTS_KEYWORDS = [
    'career fair', 'job fair', 'employer showcase', 'info session', 'information session',
    'guest speaker', 'speaker series', 'public lecture', 'town hall',
    'club fair', 'student org', 'student organization', 'student activities',
    'varsity game', 'athletic event', 'pep rally', 'game day',
    'campus tour', 'open house', 'welcome week', 'orientation week',
    'register for the event', 'event registration', 'rsvp', 'save the date',
    'student life', 'residential college', 'community dinner',
    'concert', 'performance', 'theater', 'comedy show', 'film screening',
    'hackathon', 'design challenge', 'volunteer fair', 'service day',
    'career workshop', 'networking night', 'alumni event', 'reunion weekend'
]

const NON_ACADEMIC_SENDER_PATTERNS = [
    /no[-_]?reply@/i,
    /donotreply@/i,
    /notifications?@/i,
    /newsletter@/i,
    /marketing@/i,
    /promo@/i,
    /mailer@/i,
    /bounce@/i,
    /mailchimp/i,
    /amazonses/i,
    /sendgrid/i,
    /linkedin\.com/i,
    /facebookmail\.com/i,
    /twitter\.com/i,
    /instagram\.com/i,
    /substack\.com/i,
    /github\.com/i,
    /spotify\.com/i,
    /uber\.com/i,
    /doordash/i,
    /grubhub/i,
    /amazon\./i,
    /paypal/i,
    /stripe\.com/i
]

const ACADEMIC_KEYWORDS = [
    'assignment', 'professor', 'course', 'class', 'university', 'college',
    'syllabus', 'grade', 'exam', 'midterm', 'final exam', 'office hours',
    'canvas', 'blackboard', 'enrollment', 'registrar', 'financial aid',
    'research', 'thesis', 'seminar', 'lab', 'lecture', 'homework', 'advisor',
    'deadline', 'tuition', 'scholarship', 'problem set', 'pset', 'precept',
    'section', 'discussion', 'reading', 'quiz', 'instructor', 'faculty',
    'dean of students', 'bursar', 'transcript', 'add/drop', 'course schedule'
]

const NON_ACADEMIC_KEYWORDS = [
    'unsubscribe', 'sale', 'deal', 'promotion', 'promo', 'coupon',
    'delivery', 'shipment', 'order confirmation', 'receipt', 'invoice',
    'newsletter', 'password reset', 'security alert', 'travel deal',
    'hotel', 'flight deal', 'limited time', 'shop now', 'free shipping',
    'your weekly digest', 'trending now', 'special offer', 'claim your',
    'account alert', 'verify your account', 'payment received'
]

const CLASSIFY_SYSTEM_PROMPT = [
    'Classify email into one of three labels: academic, campus_events, or non_academic.',
    '',
    'Return STRICT JSON only, exactly this shape:',
    '{"label":"academic|campus_events|non_academic","confidence":0.0,"reason":"<=120 chars"}',
    '',
    'Rules:',
    '- label must be exactly "academic", "campus_events", or "non_academic"',
    '- confidence must be a number from 0 to 1',
    '- reason must be short plain text',
    '- no extra keys',
    '- no markdown, no code fences, no prose outside JSON',
    '',
    'Use label=academic for course/class/school/research/admissions/teaching',
    'or messages from .edu institutions, advisors, professors, registrars,',
    'financial aid, enrollment, assignments, deadlines, exams, labs, or office hours.',
    '',
    'Use label=campus_events for student-life announcements, club meetings, career fairs,',
    'athletic games, concerts, speakers, campus tours, RSVPs, and school-wide events',
    'that are not tied to a specific course assignment or exam.',
    '',
    'Use label=non_academic for promotions, social, ecommerce, newsletters,',
    'entertainment, travel, receipts unrelated to school, banking, and personal mail.'
].join('\n')

function extractEmail(value) {
    const raw = String(value || '').trim()
    const match = raw.match(/<([^>]+)>/)
    return (match ? match[1] : raw).toLowerCase()
}

function hasLabel(message, labelId) {
    return Array.isArray(message && message.labelIds) && message.labelIds.includes(labelId)
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

function senderMatches(patterns, sender) {
    return patterns.some(pattern => pattern.test(sender))
}

function keywordScore(keywords, text) {
    let hits = 0
    keywords.forEach(keyword => {
        if (text.includes(keyword)) hits += 1
    })
    return hits
}

function heuristicClassify(message) {
    const sender = extractEmail(message && message.from)
    const subject = String(message && message.subject || '').toLowerCase()
    const snippet = String(message && message.snippet || '').toLowerCase()
    const combined = `${subject} ${snippet}`

    const campusHits = keywordScore(CAMPUS_EVENTS_KEYWORDS, combined)
    const academicHits = keywordScore(ACADEMIC_KEYWORDS, combined)
    const nonAcademicHits = keywordScore(NON_ACADEMIC_KEYWORDS, combined)

    if (hasLabel(message, 'CATEGORY_PROMOTIONS')) {
        return { label: NON_ACADEMIC, confidence: 0.94, reason: 'Gmail Promotions category.' }
    }
    if (hasLabel(message, 'CATEGORY_SOCIAL')) {
        return { label: NON_ACADEMIC, confidence: 0.9, reason: 'Gmail Social category.' }
    }

    if (senderMatches(NON_ACADEMIC_SENDER_PATTERNS, sender)) {
        return { label: NON_ACADEMIC, confidence: 0.88, reason: 'Marketing or notification sender.' }
    }

    if (senderMatches(CAMPUS_EVENTS_SENDER_PATTERNS, sender)) {
        return { label: CAMPUS_EVENTS, confidence: 0.9, reason: 'Campus events sender.' }
    }

    if (campusHits >= 2 && academicHits === 0) {
        return { label: CAMPUS_EVENTS, confidence: 0.86, reason: 'Multiple campus event keywords found.' }
    }
    if (campusHits >= 1 && academicHits === 0 && nonAcademicHits === 0) {
        return { label: CAMPUS_EVENTS, confidence: 0.8, reason: 'Campus event keyword found.' }
    }
    if (campusHits > 0 && campusHits >= academicHits && nonAcademicHits === 0) {
        return { label: CAMPUS_EVENTS, confidence: 0.74, reason: 'Campus event cues outweigh course cues.' }
    }

    if (senderMatches(ACADEMIC_SENDER_PATTERNS, sender)) {
        return { label: ACADEMIC, confidence: 0.9, reason: 'Academic sender domain or role.' }
    }

    if (academicHits >= 2) {
        return { label: ACADEMIC, confidence: 0.84, reason: 'Multiple academic keywords found.' }
    }
    if (nonAcademicHits >= 2) {
        return { label: NON_ACADEMIC, confidence: 0.84, reason: 'Multiple non-academic keywords found.' }
    }

    if (academicHits === 1 && nonAcademicHits === 0) {
        return { label: ACADEMIC, confidence: 0.78, reason: 'Academic keyword found.' }
    }
    if (nonAcademicHits === 1 && academicHits === 0) {
        return { label: NON_ACADEMIC, confidence: 0.78, reason: 'Non-academic keyword found.' }
    }

    if (hasLabel(message, 'CATEGORY_UPDATES') && academicHits === 0) {
        return { label: NON_ACADEMIC, confidence: 0.72, reason: 'Gmail Updates without academic cues.' }
    }

    if (hasLabel(message, 'CATEGORY_PERSONAL') && academicHits === 0 && nonAcademicHits === 0) {
        return { label: NON_ACADEMIC, confidence: 0.62, reason: 'Personal Gmail category without school cues.' }
    }

    if (academicHits > nonAcademicHits) {
        return { label: ACADEMIC, confidence: 0.66, reason: 'Academic keywords outweigh non-academic cues.' }
    }
    if (nonAcademicHits > academicHits) {
        return { label: NON_ACADEMIC, confidence: 0.66, reason: 'Non-academic keywords outweigh academic cues.' }
    }

    return { label: NON_ACADEMIC, confidence: 0.55, reason: 'No strong academic signals; routed to Secondary.' }
}

function buildPrompt(message) {
    const labels = Array.isArray(message && message.labelIds) ? message.labelIds.join(', ') : ''
    return [
        'Classify this inbox email.',
        `From: ${message && message.from ? message.from : ''}`,
        `Subject: ${message && message.subject ? message.subject : ''}`,
        `Snippet: ${message && message.snippet ? message.snippet : ''}`,
        `To: ${message && message.to ? message.to : ''}`,
        labels ? `Gmail labels: ${labels}` : '',
        '',
        'Return strict JSON only.'
    ].join('\n')
}

async function classifyInboxMessage(message, options = {}) {
    const heuristic = heuristicClassify(message)
    const threshold = Number(options.llmThreshold) > 0 ? Number(options.llmThreshold) : HEURISTIC_LLM_THRESHOLD
    if (!options.forceLlm && heuristic.confidence >= threshold) {
        return heuristic
    }

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
        if (!response.ok) return heuristic
        const data = await response.json()
        const content = data && data.message && data.message.content ? data.message.content : ''
        return parseStrictJson(content) || heuristic
    } catch (_) {
        return heuristic
    }
}

function normalizeClassificationLabel(label) {
    const value = String(label || '').trim().toLowerCase()
    if (value === NON_ACADEMIC) return NON_ACADEMIC
    if (value === CAMPUS_EVENTS) return CAMPUS_EVENTS
    return ACADEMIC
}

function isInboxSplitFolder(folder) {
    return INBOX_SPLIT_FOLDERS.has(String(folder || '').trim())
}

module.exports = {
    ACADEMIC,
    NON_ACADEMIC,
    CAMPUS_EVENTS,
    INBOX_SPLIT_FOLDERS,
    normalizeClassificationLabel,
    isInboxSplitFolder,
    heuristicClassify,
    classifyInboxMessage,
    HEURISTIC_LLM_THRESHOLD
}
