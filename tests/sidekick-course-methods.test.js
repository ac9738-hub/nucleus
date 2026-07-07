const test = require('node:test')
const assert = require('node:assert/strict')
const {
  pollCourseProblemSolvingContext,
  formatCourseMethodsContext,
  buildVectorRetrievalOptions,
  compactMethodRows
} = require('../sidekick-course-methods')

const SAMPLE_GRAPH = {
  concepts: [{
    conceptid: 'c1',
    courseid: '100',
    name: 'Chain rule',
    description: 'Differentiate composite functions',
    details: [{ name: 'Statement', description: 'dy/dx = f\'(g(x)) g\'(x)' }],
    examples: [{ name: 'Worked example', description: 'Find derivative of sin(x^2)' }]
  }],
  problems: [{
    problemid: 'p1',
    courseid: '100',
    name: 'Problem 3 chain rule',
    description: 'Compute derivative using chain rule',
    incomingConceptNodeIds: ['c1'],
    steps: [{ text: 'Identify outer and inner functions' }]
  }],
  files: {
    100: {
      f1: {
        courseid: '100',
        fileid: 'f1',
        name: 'Formula sheet.pdf',
        academicFileType: 'reference_sheet',
        typeExtractions: {
          textbook: {
            definitions: [{ term: 'Chain rule', definition: 'Use substitution for composites' }]
          }
        }
      }
    }
  },
  learningBlocks: {
    100: [{ conceptId: 'c1', explanation: 'Always name u and du before substituting.' }]
  },
  assignments: [{
    courseid: '100',
    name: 'PSET 2',
    lookingfor: ['Show substitution steps'],
    conceptRequirements: ['Chain rule']
  }]
}

test('pollCourseProblemSolvingContext links problems to concepts and formulas', () => {
  const poll = pollCourseProblemSolvingContext({
    graph: SAMPLE_GRAPH,
    query: 'help me with problem 3 chain rule',
    courseIds: ['100'],
    visibleNodes: { concepts: [], details: [], examples: [], problems: [] }
  })
  assert.equal(poll.problems.length, 1)
  assert.equal(poll.concepts.length, 1)
  assert.equal(poll.concepts[0].name, 'Chain rule')
  assert.ok(poll.formulas.some(row => row.label.includes('Chain rule')))
  assert.equal(poll.learningBlocks.length, 1)
})

test('formatCourseMethodsContext includes course alignment guidance', () => {
  const poll = pollCourseProblemSolvingContext({
    graph: SAMPLE_GRAPH,
    query: 'chain rule problem 3',
    courseIds: ['100'],
    visibleNodes: { concepts: [], details: [], examples: [], problems: [] }
  })
  const text = formatCourseMethodsContext(poll)
  assert.match(text, /Course graph/)
  assert.match(text, /Chain rule/)
  assert.match(text, /course-specific concepts/)
})

test('buildVectorRetrievalOptions enables grounded problem retrieval', () => {
  const options = buildVectorRetrievalOptions({
    hints: { problemQuery: true, academicQuery: true },
    answerMode: 'grounded',
    contextSnapshot: {
      index: { focusCourseIds: ['100'] },
      workspaceContext: {
        restrictToFocus: true,
        focusCourseIds: ['100'],
        preferFocus: ['100']
      }
    },
    screenSlice: null,
    k: 5
  })
  assert.equal(options.grounded, true)
  assert.equal(options.problemQuery, true)
  assert.deepEqual(options.focusCourseIds, ['100'])
})

test('compactMethodRows extracts definition text', () => {
  const rows = compactMethodRows({
    textbook: {
      definitions: [{ term: 'Gradient', definition: 'Vector of partial derivatives' }]
    }
  })
  assert.equal(rows.length, 1)
  assert.match(rows[0].text, /partial derivatives/)
})
