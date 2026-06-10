// Local Ollama summarization for mail contact chat previews.
// Functionality: turns a full Gmail message into a short, informative chat summary.

const OLLAMA_CHAT_URL = process.env.OLLAMA_CHAT_URL || 'http://127.0.0.1:11434/api/chat'
const OLLAMA_MAIL_SUMMARY_MODEL = process.env.OLLAMA_MAIL_SUMMARY_MODEL
    || process.env.OLLAMA_SUMMARY_MODEL
    || 'llama3.2:3b'
const MAIL_SHORT_SUMMARY_CUTOFF = Number(process.env.MAIL_SHORT_SUMMARY_CUTOFF || 180)

const MAIL_SUMMARY_SYSTEM_PROMPT = [
    'You extract the important substance of an email for a chat preview.',
    'Write only the information the reader needs — not a description of the email itself.',
    '',
    'Extract and state directly, when present:',
    '- The main point, decision, request, or news',
    '- Specific dates, times, deadlines, and locations',
    '- Dollar amounts, percentages, counts, and named people or organizations',
    '- What the reader must do, approve, send, attend, or decide',
    '- Consequences, blockers, or changes that matter if ignored',
    '',
    'Do NOT write meta-commentary about the email. Never say things like:',
    '- "The email says..." / "The sender mentions..." / "This message is about..."',
    '- "They are asking you to..." / "The subject line indicates..."',
    '- "There is a meeting scheduled in the email"',
    'State the facts directly instead. Bad: "The email requests a meeting on Friday."',
    'Good: "Meet Friday 3pm to review Q2 budget; bring revised forecast."',
    '',
    'Rules:',
    '- 2 to 4 short sentences, plain text only',
    '- No markdown, bullets, labels, greetings, or sign-offs',
    '- Lead with the highest-priority fact or action',
    '- Use concrete nouns, verbs, numbers, and names from the email',
    '- Do not invent details; if critical info is missing, say what is unclear',
    '- Stay under 320 characters when possible'
].join('\n')

function stripHtml(value) {
    return String(value || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
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

function getMessagePlainBody(message) {
    return String(message && message.bodyText || '').trim()
        || stripHtml(message && message.bodyHtml)
        || String(message && message.snippet || '').trim()
}

function shouldSummarizeMailBody(body) {
    const text = String(body || '').trim()
    return text.length > MAIL_SHORT_SUMMARY_CUTOFF
}

function buildEmailPrompt(message) {
    const body = getMessagePlainBody(message)
    const direction = message.direction === 'outgoing' ? 'outgoing' : 'incoming'

    return [
        'Summarize this email for a chat preview.',
        'Extract important facts and actions only. Do not describe the email structure.',
        `Direction: ${direction}`,
        `From: ${message.from || message.sender || 'Unknown sender'}`,
        `Subject: ${message.subject || '(no subject)'}`,
        `Date: ${message.date || message.dateLabel || 'Unknown date'}`,
        '',
        'Email body:',
        body.slice(0, 7000),
        '',
        'Reply with the extracted summary only.'
    ].join('\n')
}

function buildFallbackSummary(message) {
    const subject = String(message.subject || '').trim() || '(no subject)'
    const snippet = String(message.snippet || message.bodyText || '').trim()
    if (snippet) {
        return `${subject}. ${snippet}`.slice(0, 320)
    }
    return subject.slice(0, 320)
}

async function summarizeEmailMessage(message) {
    const fallback = buildFallbackSummary(message)
    if (!message) return fallback

    const plainBody = getMessagePlainBody(message)
    if (plainBody && !shouldSummarizeMailBody(plainBody)) {
        return plainBody.length > 360 ? `${plainBody.slice(0, 357).trim()}...` : plainBody
    }

    try {
        const response = await fetch(OLLAMA_CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MAIL_SUMMARY_MODEL,
                stream: false,
                messages: [
                    { role: 'system', content: MAIL_SUMMARY_SYSTEM_PROMPT },
                    { role: 'user', content: buildEmailPrompt(message) }
                ],
                options: {
                    temperature: 0.1,
                    num_predict: 220
                }
            })
        })

        if (!response.ok) {
            throw new Error(`Ollama summary failed (${response.status})`)
        }

        const data = await response.json()
        const summary = data && data.message && data.message.content
            ? String(data.message.content).replace(/\s+/g, ' ').trim()
            : ''

        if (!summary) {
            return fallback
        }

        return summary.length > 360 ? `${summary.slice(0, 357).trim()}...` : summary
    } catch (_) {
        return fallback
    }
}

module.exports = {
    summarizeEmailMessage,
    buildFallbackSummary,
    getMessagePlainBody,
    shouldSummarizeMailBody,
    MAIL_SHORT_SUMMARY_CUTOFF,
    MAIL_SUMMARY_SYSTEM_PROMPT
}
