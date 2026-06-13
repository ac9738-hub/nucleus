const test = require('node:test')
const assert = require('node:assert/strict')
const {
  resolveSchedulingDate,
  resolveWeekStartMs,
  resolveModuleAnchorWeekMs,
  startOfWeekMs,
  buildCourseWeeklySchedule
} = require('../app/canvas/weekly-schedule')

const WEEK_JAN_6 = startOfWeekMs('2025-01-08T12:00:00Z')
const WEEK_JAN_13 = startOfWeekMs('2025-01-15T12:00:00Z')
const WEEK_FEB_3 = startOfWeekMs('2025-02-05T12:00:00Z')
const WEEK_MAR_10 = startOfWeekMs('2025-03-12T12:00:00Z')

function matchLoggedAssignment(loggedAssignments, moduleItem) {
  const contentId = String(moduleItem && moduleItem.content_id || '').trim()
  return loggedAssignments.find(assignment => String(assignment.assignmentid || '') === contentId) || null
}

test('resolveSchedulingDate prefers Canvas due_at over parsed duedate', () => {
  const logged = { duedate: '2025-01-20T23:59:00Z' }
  const canvas = { due_at: '2025-01-10T23:59:00Z' }
  assert.equal(resolveSchedulingDate(logged, canvas), '2025-01-10T23:59:00Z')
})

test('resolveSchedulingDate uses parsed duedate when Canvas due is missing', () => {
  const logged = { duedate: '2025-01-20T23:59:00Z' }
  assert.equal(resolveSchedulingDate(logged, null), '2025-01-20T23:59:00Z')
})

test('resolveSchedulingDate falls back to lock_at after unlock dates', () => {
  const logged = { lockdate: '2025-03-12T23:59:00Z' }
  const canvas = { lock_at: '2025-03-05T23:59:00Z' }
  assert.equal(resolveSchedulingDate(logged, canvas), '2025-03-05T23:59:00Z')
})

test('resolveSchedulingDate falls back to unlock dates before parsed lockdate', () => {
  const logged = { unlockdate: '2025-02-05T08:00:00Z', lockdate: '2025-02-10T08:00:00Z' }
  const canvas = { unlock_at: '2025-02-01T08:00:00Z' }
  assert.equal(resolveSchedulingDate(logged, canvas), '2025-02-01T08:00:00Z')
})

test('resolveWeekStartMs uses module anchor when item has no dates', () => {
  const weekMs = resolveWeekStartMs({ name: 'Undated' }, null, WEEK_JAN_6)
  assert.equal(weekMs, WEEK_JAN_6)
})

test('resolveWeekStartMs returns null without dates or anchor', () => {
  assert.equal(resolveWeekStartMs({ name: 'Undated' }, null, null), null)
})

test('resolveModuleAnchorWeekMs uses first dated member by position not earliest week', () => {
  const courseId = '101'
  const loggedAssignments = [
    { assignmentid: '1', name: 'Later first', duedate: '2025-03-12T23:59:00Z' },
    { assignmentid: '2', name: 'Earlier second', duedate: '2025-02-05T23:59:00Z' }
  ]
  const lookup = {
    assignmentByCourseAndId: new Map([
      [`${courseId}:1`, { id: '1', due_at: '2025-03-12T23:59:00Z' }],
      [`${courseId}:2`, { id: '2', due_at: '2025-02-05T23:59:00Z' }]
    ])
  }
  const items = [
    { type: 'Assignment', content_id: '1', position: 1 },
    { type: 'Assignment', content_id: '2', position: 2 }
  ]

  assert.equal(
    resolveModuleAnchorWeekMs(items, courseId, loggedAssignments, lookup, matchLoggedAssignment),
    WEEK_MAR_10
  )
})

test('resolveModuleAnchorWeekMs can anchor from Canvas due when parsed due is empty', () => {
  const courseId = '101'
  const loggedAssignments = [
    { assignmentid: '1', name: 'Canvas only', duedate: '' }
  ]
  const lookup = {
    assignmentByCourseAndId: new Map([
      [`${courseId}:1`, { id: '1', due_at: '2025-01-15T23:59:00Z' }]
    ])
  }
  const items = [{ type: 'Assignment', content_id: '1', position: 1 }]

  assert.equal(
    resolveModuleAnchorWeekMs(items, courseId, loggedAssignments, lookup, matchLoggedAssignment),
    WEEK_JAN_13
  )
})

