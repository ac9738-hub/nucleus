'use strict'

const defaultWorkspaces = () => ([
  { id: 'nucleus', name: 'Nucleus', description: 'Main workspace' },
  { id: 'biology', name: 'Biology', description: 'Labs and readings' }
])

const sampleTasks = () => ([
  {
    id: 'task-1',
    title: 'Problem Set 1',
    course: 'Canvas 101',
    courseId: '101',
    source: 'canvas',
    type: 'canvas-assignment',
    due: '2026-06-21T23:59:00Z',
    estimate: '2h',
    details: 'Complete exercises 1-5.',
    workspaceId: 'nucleus',
    urls: ['https://canvas.example.edu/courses/101/assignments/1']
  },
  {
    id: 'task-2',
    title: 'Read chapter 3',
    course: 'Biology',
    due: '2026-06-22T12:00:00Z',
    estimate: '45m',
    details: 'Focus on cell division.',
    workspaceId: 'biology',
    urls: []
  }
])

const sampleCanvasData = () => ({
  courses: [
    {
      id: '101',
      name: 'Intro to Architecture',
      course_code: 'ART 102',
      workflow_state: 'available',
      term: { name: 'Fall 2025' },
      image_url: 'https://canvas.example.edu/files/1/preview'
    },
    {
      id: '102',
      name: 'Deleted Course',
      workflow_state: 'deleted'
    }
  ],
  assignments: {
    101: [
      {
        id: 'a1',
        name: 'Assignment 1',
        due_at: '2026-06-21T23:59:00Z',
        html_url: 'https://canvas.example.edu/courses/101/assignments/a1'
      }
    ]
  },
  modules: { 101: [] },
  module_items: { 101: {} },
  file: { 101: [] },
  front_pages: {
    101: { body: '<p>Welcome to <strong>ART 102</strong></p>' }
  },
  weekly_schedule: { 101: [] }
})

const sampleMailState = () => ({
  loading: false,
  detailLoading: false,
  sending: false,
  error: null,
  initialized: true,
  folder: 'inbox',
  searchQuery: '',
  view: {
    labelStats: {
      INBOX: { messagesUnread: 2 }
    },
    folders: null
  },
  messages: [
    {
      id: 'm1',
      subject: 'Office hours',
      snippet: 'See you Tuesday',
      from: 'Prof Example <prof@uni.edu>',
      date: 'Mon, 16 Jun 2026 10:00:00 -0400',
      dateLabel: 'Jun 16',
      unread: true,
      starred: false,
      inboxCategory: 'academic'
    },
    {
      id: 'm2',
      subject: 'Newsletter',
      snippet: 'Weekly deals',
      from: 'Shop <shop@example.com>',
      date: 'Sun, 15 Jun 2026 09:00:00 -0400',
      dateLabel: 'Jun 15',
      unread: false,
      starred: false,
      inboxCategory: 'non_academic'
    }
  ],
  allMessages: [],
  selectedId: null,
  selectedMessage: null,
  selectedIds: [],
  threadMessages: [],
  nextPageToken: '',
  loadingMore: false,
  sidebarCollapsed: false,
  contactsPanelOpen: false,
  compose: null,
  statusMessage: '',
  contactsData: { contacts: {}, chats: {}, routedMessageIds: [] },
  contactsUi: {
    activeContactEmail: null,
    threadOpen: false,
    addContactOpen: false,
    chatDetailOpen: false,
    chatDetailLoading: false,
    chatDetailMessage: null
  }
})

const sampleSynapseTab = () => ({
  id: 'synapse:nucleus',
  type: 'synapsetab',
  workspaceId: 'nucleus',
  label: 'Synapse',
  synapseMode: 'chat',
  conversationId: 'conv-1'
})

module.exports = {
  defaultWorkspaces,
  sampleTasks,
  sampleCanvasData,
  sampleMailState,
  sampleSynapseTab
}
