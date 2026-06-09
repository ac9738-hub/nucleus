// Synapse LLM client (main process).
// Functionality: thin LLM wrapper around the Anthropic Messages API. Exposes a
// route() stub (always Anthropic for now -- swap in real routing later) and a
// streaming send() that emits text deltas and resolves with the full reply.
// Dependencies: axios (already a Nucleus dependency); main.js injects getApiKey
// and forwards deltas to the renderer over IPC. The API key never leaves main.
const axios = require('axios')

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_MAX_TOKENS = 2048

// Pinned, current Claude model IDs. 4.6+ dateless IDs are fixed snapshots.
const KNOWN_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
]

const DEFAULT_SYSTEM_PROMPT =
  'You are Synapse, the in-app assistant for Nucleus, a student workspace. ' +
  'Be direct and concise. Use plain language and only format code in fenced code blocks.'

// Normalize a renderer transcript into Anthropic message blocks.
function toAnthropicMessages(messages) {
  const list = Array.isArray(messages) ? messages : []
  return list
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content != null)
    .map(m => ({ role: m.role, content: String(m.content) }))
}

function createSynapseClient(config = {}) {
  const getApiKey =
    typeof config.getApiKey === 'function'
      ? config.getApiKey
      : () => process.env.ANTHROPIC_API_KEY
  const defaultModel = config.defaultModel || process.env.SYNAPSE_MODEL || DEFAULT_MODEL
  const anthropicVersion = config.anthropicVersion || ANTHROPIC_VERSION
  const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT

  // ---- Routing stub -------------------------------------------------------
  // Right now every request goes to Anthropic with the requested (or default)
  // model. Replace the body later to branch on payload (intent, cost, length,
  // local vs cloud, etc.) and return a different provider/model.
  function route(payload = {}) {
    return {
      provider: 'anthropic',
      model: payload.model || defaultModel
    }
  }

  function listModels() {
    return KNOWN_MODELS.slice()
  }

  // ---- Streaming send -----------------------------------------------------
  // payload: { model?, messages: [{role, content}], system?, maxTokens? }
  // onDelta(textChunk) is called for each streamed token group (optional).
  // Resolves with { ok, text } or { ok:false, error }.
  async function send(payload = {}, handlers = {}) {
    const apiKey = getApiKey()
    if (!apiKey) {
      return { ok: false, error: 'ANTHROPIC_API_KEY is not set.' }
    }

    const decision = route(payload)
    const onDelta = typeof handlers.onDelta === 'function' ? handlers.onDelta : null

    const body = {
      model: decision.model,
      max_tokens: payload.maxTokens || DEFAULT_MAX_TOKENS,
      system: payload.system || systemPrompt,
      messages: toAnthropicMessages(payload.messages),
      stream: true
    }

    if (!body.messages.length) {
      return { ok: false, error: 'No messages to send.' }
    }

    let response
    try {
      response = await axios({
        method: 'post',
        url: ANTHROPIC_URL,
        responseType: 'stream',
        validateStatus: () => true,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': anthropicVersion
        },
        data: body
      })
    } catch (error) {
      return { ok: false, error: (error && error.message) || 'Request failed.' }
    }

    if (response.status >= 400) {
      const errorBody = await collectStream(response.data)
      return { ok: false, error: extractErrorMessage(errorBody, response.status) }
    }

    return parseSseStream(response.data, onDelta)
  }

  return { route, send, listModels, defaultModel }
}

// Read a whole stream into a string (used for non-200 error bodies).
function collectStream(stream) {
  return new Promise(resolve => {
    let out = ''
    if (!stream || typeof stream.on !== 'function') {
      resolve('')
      return
    }
    stream.on('data', chunk => { out += chunk.toString('utf8') })
    stream.on('end', () => resolve(out))
    stream.on('error', () => resolve(out))
  })
}

function extractErrorMessage(rawBody, status) {
  try {
    const parsed = JSON.parse(rawBody)
    if (parsed && parsed.error && parsed.error.message) {
      return `Anthropic API error (${status}): ${parsed.error.message}`
    }
  } catch (_error) {
    // fall through
  }
  return `Anthropic API error (${status}).`
}

// Parse the Anthropic SSE stream, emit text deltas, resolve with full text.
function parseSseStream(stream, onDelta) {
  return new Promise(resolve => {
    let buffer = ''
    let text = ''
    let streamError = null

    function handleEvent(data) {
      if (!data || data === '[DONE]') return
      let evt
      try {
        evt = JSON.parse(data)
      } catch (_error) {
        return
      }

      if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
        const chunk = evt.delta.text || ''
        if (chunk) {
          text += chunk
          if (onDelta) onDelta(chunk)
        }
      } else if (evt.type === 'error') {
        streamError = (evt.error && evt.error.message) || 'Stream error.'
      }
    }

    stream.on('data', chunk => {
      buffer += chunk.toString('utf8')
      let newlineIndex
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line.startsWith('data:')) {
          handleEvent(line.slice(5).trim())
        }
      }
    })

    stream.on('end', () => {
      if (streamError) {
        resolve({ ok: false, error: streamError })
        return
      }
      resolve({ ok: true, text: text })
    })

    stream.on('error', error => {
      resolve({ ok: false, error: (error && error.message) || 'Stream interrupted.' })
    })
  })
}

module.exports = {
  createSynapseClient,
  KNOWN_MODELS,
  DEFAULT_MODEL
}
