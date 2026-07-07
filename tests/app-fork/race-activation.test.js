'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppFork } = require('./harness')

test('race: stale main activation generation is rejected', async () => {
  const fork = createAppFork()
  const first = fork.mockMain.activateTab('mail:nucleus')
  const staleGen = first.generation
  fork.mockMain.activateTab('browser:1')
  fork.mockMain.activateTab('center:nucleus')

  fork.screen('after rapid main activations', 'main:race')
  assert.equal(fork.mockMain.isStaleActivation(staleGen), true)
  assert.equal(fork.mockMain.isStaleActivation(fork.mockMain.tabActivationGeneration), false)
  assert.equal(fork.mockMain.activetab.id, 'center:nucleus')
})

test('race: serialized tab operations complete in order', async () => {
  const fork = createAppFork()
  const order = []

  await Promise.all([
    fork.mockMain.runSerializedTabOperation(async () => {
      order.push('a-start')
      await new Promise(resolve => setTimeout(resolve, 30))
      order.push('a-end')
    }),
    fork.mockMain.runSerializedTabOperation(async () => {
      order.push('b-start')
      await new Promise(resolve => setTimeout(resolve, 5))
      order.push('b-end')
    })
  ])

  fork.screen('serialized ops complete', 'main:race')
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'])
})

test('race: renderer stale surface generation cannot win tab id', async () => {
  const fork = createAppFork()
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)

  let syncCalls = 0
  ctx.syncActiveTab = async () => {
    syncCalls += 1
    await new Promise(resolve => setTimeout(resolve, 25))
    return { ok: true }
  }

  const staleGen = ctx.bumpTabSurfaceSyncGeneration()
  ctx.state.activeTabId = 'mail:nucleus'
  ctx.deferWorkspaceSurfaceSync(staleGen)

  const currentGen = ctx.bumpTabSurfaceSyncGeneration()
  ctx.state.activeTabId = 'center:nucleus'
  ctx.deferWorkspaceSurfaceSync(currentGen)

  await new Promise(resolve => setTimeout(resolve, 80))
  fork.screen('renderer generation race settled', 'renderer:race')

  assert.equal(ctx.isTabSurfaceSyncCurrent(staleGen), false)
  assert.equal(ctx.state.activeTabId, 'center:nucleus')
  assert.ok(syncCalls >= 1)
})
