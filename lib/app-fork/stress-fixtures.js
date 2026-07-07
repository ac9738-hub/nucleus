// Synthetic multi-workspace / multi-tab fixtures for app-fork stress runs.

function buildStressWorkspaces(count = 4) {
  const workspaces = [
    { id: 'nucleus', name: 'Nucleus', description: 'Main planning workspace.' },
    { id: 'biology', name: 'Biology', description: 'Labs and readings.' },
    { id: 'computer-science', name: 'Computer Science', description: 'Problem sets and notes.' }
  ]
  for (let i = workspaces.length; i < count; i += 1) {
    workspaces.push({
      id: `stress-ws-${i + 1}`,
      name: `Stress Workspace ${i + 1}`,
      description: 'Generated for stress testing.'
    })
  }
  return workspaces
}

function buildStressTabs(workspaces, options = {}) {
  const {
    includeCanvas = true,
    browserPerWorkspace = 2
  } = options

  const tabs = []
  const activeTabByWorkspace = {}

  for (let index = 0; index < workspaces.length; index += 1) {
    const ws = workspaces[index]
    const courseId = String(100 + index)

    tabs.push({
      id: `center:${ws.id}`,
      type: 'center',
      workspaceId: ws.id,
      label: 'Control Center'
    })
    tabs.push({
      id: `mail:${ws.id}`,
      type: 'mailtab',
      workspaceId: ws.id,
      label: 'Mail'
    })

    if (includeCanvas) {
      tabs.push({
        id: `canvas:${ws.id}`,
        type: 'canvastab',
        canvasMode: 'native',
        canvasNativePage: 'course',
        workspaceId: ws.id,
        courseId,
        courseSection: 'weekly',
        label: 'Canvas'
      })
    }

    for (let browserIndex = 0; browserIndex < browserPerWorkspace; browserIndex += 1) {
      tabs.push({
        id: `browser:${ws.id}:${browserIndex}`,
        type: 'browsertab',
        workspaceId: ws.id,
        label: `Browser ${browserIndex + 1}`,
        url: `nucleus://search?ws=${encodeURIComponent(ws.id)}&n=${browserIndex}`
      })
    }

    activeTabByWorkspace[ws.id] = `center:${ws.id}`
  }

  return { tabs, activeTabByWorkspace }
}

function buildStressRendererState(options = {}) {
  const workspaceCount = Math.max(2, Number(options.workspaceCount) || 4)
  const browserPerWorkspace = Math.max(1, Number(options.browserPerWorkspace) || 2)
  const workspaces = buildStressWorkspaces(workspaceCount)
  const { tabs, activeTabByWorkspace } = buildStressTabs(workspaces, {
    includeCanvas: options.includeCanvas !== false,
    browserPerWorkspace
  })

  return {
    top: 'workspace',
    activeSection: 'home',
    activeWorkspaceId: workspaces[0].id,
    activeTabId: activeTabByWorkspace[workspaces[0].id],
    activeTabByWorkspace,
    workspaces,
    tabs
  }
}

function buildStressCanvasUrls(courseId, count = 20) {
  const id = String(courseId || '101')
  return Array.from({ length: Math.max(1, count) }, (_item, index) => (
    `https://canvas.example/courses/${id}/assignments/stress-${index + 1}`
  ))
}

function cycleTabIds(tabs, workspaceId = null) {
  const list = workspaceId
    ? tabs.filter(tab => tab.workspaceId === workspaceId)
    : tabs
  return list.map(tab => tab.id)
}

module.exports = {
  buildStressWorkspaces,
  buildStressTabs,
  buildStressRendererState,
  buildStressCanvasUrls,
  cycleTabIds
}