test('resolveModuleAnchorWeekMs skips non-assignment items until first dated assignment', () => {
  const courseId = '101'
  const loggedAssignments = [
    { assignmentid: '2', name: 'Second item', duedate: '2025-01-15T23:59:00Z' }
  ]
  const lookup = {
    assignmentByCourseAndId: new Map([
      [`${courseId}:2`, { id: '2', due_at: '2025-01-15T23:59:00Z' }]
    ])
  }
  const items = [
    { type: 'File', content_id: '99', position: 1 },
    { type: 'Assignment', content_id: '2', position: 2 }
  ]

  assert.equal(
    resolveModuleAnchorWeekMs(items, courseId, loggedAssignments, lookup, matchLoggedAssignment),
    WEEK_JAN_13
  )
})

test('resolveWeekStartMs prefers Canvas due for remaining-assignment style lookup', () => {
  const logged = { assignmentid: '5', name: 'HW', duedate: '' }
  const canvas = { due_at: '2025-01-08T23:59:00Z' }
  assert.equal(resolveWeekStartMs(logged, canvas, null), WEEK_JAN_6)
})

test('buildCourseWeeklySchedule places dated assignments in calendar weeks', () => {
  const courseId = '101'
  const loggedAssignments = [
    { assignmentid: '1', name: 'HW 1', duedate: '2025-01-10T23:59:00Z', filechildren: [] }
  ]
  const lookup = {
    assignmentByCourseAndId: new Map([
      [`${courseId}:1`, { id: '1', due_at: '2025-01-10T23:59:00Z', html_url: 'https://canvas.test/a/1' }]
    ])
  }
  const weeks = buildCourseWeeklySchedule({
    courseId,
    modules: [{ id: 'm1', name: 'Week 1', position: 0 }],
    moduleItems: {
      m1: [{ type: 'Assignment', content_id: '1', position: 1 }]
    },
    canvasFiles: [],
    loggedAssignments,
    lookup,
    matchLoggedAssignment,
    resolveWeeklyFile: () => null,
    findCanvasAssignment: () => null,
    compactWeeklyAssignment: (assignment, canvasAssignment) => ({
      assignmentid: assignment.assignmentid,
      name: assignment.name,
      description: '',
      duedate: canvasAssignment.due_at,
      unlockdate: '',
      url: canvasAssignment.html_url,
      filechildren: []
    })
  })

  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].weekLabel, 'Week 1')
  assert.equal(weeks[0].assignments.length, 1)
  assert.equal(weeks[0].assignments[0].name, 'HW 1')
})

test('buildCourseWeeklySchedule clusters undated module items by module', () => {
  const courseId = '101'
  const loggedAssignments = [
    { assignmentid: '1', name: 'Reading', duedate: '', filechildren: [] }
  ]
  const lookup = { assignmentByCourseAndId: new Map() }
  const weeks = buildCourseWeeklySchedule({
    courseId,
    modules: [{ id: 'm1', name: 'Intro Materials', position: 0 }],
    moduleItems: {
      m1: [
        { type: 'File', content_id: 'f1', title: 'Syllabus.pdf', position: 1 },
        { type: 'Assignment', content_id: '1', position: 2 }
      ]
    },
    canvasFiles: [],
    loggedAssignments,
    lookup,
    matchLoggedAssignment,
    resolveWeeklyFile: () => ({
      id: 'f1',
      name: 'Syllabus.pdf',
      courseid: courseId,
      url: 'https://canvas.test/files/f1'
    }),
    findCanvasAssignment: () => null,
    compactWeeklyAssignment: assignment => ({
      assignmentid: assignment.assignmentid,
      name: assignment.name,
      description: '',
      duedate: '',
      unlockdate: '',
      url: '',
      filechildren: []
    })
  })

  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].weekLabel, 'Unscheduled')
  assert.equal(weeks[0].moduleGroups.length, 1)
  assert.equal(weeks[0].moduleGroups[0].moduleName, 'Intro Materials')
  assert.equal(weeks[0].moduleGroups[0].files.length, 1)
  assert.equal(weeks[0].moduleGroups[0].assignments.length, 1)
})

