'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppFork } = require('./harness')

test('race: stale canvasPreloadGeneration aborts quiet loads', async () => {
  const fork = createAppFork()
  const tab = { id: 'canvas:nucleus', type: 'canvastab', workspaceId: 'nucleus', label: 'Canvas' }

  const gen1 = fork.mockMain.bumpPreloadGeneration()
  const first = await fork.mockMain.simulatePreloadLoad(tab, [
    'https://canvas.example/courses/101/a'
  ], { generation: gen1 })
  fork.screen('first preload generation complete', 'main:preload')

  fork.mockMain.bumpPreloadGeneration()
  const stale = await fork.mockMain.simulatePreloadLoad(tab, [
    'https://canvas.example/courses/101/b'
  ], { generation: gen1 })

  fork.screen('stale generation preload attempt', 'main:preload')
  assert.equal(first.loaded, 1)
  assert.equal(stale.loaded, 0)
})

test('race: preload slots are global by url', async () => {
  const fork = createAppFork()
  const tabA = { id: 'canvas:a', type: 'canvastab', workspaceId: 'nucleus', label: 'A' }
  const url = 'https://canvas.example/courses/101/shared'

  await fork.mockMain.simulatePreloadLoad(tabA, [url])
  const entry = fork.mockMain.canvasPreloadSlots.findByUrl(url)
  fork.screen('shared preload slot entry', 'main:preload')
  assert.ok(entry)
  assert.equal(fork.mockMain.canvasPreloadSlots.size(), 1)
})
