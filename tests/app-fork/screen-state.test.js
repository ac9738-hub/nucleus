'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppFork } = require('./harness')
const { assertScreenCoherent } = require('../../lib/app-fork/screen-state')

test('screen: applyTabViewState updates tier and repaints active tab', async () => {
  const fork = createAppFork()
  const ctx = fork.loadFullStack()
  fork.stubFastRendererPipeline(ctx)

  ctx.state.top = 'workspace'
  ctx.state.activeTabId = 'browser:1'
  let painted = 0
  ctx.paintActiveView = () => { painted += 1 }

  fork.screen('before applyTabViewState', 'screen:tabs')
  fork.callRenderer('applyTabViewState', {
    id: 'browser:1',
    tier: 'active',
    discarded: false,
    snapshotDataUrl: ''
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  fork.screen('after applyTabViewState active', 'screen:tabs')

  const tab = ctx.state.tabs.find(item => item.id === 'browser:1')
  assert.equal(tab.viewTier, 'active')
  assert.equal(tab.discarded, false)
  assert.ok(painted >= 1)

  const check = assertScreenCoherent(fork.screen('coherence check', 'screen:assert'), {
    activeTabId: 'browser:1',
    viewPresent: true
  })
  assert.equal(check.ok, true, check.issues.join('; '))
})

test('screen: stashed tier on inactive tab does not repaint active surface', async () => {
  const fork = createAppFork()
  const ctx = fork.loadFullStack()
  await fork.settleRendererBoot()

  ctx.state.activeTabId = 'center:nucleus'
  let painted = 0
  ctx.paintActiveView = () => { painted += 1 }

  fork.callRenderer('applyTabViewState', {
    id: 'mail:nucleus',
    tier: 'stashed',
    discarded: true,
    snapshotDataUrl: 'data:image/png;base64,abc'
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  fork.screen('after stashed inactive tab', 'screen:tabs')

  const mail = ctx.state.tabs.find(item => item.id === 'mail:nucleus')
  assert.equal(mail.viewTier, 'stashed')
  assert.equal(mail.discarded, true)
  assert.equal(painted, 0)
})

test('screen: trace records monotonic process timeline', () => {
  const fork = createAppFork()
  const ctx = fork.loadRendererCore()
  fork.stubFastRendererPipeline(ctx)
  ctx.syncActiveTab = async () => ({ ok: true })

  fork.screen('t0', 'trace')
  ctx.switchWorkspaceTab('mail:nucleus')
  fork.screen('t1', 'trace')
  ctx.switchWorkspaceTab('center:nucleus')
  fork.screen('t2', 'trace')

  const entries = fork.trace.entries
  assert.ok(entries.length >= 3)
  for (let i = 1; i < entries.length; i += 1) {
    assert.ok(entries[i].tMs >= entries[i - 1].tMs)
    assert.equal(entries[i].seq, entries[i - 1].seq + 1)
  }
  assert.ok(entries.every(entry => entry.screen && entry.screen.renderer))
})
