const test = require('node:test')
const assert = require('node:assert/strict')
const { FOLDER_LABELS, MAIL_FOLDERS } = require('../../lib/mail-folders')

test('MAIL_FOLDERS includes primary inbox categories', () => {
  const ids = MAIL_FOLDERS.map(folder => folder.id)
  assert.deepEqual(ids.slice(0, 3), ['inbox', 'campus_events', 'secondary'])
})

test('FOLDER_LABELS maps renderer folders to Gmail label ids', () => {
  assert.equal(FOLDER_LABELS.inbox, 'INBOX')
  assert.equal(FOLDER_LABELS.starred, 'STARRED')
  assert.equal(FOLDER_LABELS.trash, 'TRASH')
})

test('every folder entry has a label and icon', () => {
  for (const folder of MAIL_FOLDERS) {
    assert.ok(folder.id)
    assert.ok(folder.label)
    assert.ok(folder.labelId)
    assert.ok(folder.icon)
  }
})
