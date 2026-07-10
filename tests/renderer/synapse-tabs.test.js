const test = require('node:test')
const assert = require('node:assert/strict')
const { createHarness } = require('./harness')

test('ensureLearnCourses loads courses through the Synapse curriculum bridge', async () => {
  const harness = createHarness({
    nucleus: {
      on: () => () => {},
      synapseListCourses: async () => ({
        ok: true,
        courses: [{ id: '101', name: 'Intro to Architecture' }]
      })
    }
  })
  harness.runScript('app/synapse/synapse-tabs.js')

  const tab = { learnSession: {} }
  const courses = await harness.context.ensureLearnCourses(tab)

  assert.deepEqual(courses, [{ id: '101', name: 'Intro to Architecture' }])
  assert.equal(tab.learnSession.coursesLoadState, 'done')
  assert.equal(tab.learnSession.coursesLoadError, '')
  assert.deepEqual(tab.learnSession.courses, courses)
})
