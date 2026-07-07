'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { heuristicClassify, NON_ACADEMIC, ACADEMIC, CAMPUS_EVENTS } = require('../app/mail/classify')
const { heuristicExtractEvents, messageLikelyHasEvents } = require('../app/mail/events')

test('heuristicClassify routes Gmail promotions to secondary inbox', () => {
  const result = heuristicClassify({
    from: 'Store <sale@shop.example>',
    subject: 'Limited time offer',
    snippet: 'Shop now and save 40%',
    labelIds: ['INBOX', 'CATEGORY_PROMOTIONS']
  })
  assert.equal(result.label, NON_ACADEMIC)
  assert.ok(result.confidence >= 0.9)
})

test('heuristicClassify routes career fair mail to campus events', () => {
  const result = heuristicClassify({
    from: 'Student Activities <events@university.edu>',
    subject: 'Spring Career Fair - RSVP today',
    snippet: 'Join us for the campus career fair on March 18. Register for the event.',
    labelIds: ['INBOX', 'CATEGORY_UPDATES']
  })
  assert.equal(result.label, CAMPUS_EVENTS)
  assert.ok(result.confidence >= 0.8)
})

test('heuristicClassify keeps course assignment mail in primary inbox', () => {
  const result = heuristicClassify({
    from: 'Professor <prof@university.edu>',
    subject: 'Problem set 4 due Friday',
    snippet: 'Submit the assignment in Canvas before the deadline.',
    labelIds: ['INBOX', 'CATEGORY_UPDATES']
  })
  assert.equal(result.label, ACADEMIC)
})

test('heuristicClassify defaults uncertain mail to secondary inbox', () => {
  const result = heuristicClassify({
    from: 'Friend <friend@example.com>',
    subject: 'Catch up soon?',
    snippet: 'Want to grab coffee next week?',
    labelIds: ['INBOX', 'CATEGORY_PERSONAL']
  })
  assert.equal(result.label, NON_ACADEMIC)
})

test('heuristicExtractEvents finds exam date in academic subject', () => {
  const events = heuristicExtractEvents({
    id: 'msg-1',
    subject: 'Midterm exam on March 12',
    snippet: 'The midterm exam will be held in lecture hall B on March 12 at 2pm.',
    receivedAtMs: Date.parse('2026-02-01T12:00:00Z')
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'exam')
  assert.equal(events[0].date, '2026-03-12')
  assert.equal(events[0].time, '14:00')
})

test('heuristicExtractEvents finds assignment deadline', () => {
  const events = heuristicExtractEvents({
    id: 'msg-2',
    subject: 'PS 4 due 3/15',
    snippet: 'Submit your problem set by 3/15 before 11:59 PM.',
    receivedAtMs: Date.parse('2026-03-01T12:00:00Z')
  })
  assert.ok(events.length >= 1)
  assert.equal(events[0].type, 'deadline')
  assert.equal(events[0].date, '2026-03-15')
})

test('messageLikelyHasEvents ignores non-event mail', () => {
  assert.equal(messageLikelyHasEvents({
    subject: 'Thanks for your note',
    snippet: 'Glad we could chat yesterday.'
  }), false)
})
