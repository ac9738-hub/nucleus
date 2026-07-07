'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { performance } = require('node:perf_hooks')

const planner = require('../../lib/canvas-preload-planner')

const NOW = Date.parse('2026-06-17T12:00:00.000Z')

function fixtureCanvasData() {
  return {
    courses: [{ id: '100', name: 'Example Course' }],
    weekly_schedule: {
      100: [
        {
          weekLabel: 'Week 4',
          weekStart: '2026-06-09T00:00:00.000Z',
          weekEnd: '2026-06-16T00:00:00.000Z',
          isCurrentWeek: false,
          assignments: [{
            assignmentid: '10',
            name: 'Old HW',
            url: 'https://canvas.example/courses/100/assignments/10',
            duedate: '2026-06-12T00:00:00.000Z'
          }],
          files: [],
          events: []
        },
        {
          weekLabel: 'Week 5',
          weekStart: '2026-06-16T00:00:00.000Z',
          weekEnd: '2026-06-23T00:00:00.000Z',
          isCurrentWeek: true,
          assignments: [{
            assignmentid: '20',
            name: 'Current HW',
            url: 'https://canvas.example/courses/100/assignments/20',
            duedate: '2026-06-20T00:00:00.000Z'
          }],
          files: [{
            id: 'f1',
            name: 'Lecture.pdf',
            url: 'https://canvas.example/courses/100/files/50'
          }],
          events: []
        }
      ]
    },
    assignments: {
      100: [
        {
          id: '20',
          name: 'Current HW',
          due_at: '2026-06-20T00:00:00.000Z',
          html_url: 'https://canvas.example/courses/100/assignments/20'
        },
        {
          id: '30',
          name: 'Due soon other',
          due_at: '2026-06-19T00:00:00.000Z',
          html_url: 'https://canvas.example/courses/100/assignments/30'
        }
      ]
    }
  }
}

test('planPreloadUrls prefers current week assignment over older week', () => {
  const ranked = planner.planPreloadUrls(fixtureCanvasData(), {
    focusCourseIds: ['100'],
    activeUrl: 'https://canvas.example/courses/100',
    domLinks: [],
    nowMs: NOW,
    limit: 3
  })

  assert.ok(ranked.length >= 1)
  const urls = ranked.map(item => item.url)
  assert.ok(urls.includes('https://canvas.example/courses/100/assignments/20'))
  assert.ok(!urls.includes('https://canvas.example/courses/100/assignments/10'))
})

test('DOM link on page boosts matching weekly candidate', () => {
  const ranked = planner.planPreloadUrls(fixtureCanvasData(), {
    focusCourseIds: ['100'],
    activeUrl: 'https://canvas.example/courses/100/modules',
    domLinks: [
      'https://canvas.example/courses/100/files/50'
    ],
    nowMs: NOW,
    limit: 2
  })

  assert.equal(ranked.length, 2)
  assert.equal(ranked[0].url, 'https://canvas.example/courses/100/files/50')
})

test('due-soon assignment enters plan when not in weekly bucket', () => {
  const data = fixtureCanvasData()
  data.weekly_schedule[100][1].assignments = []
  const ranked = planner.planPreloadUrls(data, {
    focusCourseIds: ['100'],
    activeUrl: 'https://canvas.example/courses/100',
    domLinks: [],
    nowMs: NOW,
    limit: 2
  })

  const urls = ranked.map(item => item.url)
  assert.ok(urls.includes('https://canvas.example/courses/100/assignments/30'))
})

test('planner collect stays under 5ms on fixture data', () => {
  const start = performance.now()
  for (let i = 0; i < 200; i += 1) {
    planner.collectCandidates(fixtureCanvasData(), {
      focusCourseIds: ['100'],
      activeUrl: 'https://canvas.example/courses/100',
      domLinks: ['https://canvas.example/courses/100/files/50'],
      nowMs: NOW
    })
  }
  const perCallMs = (performance.now() - start) / 200
  assert.ok(perCallMs < 5, `planner collect ${perCallMs.toFixed(2)}ms exceeds 5ms`)
})

test('normalizeCanvasUrl rejects download links and canonicalizes wrap previews', () => {
  assert.equal(
    planner.normalizeCanvasUrl('https://canvas.example/files/1/download?download_frd=1'),
    ''
  )
  assert.equal(
    planner.normalizeCanvasUrl('https://canvas.example/courses/100/files/50?wrap=1'),
    'https://canvas.example/courses/100/files/50'
  )
})

test('sibling canvas tabs boost same-course candidates', () => {
  const ranked = planner.planPreloadUrls(fixtureCanvasData(), {
    focusCourseIds: ['100'],
    siblingCourseCounts: { 100: 2 },
    activeUrl: 'https://canvas.example/courses/100',
    domLinks: [],
    nowMs: NOW,
    limit: 3
  })

  const withoutSibling = planner.planPreloadUrls(fixtureCanvasData(), {
    focusCourseIds: ['100'],
    activeUrl: 'https://canvas.example/courses/100',
    domLinks: [],
    nowMs: NOW,
    limit: 3
  })

  assert.ok(ranked[0].priority > withoutSibling[0].priority)
})
