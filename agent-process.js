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

        Promise.all(toolItems.map(item => Promise.resolve(onToolCall(item))))
          .then(responses => {
            const valid = responses.filter(response => Array.isArray(response))
            if (!valid.length) return
            if (valid.length === 1) {
              proc.stdin.write(JSON.stringify(valid[0]) + '\n')
            } else {
              proc.stdin.write(JSON.stringify(['tool_response_batch', valid]) + '\n')
            }
            if (typeof onAfterToolBatch === 'function') {
              onAfterToolBatch(toolItems, valid)
            }
          })
          .catch(error => {
            proc.stdin.write(JSON.stringify([
              'tool_response',
              toolItems[0].id,
              error && error.message ? error.message : String(error)
            ]) + '\n')
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
