// User-visible sidekick activity labels (main process → renderer).

function truncateText(text, max = 42) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

const TOOL_STATUS = {
  continue_sidekick(input = {}) {
    const mode = String(input.mode || '').trim()
    if (mode === 'wait_for_context') return 'Retrieving course context…'
    if (mode === 'tool_use') return 'Opening app tools…'
    return 'Continuing…'
  },
  retrieve_user_context(input = {}) {
    const query = truncateText(input.query || input.search || '')
    return query ? `Searching Canvas for “${query}”…` : 'Searching Canvas…'
  },
  list_canvas_courses: 'Loading your Canvas courses…',
  list_canvas_assignments: 'Loading assignments…',
  list_canvas_files: 'Loading course files…',
  list_canvas_modules: 'Loading modules…',
  refresh_canvas_data: 'Refreshing Canvas data…',
  open_canvas_tab: 'Opening Canvas tab…',
  open_browser_window: 'Opening browser tab…',
  navigate_tab: 'Navigating tab…',
  focus_tab: 'Focusing tab…',
  close_tab: 'Closing tab…',
  add_task: 'Adding task…',
  delete_task: 'Removing task…',
  mark_task_complete: 'Updating task…',
  create_artifact: 'Creating artifact…',
  update_artifact: 'Updating artifact…',
  get_all_workspaces: 'Loading workspaces…',
  get_workspace_ids_by_name: 'Finding workspace…'
}

function statusForToolCall({ name, input } = {}) {
  const tool = String(name || '').trim()
  const args = input && typeof input === 'object' ? input : {}
  const entry = TOOL_STATUS[tool]
  if (typeof entry === 'function') return entry(args)
  if (typeof entry === 'string') return entry
  if (tool) {
    const readable = tool.replace(/_/g, ' ')
    return `${readable.charAt(0).toUpperCase()}${readable.slice(1)}…`
  }
  return 'Working…'
}

const PHASE_STATUS = {
  thinking: 'Thinking…',
  live_context: 'Reading live context…',
  searching_canvas: 'Searching Canvas…',
  course_methods: 'Reading course methods and formulas…',
  grounding: 'Grounding answer in course sources…',
  composing: 'Composing answer…',
  running_tools: 'Running app tools…',
  tool_batch: 'Using tools…',
  memory_pressure: 'Memory is high — sidekick paused briefly. Try again soon.'
}

function statusForPhase(phase) {
  return PHASE_STATUS[String(phase || '').trim()] || PHASE_STATUS.thinking
}

module.exports = {
  statusForToolCall,
  statusForPhase,
  truncateText
}
