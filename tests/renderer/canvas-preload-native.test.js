'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { collectNativeSectionUrls } = require('../../lib/canvas-preload-native')

const NOW = Date.parse('2026-06-17T12:00:00.000Z')

function fixtureCanvasData() {
  return {
    weekly_schedule: {
      100: [{
        weekLabel: 'Week 5',
        weekStart: '2026-06-16T00:00:00.000Z',
        weekEnd: '2026-06-23T00:00:00.000Z',
        isCurrentWeek: true,
        assignments: [{
          name: 'HW 5',
          url: 'https://canvas.example/courses/100/assignments/20'
        }],
        files: [{
          name: 'slides.pdf',
          url: 'https://canvas.example/courses/100/files/50'
        }],
        events: []
      }]
    },
    assignments: {
      100: [
        {
          id: '20',
          name: 'HW 5',
          due_at: '2026-06-20T00:00:00.000Z',
          html_url: 'https://canvas.example/courses/100/assignments/20'
        },
        {
          id: '30',
          name: 'Quiz 3',
          due_at: '2026-06-19T00:00:00.000Z',
          html_url: 'https://canvas.example/courses/100/assignments/30'
        }
      ]
    },
    file: {
      100: [{
        id: '50',
        display_name: 'slides.pdf',
        url: 'https://canvas.example/courses/100/files/50'
      }]
    },
    module_items: {
      100: {
        1001: [{
          type: 'Assignment',
          html_url: 'https://canvas.example/courses/100/assignments/40'
        }]
      }
    }
  }
}

test('weekly section returns current week materials', () => {
  const urls = collectNativeSectionUrls(fixtureCanvasData(), {
    courseId: '100',
    courseSection: 'weekly',
    nowMs: NOW,
    limit: 3
  })
  assert.ok(urls.includes('https://canvas.example/courses/100/assignments/20'))
  assert.ok(urls.includes('https://canvas.example/courses/100/files/50'))
})

test('assignments section returns due-sorted assignment urls', () => {
  const urls = collectNativeSectionUrls(fixtureCanvasData(), {
    courseId: '100',
    courseSection: 'assignments',
    limit: 2
  })
  assert.equal(urls[0], 'https://canvas.example/courses/100/assignments/30')
})

test('homepage section prefers due-soon assignments', () => {
  const urls = collectNativeSectionUrls(fixtureCanvasData(), {
    courseId: '100',
    courseSection: 'homepage',
    nowMs: NOW,
    limit: 2
  })
  assert.ok(urls.length >= 1)
  assert.ok(urls.every(url => url.includes('/assignments/')))
})

test('modules section collects module item urls', () => {
  const urls = collectNativeSectionUrls(fixtureCanvasData(), {
    courseId: '100',
    courseSection: 'modules',
    limit: 2
  })
  assert.equal(urls[0], 'https://canvas.example/courses/100/assignments/40')
})