test('buildCourseWeeklySchedule uses parsed url_to_node dates in pass two', () => {
  const courseId = '101'
  const loggedAssignments = [
    {
      assignmentid: '1',
      name: 'HW 1',
      duedate: '',
      canvaspreviewurl: 'https://canvas.test/courses/101/assignments/1',
      filechildren: []
    },
    {
      assignmentid: 'parsed-1',
      name: 'HW 1 parsed',
      duedate: '2025-02-05T23:59:00Z',
      canvaspreviewurl: 'https://canvas.test/courses/101/assignments/1',
      filechildren: []
    }
  ]
  const lookup = { assignmentByCourseAndId: new Map() }
  const weeks = buildCourseWeeklySchedule({
    courseId,
    modules: [{ id: 'm1', name: 'Assignments', position: 0 }],
    moduleItems: {
      m1: [{ type: 'Assignment', content_id: '1', html_url: 'https://canvas.test/courses/101/assignments/1', position: 1 }]
    },
    canvasFiles: [],
    loggedAssignments,
    lookup,
    matchLoggedAssignment,
    resolveWeeklyFile: () => null,
    findCanvasAssignment: () => null,
    compactWeeklyAssignment: assignment => ({
      assignmentid: assignment.assignmentid,
      name: assignment.name,
      description: '',
      duedate: assignment.duedate,
      unlockdate: '',
      url: assignment.canvaspreviewurl,
      filechildren: []
    }),
    urlToNode: {
      'https://canvas.test/courses/101/assignments/1': {
        type: 'assignment',
        courseid: courseId,
        nodeId: 'parsed-1',
        name: 'HW 1 parsed'
      }
    }
  })

  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].weekLabel, 'Week 1')
  assert.equal(weeks[0].assignments[0].name, 'HW 1')
})

test('buildCourseWeeklySchedule uses week-name set points in pass four', () => {
  const courseId = '101'
  const loggedAssignments = [
    { assignmentid: '1', name: 'HW 1', duedate: '2025-01-10T23:59:00Z', filechildren: [] },
    { assignmentid: '2', name: 'Reading', duedate: '', filechildren: [] }
  ]
  const lookup = {
    assignmentByCourseAndId: new Map([
      [`${courseId}:1`, { id: '1', due_at: '2025-01-10T23:59:00Z' }],
      [`${courseId}:2`, { id: '2' }]
    ])
  }
  const weeks = buildCourseWeeklySchedule({
    courseId,
    modules: [
      { id: 'm1', name: 'Week 1', position: 0 },
      { id: 'm2', name: 'Week 2', position: 1 }
    ],
    moduleItems: {
      m1: [{ type: 'Assignment', content_id: '1', position: 1 }],
      m2: [{ type: 'Assignment', content_id: '2', position: 1 }]
    },
    canvasFiles: [],
    loggedAssignments,
    lookup,
    matchLoggedAssignment,
    resolveWeeklyFile: () => null,
    findCanvasAssignment: () => null,
    compactWeeklyAssignment: (assignment, canvasAssignment) => ({
      assignmentid: assignment.assignmentid,
      name: assignment.name,
      description: '',
      duedate: (canvasAssignment && canvasAssignment.due_at) || assignment.duedate || '',
      unlockdate: '',
      url: '',
      filechildren: []
    })
  })

  assert.equal(weeks.length, 2)
  assert.equal(weeks[0].assignments.length, 1)
  assert.equal(weeks[1].assignments.length, 1)
  assert.equal(weeks[1].assignments[0].name, 'Reading')
})

