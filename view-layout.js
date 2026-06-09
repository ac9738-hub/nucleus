// Electron WebContentsView layout constants.
// Functionality: converts BrowserWindow content bounds into the native view
// rectangles used for browser, Canvas, slate, and auth surfaces.
// Dependencies: main.js and app/canvas/auth.js must match the CSS shell sizes.
const BROWSER_VIEW_X = 220
const BROWSER_VIEW_X_COLLAPSED = 52
const BROWSER_VIEW_Y = 124
const CANVAS_VIEW_Y = 124
const RIGHT_PANEL_WIDTH = 340
const RIGHT_PANEL_MIN_WIDTH = 340
let browserViewX = BROWSER_VIEW_X
let rightPanelWidth = RIGHT_PANEL_WIDTH

function setWorkspaceSidebarCollapsed(collapsed) {
  browserViewX = collapsed ? BROWSER_VIEW_X_COLLAPSED : BROWSER_VIEW_X
}

function setRightPanelWidth(width) {
  const numericWidth = Number(width)
  rightPanelWidth = Number.isFinite(numericWidth)
    ? Math.max(0, Math.round(numericWidth))
    : RIGHT_PANEL_WIDTH
}

function getBrowserBounds(window, tab = null) {
  const [contentWidth, contentHeight] = window.getContentSize()
  const y = tab && (tab.type === "canvastab" || tab === "canvastab") ? CANVAS_VIEW_Y : BROWSER_VIEW_Y
  return {
    x: browserViewX,
    y,
    width: Math.max(0, contentWidth - rightPanelWidth - browserViewX),
    height: Math.max(0, contentHeight - y)
  }
}

function getAuthBounds(window) {
  const [contentWidth, contentHeight] = window.getContentSize()
  return {
    x: browserViewX,
    y: 120,
    width: Math.max(0, contentWidth - rightPanelWidth - browserViewX),
    height: Math.max(0, contentHeight)
  }
}

module.exports = {
  BROWSER_VIEW_X,
  BROWSER_VIEW_X_COLLAPSED,
  BROWSER_VIEW_Y,
  CANVAS_VIEW_Y,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_WIDTH,
  getAuthBounds,
  getBrowserBounds,
  setRightPanelWidth,
  setWorkspaceSidebarCollapsed
}
