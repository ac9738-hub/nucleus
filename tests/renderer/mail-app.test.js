const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')
const { sampleMailState } = require('./fixtures')

function mountMail(harness, state = sampleMailState()) {
  harness.loadMailStack()
  const tab = { id: 'mail:nucleus', type: 'mailtab', workspaceId: 'nucleus', label: 'Mail' }
  const html = harness.window.nucleusMailApp.renderMailApp(tab, state)
  harness.document.getElementById('view').innerHTML = html
  harness.window.nucleusMailApp.mountMailControllerIfNeeded(
    harness.document.getElementById('view'),
    tab
  )
  return { tab, state }
}

test('renderMailApp includes inbox navigation and search', () => {
  const harness = createHarness()
  mountMail(harness)
  const root = harness.window.nucleusMailApp.getMailRoot()
  assert.ok(root)
  assert.ok(root.matches('[data-mail-app]'))
  assert.ok(root.querySelector('[data-mail-folder="inbox"]'))
  assert.ok(root.querySelector('[data-mail-search]'))
})

test('renderMailApp escapes malicious subjects in list rows', () => {
  const harness = createHarness()
  const state = sampleMailState()
  state.messages = [{
    id: 'bad',
    subject: '<img src=x onerror=alert(1)>',
    snippet: 'x',
    from: 'Attacker <bad@example.com>',
    dateLabel: 'Today',
    unread: true,
    inboxCategory: 'academic'
  }]
  mountMail(harness, state)
  const root = harness.window.nucleusMailApp.getMailRoot()
  assert.doesNotMatch(root.innerHTML, /<img[^>]*onerror/)
  assert.match(root.innerHTML, /&lt;img/)
})

test('renderMailApp sanitizes Gmail HTML message bodies', () => {
  const harness = createHarness()
  const state = sampleMailState()
  state.selectedId = 'bad-html'
  state.selectedMessage = {
    id: 'bad-html',
    subject: 'Malicious body',
    from: 'Attacker <bad@example.com>',
    to: 'Student <student@example.com>',
    dateLabel: 'Today',
    bodyHtml: [
      '<p>Hello <strong>student</strong></p>',
      '<img src="javascript:alert(1)" onerror="window.pwned=true">',
      '<a href="javascript:alert(2)" onclick="window.pwned=true">click me</a>',
      '<script>window.pwned=true</script>',
      '<iframe srcdoc="<script>window.pwned=true</script>"></iframe>'
    ].join('')
  }

  mountMail(harness, state)

  const root = harness.window.nucleusMailApp.getMailRoot()
  assert.match(root.textContent, /Hello student/)
  assert.equal(root.querySelector('script'), null)
  assert.equal(root.querySelector('iframe'), null)
  assert.equal(root.querySelector('[onerror]'), null)
  assert.equal(root.querySelector('[onclick]'), null)
  assert.doesNotMatch(root.innerHTML, /javascript:alert/)
})

test('patchMailView updates list scope without full rerender', () => {
  const harness = createHarness()
  const { state } = mountMail(harness)
  state.statusMessage = 'Archived message'
  const patched = harness.window.nucleusMailApp.patchMailView(state, 'status')
  assert.equal(patched, true)
  const status = harness.window.nucleusMailApp.getMailRoot().querySelector('[data-mail-status]')
  assert.ok(status)
  assert.equal(status.textContent, 'Archived message')
})

test('patchMailView updates sidebar folder active state', () => {
  const harness = createHarness()
  const { state } = mountMail(harness)
  state.folder = 'starred'
  harness.window.nucleusMailApp.patchMailView(state, 'sidebar')
  const starred = harness.window.nucleusMailApp.getMailRoot().querySelector('[data-mail-folder="starred"]')
  assert.ok(starred.classList.contains('is-active'))
})

test('patchMailRow replaces a single message row', () => {
  const harness = createHarness()
  const { state } = mountMail(harness)
  const root = harness.window.nucleusMailApp.getMailRoot()
  const updated = { ...state.messages[0], unread: false, subject: 'Updated subject' }
  harness.window.nucleusMailApp.patchMailRow(root, updated, state)
  const row = root.querySelector('.mail-row[data-mail-id="m1"]')
  assert.ok(row)
  assert.match(row.textContent, /Updated subject/)
})
