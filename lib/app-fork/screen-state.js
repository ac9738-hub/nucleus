// Unified screen-state snapshot for renderer + mock main process.

const { summarizeTab } = require('../diagnostics')

function summarizeViewElement(viewEl) {
  if (!viewEl) {
    return {
      present: false,
      childCount: 0,
      textLength: 0,
      hasTransitionLayer: false,
      htmlPreview: ''
    }
  }
  const html = String(viewEl.innerHTML || '')
  return {
    present: true,
    childCount: viewEl.childElementCount || 0,
    textLength: String(viewEl.textContent || '').trim().length,
    hasTransitionLayer: Boolean(viewEl.querySelector('.view-transition-layer')),
    htmlPreview: html.slice(0, 180)
  }
}

function captureRendererScreen(rendererCtx, windowRef) {
  const viewEl = rendererCtx.document
    ? rendererCtx.document.getElementById('view')
    : null
  const snapshotApi = windowRef && windowRef.__nucleusTabSnapshot
  const overlay = snapshotApi && typeof snapshotApi.get === 'function'
    ? snapshotApi.get()
    : null

  return {
    top: rendererCtx.state.top,
    activeSection: rendererCtx.state.activeSection || '',
    activeWorkspaceId: rendererCtx.state.activeWorkspaceId || '',
    activeTabId: rendererCtx.state.activeTabId || '',
    tabCount: Array.isArray(rendererCtx.state.tabs) ? rendererCtx.state.tabs.length : 0,
    tabs: (rendererCtx.state.tabs || []).map(tab => summarizeTab(tab)),
    view: summarizeViewElement(viewEl),
    tabSnapshotOverlay: overlay
      ? {
        visible: Boolean(overlay.visible),
        tabId: overlay.tabId || '',
        hasDataUrl: Boolean(overlay.snapshotDataUrl)
      }
      : null
  }
}

function captureAppScreen(rendererHarness, mockMain) {
  return {
    ts: new Date().toISOString(),
    renderer: captureRendererScreen(
      { state: rendererHarness.context.state, document: rendererHarness.document },
      rendererHarness.window
    ),
    main: mockMain ? mockMain.snapshot() : null
  }
}

function assertScreenCoherent(screen, expectations = {}) {
  const issues = []
  if (expectations.activeTabId && screen.renderer.activeTabId !== expectations.activeTabId) {
    issues.push(`activeTabId expected ${expectations.activeTabId} got ${screen.renderer.activeTabId}`)
  }
  if (expectations.mainActiveTabId && screen.main && screen.main.activeTabId !== expectations.mainActiveTabId) {
    issues.push(`main activeTabId expected ${expectations.mainActiveTabId} got ${screen.main.activeTabId}`)
  }
  if (expectations.viewPresent && !screen.renderer.view.present) {
    issues.push('renderer #view missing')
  }
  if (expectations.minViewTextLength != null && screen.renderer.view.textLength < expectations.minViewTextLength) {
    issues.push(`view text too short (${screen.renderer.view.textLength})`)
  }
  if (expectations.noTransitionLayer && screen.renderer.view.hasTransitionLayer) {
    issues.push('unexpected view-transition-layer on screen')
  }
  return { ok: issues.length === 0, issues }
}

module.exports = {
  captureRendererScreen,
  captureAppScreen,
  assertScreenCoherent,
  summarizeViewElement
}
