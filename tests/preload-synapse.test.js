const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

function loadPreload() {
  const exposed = {}
  const calls = []
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, value) {
        exposed[name] = value
      }
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        calls.push({ channel, args })
        return Promise.resolve({ ok: true, channel, args })
      },
      sendSync(channel, ...args) {
        calls.push({ channel, args, sync: true })
        return null
      },
      send(channel, ...args) {
        calls.push({ channel, args, send: true })
      },
      on() {},
      removeListener() {}
    }
  }
  const sandbox = {
    require(name) {
      if (name === 'electron') return electron
      throw new Error(`Unexpected require: ${name}`)
    },
    console
  }
  vm.createContext(sandbox)
  const preloadPath = path.join(__dirname, '..', 'preload.js')
  vm.runInContext(fs.readFileSync(preloadPath, 'utf8'), sandbox, { filename: preloadPath })
  return { nucleus: exposed.nucleus, calls }
}

test('preload exposes Synapse Learn curriculum IPC bridge', async () => {
  const { nucleus, calls } = loadPreload()

  assert.equal(typeof nucleus.synapseListCourses, 'function')
  assert.equal(typeof nucleus.synapseGetCurriculum, 'function')

  await nucleus.synapseListCourses({ refresh: true })
  await nucleus.synapseGetCurriculum('course-101', { refresh: true })

  assert.equal(JSON.stringify(calls.slice(-2)), JSON.stringify([
    {
      channel: 'synapse:list_courses',
      args: [{ refresh: true }]
    },
    {
      channel: 'synapse:get_curriculum',
      args: [{ courseId: 'course-101', options: { refresh: true } }]
    }
  ]))
})