test('buildCourseWeeklySchedule inherits module anchor for undated items in dated modules', () => {
  const courseId = '101'
  const loggedAssignments = [
    { assignmentid: '1', name: 'HW 1', duedate: '2025-01-10T23:59:00Z', filechildren: [] },
    { assignmentid: '2', name: 'Reading', duedate: '', filechildren: [] }
  ]
  const lookup = {
    assignmentByCourseAndId: new Map([
      [`${courseId}:1`, { id: '1', due_at: '2025-01-10T23:59:00Z' }],
      [`${courseId}:2`, { id: '2' }]
    ])
  }
  const weeks = buildCourseWeeklySchedule({
    courseId,
    modules: [{ id: 'm1', name: 'Week 1', position: 0 }],
    moduleItems: {
      m1: [
        { type: 'Assignment', content_id: '1', position: 1 },
        { type: 'Assignment', content_id: '2', position: 2 },
        { type: 'File', content_id: 'f1', title: 'Notes.pdf', position: 3 }
      ]
    },
    canvasFiles: [],
    loggedAssignments,
    lookup,
    matchLoggedAssignment,
    resolveWeeklyFile: () => ({ id: 'f1', name: 'Notes.pdf', courseid: courseId, url: '' }),
    findCanvasAssignment: () => null,
    compactWeeklyAssignment: (assignment, canvasAssignment) => ({
      assignmentid: assignment.assignmentid,
      name: assignment.name,
      description: '',
      duedate: (canvasAssignment && canvasAssignment.due_at) || assignment.duedate || '',
      unlockdate: '',
      url: '',
      filechildren: []
    })
  })

  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].assignments.length, 2)
  assert.equal(weeks[0].files.length, 1)
})

test('buildCourseWeeklySchedule adds parser events with unattached materials', () => {
  const courseId = '101'
  const weeks = buildCourseWeeklySchedule({
    courseId,
    modules: [],
    moduleItems: {},
    canvasFiles: [],
    loggedAssignments: [
      {
        assignmentid: 'linked',
        name: 'Midterm review',
        duedate: '',
        conceptRequirements: ['concept-1'],
        filechildren: []
      }
    ],
    lookup: { assignmentByCourseAndId: new Map() },
    matchLoggedAssignment,
    resolveWeeklyFile: (cid, fileId) => ({
      id: fileId,
      name: `File ${fileId}`,
      courseid: cid,
      url: `https://canvas.test/files/${fileId}`
    }),
    findCanvasAssignment: () => null,
    compactWeeklyAssignment: assignment => ({
      assignmentid: assignment.assignmentid,
      name: assignment.name,
      description: '',
      duedate: assignment.duedate,
      unlockdate: '',
      url: '',
      filechildren: []
    }),
    graphEvents: [{
      courseid: courseId,
      eventid: 'midterm-event',
      name: 'Midterm',
      startdate: '2025-03-10T15:00:00Z',
      enddate: '2025-03-10T17:00:00Z',
      type: 'test',
      dependencies: ['concept-1']
    }],
    concepts: [{
      courseid: courseId,
      conceptid: 'concept-1',
      name: 'Cell Biology',
      problems: ['problem-1']
    }],
    graphFiles: {
      [courseId]: {
        f1: {
          fileid: 'f1',
          courseid: courseId,
          name: 'Study Guide.pdf',
          concepts: ['concept-1']
        }
      }
    }
  })

  const eventWeek = weeks.find(week => (week.events || []).some(entry => entry.event.name === 'Midterm'))
  assert.ok(eventWeek)
  const eventEntry = eventWeek.events.find(entry => entry.event.name === 'Midterm')
  assert.equal(eventEntry.files.length, 1)
  assert.equal(eventEntry.assignments.length, 1)
  assert.equal(eventEntry.concepts.length, 1)
})

