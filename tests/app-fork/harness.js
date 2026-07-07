'use strict'

const { createHarness, defaultState } = require('../renderer/harness')
const { createProcessTrace } = require('../../lib/app-fork/process-trace')
const { captureAppScreen } = require('../../lib/app-fork/screen-state')
const { createMockMainProcess } = require('../../lib/app-fork/mock-main-process')
const { estimateGpuPressure } = require('../../lib/app-fork/gpu-estimator')
const { resolveBudgetProfile } = require('../../lib/app-fork/budgets')

function buildWorkspaceTabState(overrides = {}) {
  return defaultState({
    top: 'workspace',
    activeWorkspaceId: 'nucleus',
    activeTabId: 'center:nucleus',
    activeTabByWorkspace: { nucleus: 'center:nucleus' },
    tabs: [
      { id: 'center:nucleus', type: 'center', workspaceId: 'nucleus', label: 'Control Center' },
      { id: 'mail:nucleus', type: 'mailtab', workspaceId: 'nucleus', label: 'Mail' },
      {
        id: 'canvas:nucleus',
        type: 'canvastab',
        canvasMode: 'native',
        workspaceId: 'nucleus',
        courseId: '101',
        courseSection: 'weekly',
        label: 'Canvas'
      },
      {
        id: 'browser:1',
        type: 'browsertab',
        workspaceId: 'nucleus',
        label: 'Engine',
        url: 'nucleus://search'
      }
    ],
    ...overrides
  })
}

function stubFastRendererPipeline(ctx) {
  ctx.renderWorkspaceSidebarCollapseState = () => {}
  ctx.renderPrimaryTabs = () => {}
  ctx.renderWorkspaceTabs = () => {}
  ctx.updateWorkspacePageTabs = () => {}
  ctx.renderBrowserToolbar = () => {}
  ctx.renderCanvasToolbar = () => {}
  ctx.syncRenderContext = () => {}
  ctx.demoteSiblingWebTabViewTiers = () => {}
  ctx.render = () => {}
  ctx.paintActiveView = () => {}
  ctx.startagent = () => {}
  ctx.safeRender = () => {}
}

async function settleRendererBoot() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

function injectRenderBootstrapDom(document) {
  if (document.getElementById('workspace-sidebar-toggle')) return
  document.body.insertAdjacentHTML('beforeend', `
    <button id="workspace-sidebar-toggle" type="button"></button>
    <button id="new-workspace-button" type="button"></button>
    <button id="cancel-new-workspace" type="button"></button>
    <form id="new-workspace-form"></form>
    <div class="content"></div>
  `)
}

function createAppFork(options = {}) {
  const trace = options.trace || createProcessTrace(options.traceOptions)
  const budget = resolveBudgetProfile(
    options.profile || process.env.NUCLEUS_APP_FORK_PROFILE || 'jsdom'
  )
  const rendererState = options.state || buildWorkspaceTabState(options.stateOverrides)

  const ipcCalls = []
  let mockMain = null

  const nucleus = {
    on: () => () => {},
    startMailWatch: async () => ({ ok: true }),
    stopMailWatch: async () => ({ ok: true }),
    notifyRendererReady: async () => ({ ok: true }),
    requestCanvasUpdate: async () => ({ ok: true }),
    getData: async () => ({
      tasks: [],
      workspaces: rendererState.workspaces || [],
      projectGroups: [],
      canvasData: options.harnessOptions?.canvasData || { courses: [] }
    }),
    syncTabs: async payload => {
      ipcCalls.push({ channel: 'tabs:sync', payload })
      return { ok: true }
    },
    syncActiveTab: async payload => {
      ipcCalls.push({ channel: 'tabs:active', payload })
      return { ok: true }
    },
    canvasPreloadPlan: async payload => {
      ipcCalls.push({ channel: 'canvas:preload_plan', payload })
      if (mockMain) mockMain.recordIpc('canvas:preload_plan', payload)
      return { ok: true, loaded: 0 }
    },
    pushUiState: async payload => {
      ipcCalls.push({ channel: 'app:push_ui_state', payload })
      return { ok: true }
    }
  }

  const renderer = createHarness({
    state: rendererState,
    nucleus: options.nucleus || nucleus,
    ...options.harnessOptions
  })

  mockMain = createMockMainProcess({
    trace,
    tabs: rendererState.tabs.map(tab => ({ ...tab })),
    activeTabId: rendererState.activeTabId,
    preloadPool: options.preloadPool
  })

  function screen(comment, process = 'fork') {
    const snap = captureAppScreen(renderer, mockMain)
    trace.step(process, comment, snap)
    return snap
  }

  function loadRendererCore() {
    trace.step('renderer:boot', 'loadRendererCore start', screen('before loadRendererCore'))
    renderer.loadRendererCore()
    trace.step('renderer:boot', 'loadRendererCore done', screen('after loadRendererCore'))
    return renderer.context
  }

  function loadFullStack() {
    const ctx = loadRendererCore()
    injectRenderBootstrapDom(renderer.document)
    renderer.runScript('renderer/render.js')
    if (typeof renderer.context.state !== 'undefined') {
      Object.assign(renderer.context.state, rendererState)
    }
    stubFastRendererPipeline(renderer.context)
    trace.step('renderer:boot', 'render.js loaded', screen('after render.js'))
    return renderer.context
  }

  function callRenderer(fnName, ...args) {
    const fn = renderer.context[fnName]
    if (typeof fn !== 'function') {
      throw new Error(`renderer.${fnName} is not available; call loadFullStack() first`)
    }
    return fn(...args)
  }

  function gpuPressure() {
    return estimateGpuPressure(mockMain.snapshot(), { budget: budget.gpu })
  }

  return {
    trace,
    budget,
    renderer,
    mockMain,
    ipcCalls,
    screen,
    loadRendererCore,
    loadFullStack,
    callRenderer,
    settleRendererBoot,
    stubFastRendererPipeline,
    gpuPressure,
    context: renderer.context,
    document: renderer.document,
    window: renderer.window
  }
}

module.exports = {
  createAppFork,
  buildWorkspaceTabState,
  stubFastRendererPipeline,
  settleRendererBoot
}
