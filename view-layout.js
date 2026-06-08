const BROWSER_VIEW_X = 220
const BROWSER_VIEW_Y = 124
const CANVAS_VIEW_Y = 124
const RIGHT_PANEL_WIDTH = 340

function getBrowserBounds(window, tab = null) {
  const [contentWidth, contentHeight] = window.getContentSize()
  const y = tab && (tab.type === "canvastab" || tab === "canvastab") ? CANVAS_VIEW_Y : BROWSER_VIEW_Y
  return {
    x: BROWSER_VIEW_X,
    y,
    width: Math.max(0, contentWidth - RIGHT_PANEL_WIDTH - BROWSER_VIEW_X),
    height: Math.max(0, contentHeight - y)
  }
}

function getAuthBounds(window) {
  const [contentWidth, contentHeight] = window.getContentSize()
  return {
    x: BROWSER_VIEW_X,
    y: 120,
    width: Math.max(0, contentWidth - RIGHT_PANEL_WIDTH - BROWSER_VIEW_X),
    height: Math.max(0, contentHeight)
  }
}

module.exports = {
  BROWSER_VIEW_X,
  BROWSER_VIEW_Y,
  CANVAS_VIEW_Y,
  RIGHT_PANEL_WIDTH,
  getAuthBounds,
  getBrowserBounds
}
