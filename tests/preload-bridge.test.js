const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

test('preload exposes Synapse curriculum bridge methods', () => {
  const preloadPath = path.resolve(__dirname, '..', 'preload.js')
  const originalLoad = Module._load
  const calls = []
  let exposed = null

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            if (name === 'nucleus') exposed = api
          }
        },
        ipcRenderer: {
          invoke(channel, ...args) {
            calls.push({ channel, args })
            return Promise.resolve({ ok: true, channel, args })
          },
          send() {},
          sendSync() { return {} },
          on() {},
          removeListener() {}
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    delete require.cache[preloadPath]
    require(preloadPath)

    assert.equal(typeof exposed.synapseListCourses, 'function')
    assert.equal(typeof exposed.synapseGetCurriculum, 'function')

    exposed.synapseListCourses({ refresh: true })
    exposed.synapseGetCurriculum('101', { refresh: true })

    assert.deepEqual(calls.slice(-2), [
      { channel: 'synapse:list_courses', args: [{ refresh: true }] },
      { channel: 'synapse:get_curriculum', args: [{ courseId: '101', refresh: true }] }
    ])
  } finally {
    Module._load = originalLoad
    delete require.cache[preloadPath]
  }
})
