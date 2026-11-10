const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const childProcess = require('node:child_process')

function makeFakeProcess() {
  return {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: {
      writes: [],
      write(chunk) {
        this.writes.push(String(chunk))
      }
    },
    on() {}
  }
}

function loadAgentProcessWith(fakeProcess) {
  const originalSpawn = childProcess.spawn
  childProcess.spawn = () => fakeProcess
  delete require.cache[require.resolve('../agent-process')]
  try {
    return require('../agent-process')
  } finally {
    childProcess.spawn = originalSpawn
  }
}

function flushMicrotasks() {
  return new Promise(resolve => setImmediate(resolve))
}

test('tool batches return one response per tool when a handler rejects', async () => {
  const fakeProcess = makeFakeProcess()
  const { createAgentProcess } = loadAgentProcessWith(fakeProcess)
  const afterBatches = []

  createAgentProcess({
    scriptPath: 'sidekick.py',
    onText() {},
    onToolCall(item) {
      if (item.name === 'bad_tool') {
        throw new Error('handler failed')
      }
      return ['tool_response', item.id, 'ok']
    },
    onAfterToolBatch(items, responses) {
      afterBatches.push({ items, responses })
    }
  })

  fakeProcess.stdout.emit('data', `${JSON.stringify([
    { name: 'good_tool', id: 'tool-good' },
    { name: 'bad_tool', id: 'tool-bad' }
  ])}\n`)
  await flushMicrotasks()

  assert.equal(fakeProcess.stdin.writes.length, 1)
  const payload = JSON.parse(fakeProcess.stdin.writes[0])
  assert.equal(payload[0], 'tool_response_batch')
  assert.deepEqual(payload[1].map(entry => entry[1]), ['tool-good', 'tool-bad'])
  assert.deepEqual(payload[1][0], ['tool_response', 'tool-good', 'ok'])
  assert.deepEqual(payload[1][1], ['tool_response', 'tool-bad', 'handler failed'])
  assert.equal(afterBatches.length, 1)
  assert.deepEqual(afterBatches[0].responses, payload[1])
})
