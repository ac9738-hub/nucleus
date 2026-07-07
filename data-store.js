// In-memory application data store.
// Functionality: owns renderer-visible workspaces/tasks and merges Canvas project
// groups into snapshots sent over IPC.
// Dependencies: main.js supplies renderer emitters and Canvas data/project readers.
const { resolveStudySections, markStudySectionComplete } = require('./study-sections')
function createDataStore({ sendToRenderer, getCanvasProjectGroups, readCanvasData }) {
  const workspaces = [
    { id: "nucleus",          name: "Nucleus",          description: "Your main planning workspace." },
    { id: "biology",          name: "Biology",           description: "Labs, readings, and course projects." },
    { id: "computer-science", name: "Computer Science",  description: "Problem sets, code practice, and notes." },
    { id: "writing",          name: "Writing",           description: "Drafts, revisions, and source work." }
  ]

  const workspaceids = new Set(["computer-science", "biology", "writing", "nucleus"])
  const workspacenames = new Set(["Computer Science", "Biology", "Writing", "Nucleus"])

  const projectGroups = [
    {
      id: "classes",
      label: "Classes",
      items: [
        { id: "bio101",   name: "Introductory Biology",      meta: "BIO 101",  details: "Labs, readings, and weekly reports.",               color: "#1d9e75" },
        { id: "cs110",    name: "Intro to Computer Science",  meta: "CS 110",   details: "Problem sets, programming practice, and exams.",    color: "#378add" },
        { id: "math220",  name: "Linear Algebra",             meta: "MATH 220", details: "Matrix methods, quizzes, and review sessions.",     color: "#7f77dd" },
        { id: "eng105",   name: "Academic Writing",           meta: "ENG 105",  details: "Drafting, citation cleanup, and revision work.",    color: "#d85a30" }
      ]
    },
    {
      id: "personal",
      label: "Personal Projects",
      items: [
        { id: "portfolio",    name: "Portfolio refresh", meta: "Personal", details: "Update project writeups and polish the homepage.",              color: "#d4537e" },
        { id: "nucleus-app",  name: "Nucleus app",       meta: "Product",  details: "Shape the workspace, task, and project dashboard flow.",       color: "#c58d35" }
      ]
    }
  ]

  const tasks = []

  function getBootstrapSnapshot() {
    return {
      tasks,
      workspaces,
      projectGroups: [...projectGroups],
      canvasData: {}
    }
  }

  function getRendererDataSnapshot() {
    let canvasData = null
    try {
      canvasData = readCanvasData()
    } catch (error) {
      console.error('Unable to read Canvas data for renderer snapshot:', error)
    }
    let canvasProjectGroups = []
    try {
      canvasProjectGroups = getCanvasProjectGroups(canvasData)
    } catch (error) {
      console.error('Unable to build Canvas project groups for renderer snapshot:', error)
    }
    return {
      tasks,
      workspaces,
      projectGroups: [...projectGroups, ...canvasProjectGroups],
      canvasData: canvasData || {}
    }
  }

  function sendCanvasDataUpdate(options = {}) {
    try {
      sendToRenderer('tasks:update', tasks)
    } catch (error) {
      console.error('Unable to send tasks with Canvas update:', error)
    }
    try {
      const snapshot = getRendererDataSnapshot()
      if (options.canvasWiped) {
        snapshot.canvasWiped = true
        snapshot.canvasData = {}
        snapshot.projectGroups = [...projectGroups]
      }
      sendToRenderer('canvas:update', snapshot)
    } catch (error) {
      console.error('Unable to send full Canvas update; sending bootstrap snapshot:', error)
      const snapshot = getBootstrapSnapshot()
      if (options.canvasWiped) snapshot.canvasWiped = true
      sendToRenderer('canvas:update', snapshot)
    }
  }

  function newWorkspace(id, name, description = "") {
    if (workspaceids.has(id)) {
      console.error("Workspace with the same id already exists.")
      return 1
    }
    if (workspacenames.has(name)) {
      console.error("Workspace with the same name already exists.")
      return 2
    }
    workspaces.push({ id, name, description })
    workspaceids.add(id)
    workspacenames.add(name)
    sendToRenderer('workspaces:update', workspaces)
    return { ok: true, workspace: { id, name, description } }
  }

  function deleteWorkspace(id) {
    const index = workspaces.findIndex(workspace => workspace.id === id)
    if (index === -1) {
      return { ok: false, error: "Workspace not found." }
    }
    if (workspaces[index].id === "nucleus") {
      return { ok: false, error: "Cannot delete the final workspace." }
    }

    const [removedWorkspace] = workspaces.splice(index, 1)
    workspaceids.delete(removedWorkspace.id)
    workspacenames.delete(removedWorkspace.name)

    tasks.forEach(task => {
      if (task.workspaceId === id) {
        task.workspaceId = ""
      }
    })

    sendToRenderer('workspaces:update', workspaces)
    sendToRenderer('tasks:update', tasks)
    return { ok: true, workspaceId: id }
  }

  function getAllWorkspacesForTool() {
    return workspaces.map(workspace => ({
      id: workspace.id,
      name: workspace.name,
      description: workspace.description || ""
    }))
  }

  function getWorkspaceIdsByName(workspaceName) {
    const query = String(workspaceName || "").trim().toLowerCase()
    if (!query) {
      return []
    }

    return workspaces
      .filter(workspace => {
        const name = String(workspace.name || "").toLowerCase()
        const id = String(workspace.id || "").toLowerCase()
        return name.includes(query) || id.includes(query)
      })
      .map(workspace => ({
        id: workspace.id,
        name: workspace.name,
        description: workspace.description || ""
      }))
  }

  function dueTimestamp(task) {
    const due = task && task.due
    if (!due || due === "No due date") {
      return Number.POSITIVE_INFINITY
    }
    const timestamp = Date.parse(due)
    return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
  }

  function sortTasksSequentially() {
    tasks.sort((left, right) => {
      const dueDelta = dueTimestamp(left) - dueTimestamp(right)
      if (dueDelta !== 0) return dueDelta
      return String(left.title || '').localeCompare(String(right.title || ''))
    })
  }

  function applyTaskEntry(taskData) {
    const taskId = taskData && taskData.id ? String(taskData.id) : ""
    if (!taskId) return false
    const existing = tasks.find(task => task.id === taskId)
    const urls = Array.isArray(taskData.urls) ? taskData.urls.filter(Boolean) : []
    const normalized = { ...taskData, id: taskId, urls }
    if (existing) {
      const preservedWorkspaceId = existing.workspaceId || ""
      Object.assign(existing, normalized)
      if (!normalized.workspaceId && preservedWorkspaceId) {
        existing.workspaceId = preservedWorkspaceId
      }
    } else {
      tasks.push(normalized)
    }
    return true
  }

  function importCanvasTasks(taskEntries = []) {
    if (!Array.isArray(taskEntries) || !taskEntries.length) {
      return 0
    }
    let applied = 0
    taskEntries.forEach(entry => {
      if (applyTaskEntry(entry)) applied += 1
    })
    if (!applied) return 0
    sortTasksSequentially()
    sendToRenderer('tasks:update', tasks)
    return applied
  }

  function newTask(title, priority_weight, id = "no task id", workspaceId = "", course = "no course", details = "unspecified task", due = "monday", estimate = "", color = "no color", urls = [], metadata = {}) {
    const taskId = id && id !== "no task id"
      ? String(id)
      : title.toLowerCase().replace(/\s+/g, '-') + '-' + Math.floor(Math.random() * 1000)
    applyTaskEntry({
      id: taskId,
      workspaceId,
      course,
      title,
      details,
      due,
      estimate,
      color,
      priority_weight,
      urls,
      ...metadata
    })
    sortTasksSequentially()
    sendToRenderer('tasks:update', tasks)
    return "created new task with " + taskId + "," + workspaceId + "," + course + "," + title + "," + details + "," + due + "," + estimate + "," + color + "," + priority_weight + "\n"
  }

  function deleteTask(id) {
    const index = tasks.findIndex(task => task["id"] == id)
    if (index == -1) {
      return "ERROR reomoving task: Task not found"
    }
    tasks.splice(index, 1)
    return "task successfully removed"
  }

  function removeCanvasTasks() {
    const before = tasks.length
    for (let index = tasks.length - 1; index >= 0; index -= 1) {
      if (tasks[index].source === 'canvas') {
        tasks.splice(index, 1)
      }
    }
    const removed = before - tasks.length
    if (removed) {
      sortTasksSequentially()
      sendToRenderer('tasks:update', tasks)
    }
    return removed
  }

  function getProjectColor(projectid) {
    for (const group of projectGroups) {
      if (group.items.some(item => item.id === projectid)) {
        return group.color
      }
    }
    return '#000000'
  }

  function updateStudySectionProgress(taskId, sectionId, status = 'done') {
    const task = tasks.find(entry => entry.id == taskId)
    if (!task) {
      return { ok: false, error: 'Task not found.' }
    }

    task.studySections = resolveStudySections(task)
    const result = markStudySectionComplete(task, sectionId)
    if (!result.ok) {
      return result
    }

    task.studySections = result.sections
    task.studyProgress = result.studyProgress
    if (result.isComplete) {
      task.status = 'done'
    } else if (normalizeStudyTaskStatus(task.status) === 'done') {
      task.status = 'not_started'
    }

    sendToRenderer('tasks:update', tasks)
    return {
      ok: true,
      taskId: task.id,
      sectionId: String(sectionId),
      status: normalizeStudyTaskStatus(status),
      studyProgress: task.studyProgress,
      isComplete: result.isComplete
    }
  }

  function normalizeStudyTaskStatus(status) {
    const value = String(status || 'pending').toLowerCase()
    return value === 'done' || value === 'complete' || value === 'completed'
      ? 'done'
      : 'pending'
  }

  function notifyRendererReady() {
    sendToRenderer('workspaces:update', workspaces)
    sendCanvasDataUpdate()
    return { ok: true, taskCount: tasks.length, workspaceCount: workspaces.length }
  }

  return {
    deleteTask,
    deleteWorkspace,
    getAllWorkspacesForTool,
    getProjectColor,
    getRendererDataSnapshot,
    getBootstrapSnapshot,
    getTasksSnapshot: () => tasks.map(task => ({ ...task })),
    getWorkspaceIdsByName,
    hasWorkspaceId: id => workspaceids.has(id),
    importCanvasTasks,
    newTask,
    newWorkspace,
    notifyRendererReady,
    removeCanvasTasks,
    sendCanvasDataUpdate,
    updateStudySectionProgress
  }
}

module.exports = {
  createDataStore
}
