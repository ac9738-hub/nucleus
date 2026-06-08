const { spawn } = require('child_process')

function createAgentProcess({ scriptPath, onText, onToolCall }) {
  const proc = spawn('python', [scriptPath])
  let stdoutBuffer = ''

  proc.stdout.on('data', chunk => {
    console.log("main: recieved response: " + chunk.toString())
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

      console.log('main: received data from agent', data)

      if (typeof data === 'string') {
        onText(data)
        return
      }

      if (Array.isArray(data)) {
        console.log("first call")
        data.forEach(item => {
          if (typeof item === 'string') {
            onText(item)
          } else if (typeof item === 'object' && item !== null) {
            console.log('main: running tool function with data', item)
            Promise.resolve(onToolCall(item))
              .then(toolResponse => {
                proc.stdin.write(JSON.stringify(toolResponse) + "\n")
              })
              .catch(error => {
                proc.stdin.write(JSON.stringify([
                  'tool_response',
                  item.id,
                  error && error.message ? error.message : String(error)
                ]) + "\n")
              })
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
      console.log("main: sending prompt to agent", payload)
      proc.stdin.write(JSON.stringify(payload) + '\n')
    }
  }
}

module.exports = {
  createAgentProcess
}
