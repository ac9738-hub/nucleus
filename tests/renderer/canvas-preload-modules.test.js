'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const modules = require('../../lib/canvas-preload-modules')
const planner = require('../../lib/canvas-preload-planner')

const COURSE = '101'
const BASE = `https://canvas.example/courses/${COURSE}`

function fixtureCanvasData() {
  return {
    modules: {
      [COURSE]: [
        { id: 'm1', name: 'Week 1', position: 1 },
        { id: 'm2', name: 'Week 2', position: 2 }
      ]
    },
    module_items: {
      [COURSE]: {
        m1: [
          {
            id: 'i1',
            position: 1,
            title: 'Reading',
            html_url: `${BASE}/modules/items/1`,
            url: `${BASE}/pages/reading`
          },
          {
            id: 'i2',
            position: 2,
            title: 'HW 1',
            html_url: `${BASE}/assignments/10`,
            url: `${BASE}/assignments/10`
          },
          {
            id: 'i3',
            position: 3,
            title: 'Slides',
            html_url: `${BASE}/files/20`,
            url: `${BASE}/files/20`
          }
        ],
        m2: [
          {
            id: 'i4',
            position: 1,
            title: 'HW 2',
            html_url: `${BASE}/assignments/11`,
            url: `${BASE}/assignments/11`
          }
        ]
      }
    },
    weekly_schedule: {},
    assignments: { [COURSE]: [] }
  }
}

test('collectModuleSequenceCandidates returns next module items after active url', () => {
  const candidates = modules.collectModuleSequenceCandidates(
    fixtureCanvasData(),
    [COURSE],
    `${BASE}/assignments/10`
  )

  const urls = candidates.map(item => item.url)
  assert.ok(urls.includes(`${BASE}/files/20`))
  assert.ok(urls.includes(`${BASE}/assignments/11`))
  assert.equal(candidates[0].sequenceOffset, 1)
})

test('pathsLikelySame matches assignment urls across module item shapes', () => {
  assert.equal(
    modules.pathsLikelySame(`${BASE}/assignments/10`, `${BASE}/modules/items/2`),
    false
  )
  assert.equal(
    modules.pathsLikelySame(`${BASE}/assignments/10`, `${BASE}/assignments/10/`),
    true
  )
})

test('planner boosts immediate module successor over later items', () => {
  const ranked = planner.planPreloadUrls(fixtureCanvasData(), {
    focusCourseIds: [COURSE],
    activeUrl: `${BASE}/assignments/10`,
    domLinks: [],
    nowMs: Date.now(),
    limit: 2
  })

  assert.equal(ranked[0].url, `${BASE}/files/20`)
  assert.equal(ranked[0].source, 'module_sequence')
})

test('module sequence skipped when active url not in module order', () => {
  const candidates = modules.collectModuleSequenceCandidates(
    fixtureCanvasData(),
    [COURSE],
    `${BASE}/grades`
  )
  assert.equal(candidates.length, 0)
})
