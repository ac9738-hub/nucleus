'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { JSDOM } = require('jsdom')
const { escapeHtml } = require('../../lib/dom-utils')
const { defaultWorkspaces } = require('./fixtures')

const ROOT = path.resolve(__dirname, '../..')

function defaultState(overrides = {}) {
  return {
    activeSection: 'home',
    activeWorkspaceId: 'nucleus',
    activeTabId: 'center:nucleus',
    activeCourseId: null,
    activeTabByWorkspace: { nucleus: 'center:nucleus' },
    workspaceSidebarCollapsed: false,
    aiPanelWidth: 340,
    aiPanelMinimized: false,
    tabs: [{ id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' }],
    top: 'section',
    ...overrides
  }
}

function createHarness(options = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <nav id="primary-tabs" role="tablist" aria-label="Primary navigation">
      <button type="button" class="active" data-section="home" role="tab" aria-selected="true">Home</button>
      <button type="button" data-section="tasks" role="tab" aria-selected="false">Tasks</button>
      <button type="button" data-section="calendar" role="tab" aria-selected="false">Calendar</button>
    </nav>
    <nav id="workspace-tabs"></nav>
    <div id="workspace-page-tabs"></div>
    <div id="browser-toolbar"></div>
    <div id="canvas-toolbar"></div>
    <main id="view"></main>
  </body></html>`, { url: 'http://nucleus.local/', runScripts: 'dangerously' })

  const { window } = dom
  const context = dom.getInternalVMContext()

  context.escapeHtml = escapeHtml

  context.state = options.state || defaultState()
  context.tasks = options.tasks || []
  context.workspaces = options.workspaces || defaultWorkspaces()
  context.projectGroups = options.projectGroups || []
  context.canvasData = options.canvasData || { courses: [] }
  context.synapseState = options.synapseState || { conversations: [] }

  context.render = () => {}
  context.syncTabs = async () => ({ ok: true })
  context.syncActiveTab = async () => ({ ok: true })
  context.queueTabSyncAfterRender = () => {}
  context.renderBrowserToolbar = () => {}
  context.renderCanvasToolbar = () => {}
  context.syncRenderContext = () => {}
  context.getWorkspaceTasks = workspaceId => context.tasks.filter(task => task.workspaceId === workspaceId)
  context.getWorkspace = workspaceId => context.workspaces.find(workspace => workspace.id === workspaceId) || null
  context.getGreeting = () => 'Hello'
  context.deleteWorkspace = () => {}
  context.setActiveWorkspace = async () => {}
  context.mountSynapseControllerIfNeeded = () => {}
  context.destroySynapseController = () => {}
  context.openCourseLinkInCanvasTab = async () => {}
  context.getActiveTab = () => context.state.tabs.find(tab => tab.id === context.state.activeTabId) || null
  context.scheduleRenderWorkspacePageTabs = () => {}
  context.updateWorkspacePageTabs = () => {}
  context.syncMailWatchLifecycle = async () => {}
  context.ensureWorkspaceCenter = workspaceId => `center:${workspaceId}`
  context.ensureWorkspaceCenters = () => {}
  context.rememberActiveWorkspaceTab = () => {}
  context.rememberActiveCanvasYIndex = () => {}
  context.restoreActiveCanvasYIndex = () => {}
  context.getBrowserWorkspaceId = () => context.state.activeWorkspaceId || 'nucleus'
  context.hasActiveWorkspace = () => context.state.top === 'workspace'
  context.safeRender = () => context.render()
  context.writeActiveBrowserTabHtml = async () => ({ ok: true })
  context.writeActiveBrowserTabFramesHtml = async () => ({ ok: true })

  const nucleus = options.nucleus || {
    on: () => () => {},
    startMailWatch: async () => ({ ok: true }),
    stopMailWatch: async () => ({ ok: true })
  }
  context.window.nucleus = nucleus
  context.window.requestAnimationFrame = callback => setTimeout(callback, 0)

  function runScript(relativePath) {
    const filePath = path.join(ROOT, relativePath)
    const code = fs.readFileSync(filePath, 'utf8')
    vm.runInContext(code, context, { filename: filePath })
    return context
  }

  function loadDomUtils() {
    return runScript('lib/dom-utils.js')
  }

  function loadMailStack() {
    loadDomUtils()
    runScript('lib/mail-folders.js')
    runScript('app/mail/mail.js')
    return context
  }

  function loadCanvasStack() {
    loadDomUtils()
    runScript('app/canvas/course.js')
    runScript('app/canvas/dashboard.js')
    return context
  }

  function loadSynapseStack() {
    loadDomUtils()
    runScript('app/synapse/chat.js')
    runScript('app/synapse/course-teacher.js')
    runScript('app/synapse/synapse.js')
    return context
  }

  function loadWorkspaceTabs() {
    runScript('renderer/workspace-page-tabs.js')
    return context
  }

  function loadAppJs() {
    runScript('renderer/app.js')
    return context
  }

  function loadMailTabs() {
    runScript('app/mail/mail-tabs.js')
    return context
  }

  function loadArtifactTabs() {
    runScript('renderer/artifact-tabs.js')
    return context
  }

  function loadRendererCore() {
    loadDomUtils()
    runScript('lib/view-transition.js')
    runScript('lib/workspace-session.js')
    loadWorkspaceTabs()
    runScript('renderer/context-controller.js')
    runScript('renderer/workspace-control-center.js')
    loadAppJs()
    loadArtifactTabs()
    return context
  }

  function loadMailSuite() {
    loadMailStack()
    loadWorkspaceTabs()
    loadAppJs()
    loadMailTabs()
    return context
  }

  return {
    dom,
    window,
    document: window.document,
    context,
    runScript,
    loadDomUtils,
    loadMailStack,
    loadCanvasStack,
    loadSynapseStack,
    loadWorkspaceTabs,
    loadAppJs,
    loadMailTabs,
    loadArtifactTabs,
    loadRendererCore,
    loadMailSuite
  }
}

module.exports = {
  createHarness,
  defaultState,
  defaultWorkspaces,
  ROOT
}