test('buildCourseWeeklySchedule attaches study material files via event edges', () => {
  const courseId = '101'
  const weeks = buildCourseWeeklySchedule({
    courseId,
    modules: [],
    moduleItems: {},
    canvasFiles: [],
    loggedAssignments: [],
    lookup: { assignmentByCourseAndId: new Map() },
    matchLoggedAssignment,
    resolveWeeklyFile: (cid, fileId) => ({
      id: fileId,
      name: `File ${fileId}`,
      courseid: cid,
      url: `https://canvas.test/files/${fileId}`
    }),
    findCanvasAssignment: () => null,
    compactWeeklyAssignment: assignment => ({
      assignmentid: assignment.assignmentid,
      name: assignment.name,
      description: '',
      duedate: assignment.duedate || '',
      unlockdate: '',
      url: '',
      filechildren: []
    }),
    graphEvents: [{
      courseid: courseId,
      eventid: 'midterm-event',
      name: 'Midterm',
      startdate: '2025-03-10T15:00:00Z',
      enddate: '2025-03-10T17:00:00Z',
      type: 'test',
      dependencies: []
    }],
    graphFiles: {
      [courseId]: {
        past: {
          fileid: 'past',
          courseid: courseId,
          name: 'Midterm_F2011.pdf',
          type: 'study_material'
        }
      }
    },
    graphEdges: [{
      fromType: 'event',
      fromId: 'midterm-event',
      toType: 'file',
      toId: 'past',
      relation: 'requires_reading'
    }]
  })

  const eventWeek = weeks.find(week => (week.events || []).some(entry => entry.event.name === 'Midterm'))
  assert.ok(eventWeek)
  const eventEntry = eventWeek.events.find(entry => entry.event.name === 'Midterm')
  assert.equal(eventEntry.files.length, 1)
  assert.equal(eventEntry.files[0].id, 'past')
})

test('buildCourseWeeklySchedule skips event attachments already placed in weeks', () => {
  const courseId = '101'
  const weeks = buildCourseWeeklySchedule({
    courseId,
    modules: [{ id: 'm1', name: 'Week 1', position: 0 }],
    moduleItems: {
      m1: [{ type: 'File', content_id: 'f1', title: 'Study Guide.pdf', position: 1 }]
    },
    canvasFiles: [{
      id: 'f1',
      display_name: 'Study Guide.pdf',
      unlock_at: '2025-01-08T08:00:00Z'
    }],
    loggedAssignments: [],
    lookup: { assignmentByCourseAndId: new Map() },
    matchLoggedAssignment,
    resolveWeeklyFile: (cid, fileId) => ({
      id: fileId,
      name: 'Study Guide.pdf',
      courseid: cid,
      url: `https://canvas.test/files/${fileId}`
    }),
    findCanvasAssignment: () => null,
    compactWeeklyAssignment: assignment => ({
      assignmentid: assignment.assignmentid,
      name: assignment.name,
      description: '',
      duedate: assignment.duedate || '',
      unlockdate: '',
      url: '',
      filechildren: []
    }),
    graphEvents: [{
      courseid: courseId,
      eventid: 'midterm-event',
      name: 'Midterm',
      startdate: '2025-03-10T15:00:00Z',
      type: 'test',
      dependencies: ['concept-1']
    }],
    concepts: [{
      courseid: courseId,
      conceptid: 'concept-1',
      name: 'Cell Biology'
    }],
    graphFiles: {
      [courseId]: {
        f1: {
          fileid: 'f1',
          courseid: courseId,
          name: 'Study Guide.pdf',
          concepts: ['concept-1']
        }
      }
    }
  })

  const eventWeek = weeks.find(week => (week.events || []).length)
  assert.ok(eventWeek)
  const eventEntry = eventWeek.events[0]
  assert.equal(eventEntry.files.length, 0)
  assert.equal(weeks[0].files.length, 1)
})

test('buildCourseWeeklySchedule includes undated events without dependencies', () => {
  const courseId = '101'
  const weeks = buildCourseWeeklySchedule({
    courseId,
    modules: [],
    moduleItems: {},
    canvasFiles: [],
    loggedAssignments: [],
    lookup: { assignmentByCourseAndId: new Map() },
    matchLoggedAssignment,
    resolveWeeklyFile: () => null,
    findCanvasAssignment: () => null,
    compactWeeklyAssignment: assignment => ({
      assignmentid: assignment.assignmentid,
      name: assignment.name,
      description: '',
      duedate: assignment.duedate || '',
      unlockdate: '',
      url: '',
      filechildren: []
    }),
    graphEvents: [{
      courseid: courseId,
      eventid: 'lecture-1',
      name: 'Guest lecture',
      startdate: '',
      enddate: '',
      type: 'lecture',
      dependencies: []
    }]
  })

  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].weekLabel, 'Unscheduled')
  assert.equal(weeks[0].events.length, 1)
  assert.equal(weeks[0].events[0].event.name, 'Guest lecture')
  assert.equal(weeks[0].events[0].concepts.length, 0)
})
