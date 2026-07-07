const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildContextIndex,
  collectFocusCourseIds,
  compactDueSoon,
  courseIdFromUrl
} = require('../context-index')

test('courseIdFromUrl extracts Canvas course id', () => {
  assert.equal(courseIdFromUrl('https://canvas.example/courses/15160/files/1'), '15160')
  assert.equal(courseIdFromUrl('not-a-url'), '')
})

test('collectFocusCourseIds merges tab courseId and url', () => {
  const ids = collectFocusCourseIds(
    { courseId: '100', url: '' },
    [{ url: 'https://canvas.example/courses/200/pages/syllabus' }]
  )
  assert.deepEqual([...ids].sort(), ['100', '200'])
})

test('compactDueSoon filters by horizon and focus courses', () => {
  const now = Date.parse('2026-06-16T12:00:00.000Z')
  const dueSoon = compactDueSoon({
    assignments: {
      '100': [
        { id: '1', name: 'Past', due_at: '2026-06-10T00:00:00.000Z' },
        { id: '2', name: 'Soon', due_at: '2026-06-20T00:00:00.000Z' },
        { id: '3', name: 'Later', due_at: '2026-07-20T00:00:00.000Z' }
      ],
      '200': [{ id: '4', name: 'Other course', due_at: '2026-06-18T00:00:00.000Z' }]
    }
  }, new Set(['100']), now)
  assert.equal(dueSoon.length, 1)
  assert.equal(dueSoon[0].name, 'Soon')
})

test('buildContextIndex assembles native state without screen text', () => {
  const index = buildContextIndex({
    tasks: [{ id: 't1', title: 'Read chapter 3', due: 'Friday', course: 'BIO', priority_weight: 5 }],
    canvasData: {
      courses: [{ id: '100', course_code: 'BIO 101', name: 'Biology' }],
      weekly_schedule: {
        '100': [{
          weekLabel: 'Week 3',
          dateRange: 'Jun 16 – Jun 22',
          weekStart: '2026-06-16T00:00:00.000Z',
          weekEnd: '2026-06-22T23:59:59.000Z',
          isCurrentWeek: true,
          files: [{ name: 'Lecture 3.pdf' }],
          assignments: [{ name: 'Quiz 2' }],
          events: []
        }]
      },
      assignments: {
        '100': [{ id: 'a1', name: 'Quiz 2', due_at: '2026-06-18T00:00:00.000Z' }]
      }
    },
    activeTab: {
      courseId: '100',
      type: 'canvastab',
      label: 'Biology',
      courseSection: 'weekly',
      canvasNativePage: 'modules'
    },
    tabs: [{ courseId: '100', type: 'canvastab', label: 'Biology' }],
    nowMs: Date.parse('2026-06-16T12:00:00.000Z')
  })

  assert.equal(index.courses.length, 1)
  assert.equal(index.tasks[0].title, 'Read chapter 3')
  assert.equal(index.dueSoon[0].name, 'Quiz 2')
  assert.equal(index.weekly['100'].current.weekLabel, 'Week 3')
  assert.equal(index.focus.courseId, '100')
  assert.equal(index.focus.courseSection, 'weekly')
  assert.equal(index.focus.nativePage, 'modules')
  assert.ok(!Object.prototype.hasOwnProperty.call(index, 'text'))
})

test('buildContextIndex strips lone UTF-16 surrogates', () => {
  const index = buildContextIndex({
    tasks: [{ id: 't1', title: 'bad\udc8ftitle', due: '', course: '' }],
    canvasData: { courses: [], assignments: {} },
    activeTab: null,
    tabs: []
  })
  assert.equal(index.tasks[0].title.includes('\udc8f'), false)
  JSON.stringify(index)
})
