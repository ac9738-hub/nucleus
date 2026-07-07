const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')

function loadMailTabs(harness, options = {}) {
  harness.loadMailSuite()
  harness.context.state.top = 'workspace'
  harness.context.state.activeTabId = options.activeTabId || 'mail:nucleus'
  harness.context.state.tabs = options.tabs || [
    { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
    { id: 'mail:nucleus', type: 'mailtab', workspaceId: 'nucleus', label: 'Mail' },
    { id: 'synapse:nucleus', type: 'synapsetab', workspaceId: 'nucleus', label: 'Synapse' }
  ]
  return harness.context
}

test('messageMatchesMailFolder routes inbox categories', () => {
  const ctx = loadMailTabs(createHarness())
  const academic = { inboxCategory: 'academic' }
  const promo = { inboxCategory: 'non_academic' }
  const event = { inboxCategory: 'campus_events' }
  assert.equal(ctx.messageMatchesMailFolder(academic, 'inbox', ''), true)
  assert.equal(ctx.messageMatchesMailFolder(promo, 'inbox', ''), false)
  assert.equal(ctx.messageMatchesMailFolder(event, 'campus_events', ''), true)
  assert.equal(ctx.messageMatchesMailFolder(promo, 'secondary', ''), true)
})

test('messageMatchesMailFolder ignores folder filter during search', () => {
  const ctx = loadMailTabs(createHarness())
  const promo = { inboxCategory: 'non_academic' }
  assert.equal(ctx.messageMatchesMailFolder(promo, 'inbox', 'newsletter'), true)
})

test('isMailTabActive is true only for focused mail tab in workspace', () => {
  const harness = createHarness()
  const ctx = loadMailTabs(harness)
  assert.equal(ctx.isMailTabActive(), true)
  ctx.state.activeTabId = 'synapse:nucleus'
  assert.equal(ctx.isMailTabActive(), false)
  ctx.state.activeTabId = 'mail:nucleus'
  ctx.state.top = 'section'
  assert.equal(ctx.isMailTabActive(), false)
})

test('syncMailWatchLifecycle starts watch on active mail tab', async () => {
  const calls = { start: 0, stop: 0 }
  const harness = createHarness({
    nucleus: {
      on: () => () => {},
      startMailWatch: async () => {
        calls.start += 1
        return { ok: true }
      },
      stopMailWatch: async () => {
        calls.stop += 1
        return { ok: true }
      }
    }
  })
  const ctx = loadMailTabs(harness)
  await ctx.syncMailWatchLifecycle()
  assert.equal(calls.start, 1)
  assert.equal(calls.stop, 0)
})

test('syncMailWatchLifecycle stops watch when leaving mail tab', async () => {
  const calls = { start: 0, stop: 0 }
  const harness = createHarness({
    nucleus: {
      on: () => () => {},
      startMailWatch: async () => {
        calls.start += 1
        return { ok: true }
      },
      stopMailWatch: async () => {
        calls.stop += 1
        return { ok: true }
      }
    }
  })
  const ctx = loadMailTabs(harness)
  await ctx.ensureMailWatchStarted()
  ctx.state.activeTabId = 'synapse:nucleus'
  await ctx.syncMailWatchLifecycle()
  assert.equal(calls.start, 1)
  assert.equal(calls.stop, 1)
})
