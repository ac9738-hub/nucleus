// Agent process adapter.
// Functionality: spawns sidekick.py, parses newline-delimited JSON responses,
// and routes text/tool calls back to main.js.
// Dependencies: child_process.spawn and main.js callbacks for UI text/tool IO.
const { spawn } = require('child_process')

function createAgentProcess({ scriptPath, onText, onToolCall, onDone = () => {}, onReplace = () => {}, onAfterToolBatch = null }) {
  const proc = spawn('python', [scriptPath])
  let stdoutBuffer = ''

  proc.stdout.on('data', chunk => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop()

    lines.forEach(line => {
      if (!line.trim()) return

      let data
      try {
        data = JSON.parse(line)
      } catch (err) {
        console.error('main: invalid JSON from agent', line, err)
        return
      }

      if (typeof data === 'string') {
        onText(data)
        return
      }

      if (data && typeof data === 'object' && data.type === 'done') {
        onDone()
        return
      }

      if (data && typeof data === 'object' && data.type === 'replace') {
        onReplace(data.text || '')
        return
      }

      if (Array.isArray(data)) {
        const toolItems = data.filter(
          item => typeof item === 'object' && item !== null && item.name && item.id
        )
        const textItems = data.filter(item => typeof item === 'string')

        textItems.forEach(item => onText(item))

        if (!toolItems.length) return

        Promise.allSettled(toolItems.map(item => Promise.resolve().then(() => onToolCall(item))))
          .then(results => {
            const responses = results.map((result, index) => {
              const item = toolItems[index]
              if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                return result.value
              }
              if (result.status === 'fulfilled') {
                const value = result.value == null ? '' : String(result.value)
                return ['tool_response', item.id, value]
              }
              const error = result.reason
              const message = error && error.message ? error.message : String(error)
              return ['tool_response', item.id, message]
            })
            if (responses.length === 1) {
              proc.stdin.write(JSON.stringify(responses[0]) + '\n')
            } else {
              proc.stdin.write(JSON.stringify(['tool_response_batch', responses]) + '\n')
            }
            if (typeof onAfterToolBatch === 'function') {
              onAfterToolBatch(toolItems, responses)
            }
          })
      }
    })
  })

  proc.stderr.on('data', chunk => {
    console.error('sidekick:', chunk.toString())
  })

  proc.on('close', () => console.log('Agent process closed'))

  return {
    send(payload) {
      proc.stdin.write(JSON.stringify(payload) + '\n')
    }
  }
}

module.exports = {
  createAgentProcess
}
