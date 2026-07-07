'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppFork } = require('./harness')
const { assertScreenCoherent } = require('../../lib/app-fork/screen-state')

test('race: renderer switch updates screen before main IPC sync', async () => {
  const fork = createAppFork()
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)

  let ipcAfterPaint = false
  ctx.syncActiveTab = async () => {
    const screen = fork.screen('syncActiveTab entered', 'renderer:ipc')
    const check = assertScreenCoherent(screen, { activeTabId: 'mail:nucleus' })
    ipcAfterPaint = check.ok
    return { ok: true }
  }

  ctx.switchWorkspaceTab('mail:nucleus')
  fork.screen('immediately after switch', 'renderer:action')

  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(ctx.state.activeTabId, 'mail:nucleus')
  assert.equal(ipcAfterPaint, true)
})

test('race: main activation tracks renderer tab switches under deferred sync', async () => {
  const fork = createAppFork()
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)
  ctx.syncActiveTab = async () => {
    fork.mockMain.activateTab(ctx.state.activeTabId)
    return { ok: true }
  }

  ctx.switchWorkspaceTab('browser:1')
  ctx.switchWorkspaceTab('canvas:nucleus')
  await new Promise(resolve => setTimeout(resolve, 60))

  fork.screen('renderer/main tab alignment', 'fork:race')
  assert.equal(ctx.state.activeTabId, 'canvas:nucleus')
  assert.equal(fork.mockMain.activetab.id, 'canvas:nucleus')
})
