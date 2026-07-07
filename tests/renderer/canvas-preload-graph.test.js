'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const graph = require('../../lib/canvas-preload-graph')
const planner = require('../../lib/canvas-preload-planner')

const NOW = Date.parse('2026-06-17T12:00:00.000Z')

function fixtureGraph() {
  return {
    events: [{
      courseid: '100',
      eventid: 'midterm',
      name: 'Midterm',
      startdate: '2026-06-20T15:00:00.000Z',
      type: 'test',
      coveredConcepts: [{ conceptid: 'c1' }]
    }],
    files: {
      100: {
        sg: {
          fileid: 'sg',
          name: 'Study Guide.pdf',
          canvaspreviewurl: 'https://canvas.example/courses/100/files/99',
          concepts: ['c1']
        }
      }
    },
    edges: [{
      fromType: 'event',
      fromId: 'midterm',
      toType: 'file',
      toId: 'sg',
      relation: 'requires_reading'
    }]
  }
}

function fixtureCanvasData() {
  return {
    assignments: {
      100: [{
        id: '20',
        name: 'Midterm Exam',
        due_at: '2026-06-20T15:00:00.000Z',
        html_url: 'https://canvas.example/courses/100/assignments/20'
      }]
    }
  }
}

test('collectGraphCandidates includes linked study file for upcoming event', () => {
  const candidates = graph.collectGraphCandidates(fixtureGraph(), fixtureCanvasData(), {
    focusCourseIds: ['100'],
    nowMs: NOW
  })

  const urls = candidates.map(item => item.url)
  assert.ok(urls.includes('https://canvas.example/courses/100/files/99'))
  assert.ok(urls.includes('https://canvas.example/courses/100/assignments/20'))
})

test('eventInHorizon rejects events outside window', () => {
  const far = { startdate: '2026-08-01T00:00:00.000Z' }
  assert.equal(graph.eventInHorizon(far, NOW), false)
})

test('planner boosts URLs that match high-priority tasks', () => {
  const canvasData = {
    weekly_schedule: {
      100: [{
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
        files: [],
        events: []
      }]
    },
    assignments: { 100: [] }
  }

  const tasks = [{
    id: 'task-1',
    courseId: '100',
    title: 'Finish Current HW',
    priority_weight: 9,
    urls: ['https://canvas.example/courses/100/assignments/20']
  }]

  const withTask = planner.planPreloadUrls(canvasData, {
    focusCourseIds: ['100'],
    tasks,
    activeUrl: 'https://canvas.example/courses/100',
    domLinks: [],
    nowMs: NOW,
    limit: 1
  })

  const withoutTask = planner.planPreloadUrls(canvasData, {
    focusCourseIds: ['100'],
    activeUrl: 'https://canvas.example/courses/100',
    domLinks: [],
    nowMs: NOW,
    limit: 1
  })

  assert.equal(withTask[0].url, 'https://canvas.example/courses/100/assignments/20')
  assert.ok(withTask[0].priority > withoutTask[0].priority)
})

test('graph event candidates outrank stale weekly items when due soon', () => {
  const canvasData = {
    weekly_schedule: {
      100: [{
        weekLabel: 'Week 2',
        weekStart: '2026-06-02T00:00:00.000Z',
        weekEnd: '2026-06-09T00:00:00.000Z',
        isCurrentWeek: false,
        assignments: [{
          assignmentid: '10',
          name: 'Old HW',
          url: 'https://canvas.example/courses/100/assignments/10',
          duedate: '2026-06-05T00:00:00.000Z'
        }],
        files: [],
        events: []
      }]
    },
    assignments: { 100: [] }
  }

  const ranked = planner.planPreloadUrls(canvasData, {
    focusCourseIds: ['100'],
    graph: fixtureGraph(),
    activeUrl: 'https://canvas.example/courses/100',
    domLinks: [],
    nowMs: NOW,
    limit: 2
  })

  const urls = ranked.map(item => item.url)
  assert.ok(urls.includes('https://canvas.example/courses/100/files/99'))
})
