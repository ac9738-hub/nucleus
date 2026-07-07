// Context controller — AI context controls, class scope, lock mode, tasks-in-progress.
// Dependencies: NucleusWorkspaceSession, canvasData, tasks, patchWorkspaceSession.

function ctxEscape(value) {
  return typeof escapeHtml === 'function' ? escapeHtml(value) : String(value || '')
}

function ctxGetCourses() {
  const courses = canvasData && Array.isArray(canvasData.courses) ? canvasData.courses : []
  return courses
    .map(course => ({
      id: String(course.id || '').trim(),
      label: String(course.course_code || course.name || `Course ${course.id}`).trim()
    }))
    .filter(course => course.id)
}

function ctxEffectiveCourseIds(session, courseIds) {
  const selected = session && session.courseScope && Array.isArray(session.courseScope.primaryCourseIds)
    ? session.courseScope.primaryCourseIds.map(String).filter(Boolean)
    : []
  if (!selected.length) return new Set(courseIds)
  return new Set(selected.filter(id => courseIds.includes(id)))
}

function ctxGroundingHint(mode) {
  switch (mode) {
    case 'strict_course':
      return 'Only selected course resources. Best for homework and exams.'
    case 'course_first':
      return 'Search course materials first; outside sources only when needed.'
    case 'open_context':
      return 'Broader search across courses and open tabs, still preferring local files.'
    case 'workspace_first':
    default:
      return 'Prioritize open tabs, active tasks, and workspace materials.'
  }
}

function ctxLockHint(lock) {
  switch (lock) {
    case 'strict':
      return 'Stay inside selected context unless you explicitly ask otherwise.'
    case 'soft':
      return 'May pull useful material from outside the scoped courses.'
    case 'balanced':
    default:
      return 'Prefer workspace materials while allowing closely related sources.'
  }
}

function ctxTaskStatusBadge(task) {
  if (typeof getDaysTillDue !== 'function') return { label: 'Active', tone: 'track' }
  const days = getDaysTillDue(task.due)
  if (days == null) return { label: 'Active', tone: 'track' }
  if (days < 0) return { label: 'Overdue', tone: 'overdue' }
  if (days <= 3) return { label: 'Due soon', tone: 'soon' }
  return { label: 'On track', tone: 'track' }
}

function ctxWorkspaceTasks(workspaceId) {
  return (Array.isArray(tasks) ? tasks : []).filter(
    task => String(task.workspaceId || '') === String(workspaceId || '')
  )
}

function ctxTasksInProgress(session, workspaceId) {
  const workspaceTasks = ctxWorkspaceTasks(workspaceId)
  const activeIds = session && Array.isArray(session.activeTaskIds)
    ? session.activeTaskIds.map(String)
    : []

  const active = workspaceTasks.filter(task => activeIds.includes(String(task.id)))
  if (active.length) return active.slice(0, 6)

  return workspaceTasks
    .filter(task => !String(task.status || '').match(/done|complete|finished/i))
    .slice(0, 6)
}

function renderContextControlBar(session, workspaceId) {
  const lib = window.NucleusWorkspaceSession
  const courses = ctxGetCourses()
  const courseIds = courses.map(course => course.id)
  const selected = ctxEffectiveCourseIds(session, courseIds)
  const lock = session && session.contextLock ? session.contextLock : 'balanced'
  const mode = session && session.groundingMode ? session.groundingMode : 'workspace_first'
  const allowOther = !(session && session.courseScope && session.courseScope.allowOtherCourses === false)
  const strictMode = mode === 'strict_course'

  const groundingModes = lib && lib.GROUNDING_MODE_LABELS
    ? Object.entries(lib.GROUNDING_MODE_LABELS)
    : [
      ['strict_course', 'Strict Course'],
      ['course_first', 'Course First'],
      ['workspace_first', 'Workspace First'],
      ['open_context', 'Open Context']
    ]

  const groundingButtons = groundingModes.map(([value, label]) => `
    <button type="button"
      class="nui-segmented-btn ctx-segment ${mode === value ? 'is-active' : ''}"
      data-ctx-grounding="${ctxEscape(value)}"
      title="${ctxEscape(ctxGroundingHint(value))}">
      ${ctxEscape(label)}
    </button>
  `).join('')

  const courseItems = courses.length
    ? courses.map(course => {
      const checked = selected.has(course.id) ? 'checked' : ''
      return `
        <label class="ctx-course-option">
          <input type="checkbox" data-ctx-course-id="${ctxEscape(course.id)}" ${checked}>
          <span>${ctxEscape(course.label)}</span>
        </label>
      `
    }).join('')
    : '<p class="ctx-course-empty">No Canvas courses synced yet.</p>'

  return `
    <section class="ctx-control-bar" aria-label="AI context control" data-ctx-workspace="${ctxEscape(workspaceId)}">
      <div class="ctx-control-group ctx-control-grounding">
        <span class="ctx-control-label">Grounding mode</span>
        <div class="nui-segmented ctx-segmented ctx-segmented-wrap" role="group" aria-label="Grounding mode">
          ${groundingButtons}
        </div>
        <p class="ctx-control-hint">${ctxEscape(ctxGroundingHint(mode))}</p>
      </div>

      <div class="ctx-control-group ctx-control-courses">
        <span class="ctx-control-label">Search these classes first</span>
        <div class="ctx-course-filter">${courseItems}</div>
        <label class="ctx-toggle-row ${strictMode ? 'is-disabled' : ''}">
          <input type="checkbox"
            data-ctx-allow-other-courses
            ${allowOther ? 'checked' : ''}
            ${strictMode ? 'disabled' : ''}>
          <span>Allow searching other courses</span>
        </label>
      </div>

      <div class="ctx-control-group ctx-control-lock">
        <span class="ctx-control-label">Context lock</span>
        <div class="nui-segmented ctx-segmented" role="group" aria-label="Context lock">
          <button type="button" class="nui-segmented-btn ctx-segment ${lock === 'soft' ? 'is-active' : ''}" data-ctx-lock="soft">Soft</button>
          <button type="button" class="nui-segmented-btn ctx-segment ${lock === 'balanced' ? 'is-active' : ''}" data-ctx-lock="balanced">Balanced</button>
          <button type="button" class="nui-segmented-btn ctx-segment ${lock === 'strict' ? 'is-active' : ''}" data-ctx-lock="strict">Strict</button>
        </div>
        <p class="ctx-control-hint">${ctxEscape(ctxLockHint(lock))}</p>
      </div>
    </section>
  `
}

function renderContextStats(session, workspaceId, overview) {
  const openTabs = (typeof state !== 'undefined' && Array.isArray(state.tabs))
    ? state.tabs.filter(tab =>
      tab
      && tab.workspaceId === workspaceId
      && tab.type !== 'center')
    : []
  const inProgress = ctxTasksInProgress(session, workspaceId)
  const courses = ctxGetCourses()
  const selectedCount = ctxEffectiveCourseIds(session, courses.map(c => c.id)).size
  const health = overview && overview.health ? overview.health : { label: 'Weak', level: 'weak' }
  const scopedLabel = selectedCount === courses.length || !selectedCount
    ? 'All'
    : String(selectedCount)

  return `
    <section class="ctx-stats" aria-label="Session statistics">
      <article class="ctx-stat-card">
        <span class="home-stat-orb home-stat-purple"></span>
        <div><strong>${openTabs.length}</strong><span>Open pages</span></div>
      </article>
      <article class="ctx-stat-card">
        <span class="home-stat-orb home-stat-blue"></span>
        <div><strong>${inProgress.length}</strong><span>Tasks in progress</span></div>
      </article>
      <article class="ctx-stat-card">
        <span class="home-stat-orb home-stat-amber"></span>
        <div><strong>${ctxEscape(scopedLabel)}</strong><span>Classes scoped</span></div>
      </article>
      <article class="ctx-stat-card">
        <span class="home-stat-orb home-stat-teal"></span>
        <div><strong>${ctxEscape(health.label)}</strong><span>Context health</span></div>
      </article>
    </section>
  `
}

function renderContextTaskItem(task) {
  const badge = ctxTaskStatusBadge(task)
  const dueText = typeof formatTaskDueDisplay === 'function'
    ? formatTaskDueDisplay(task.due)
    : (task.due || 'No due date')
  const courseName = typeof getCanvasCourseDisplayName === 'function'
    ? getCanvasCourseDisplayName(task)
    : (task.course || 'Task')

  return `
    <article class="ctx-task-item">
      <div class="ctx-task-main">
        <h3>${ctxEscape(task.title || 'Untitled task')}</h3>
        <p>${ctxEscape(courseName)} · ${ctxEscape(dueText)}</p>
      </div>
      <span class="nui-badge nui-badge-${badge.tone === 'track' ? 'track' : badge.tone === 'soon' ? 'soon' : badge.tone === 'overdue' ? 'overdue' : 'muted'}">${ctxEscape(badge.label)}</span>
      <button type="button" class="ctx-task-start" data-start-task="${ctxEscape(task.id)}">Resume</button>
    </article>
  `
}

function renderContextTasksPanel(session, workspaceId) {
  const items = ctxTasksInProgress(session, workspaceId)
  return `
    <section class="ctx-panel" aria-label="Tasks in progress">
      <div class="ctx-panel-heading">
        <h2>Tasks in progress</h2>
        <span>${items.length}</span>
      </div>
      <div class="ctx-list">
        ${items.length
    ? items.map(renderContextTaskItem).join('')
    : '<div class="ctx-empty">No active tasks. Start one from Tasks or open a course tab.</div>'}
      </div>
    </section>
  `
}

function ctxApplySessionPatch(id, patch) {
  if (typeof patchWorkspaceSession !== 'function') return
  let nextPatch = patch
  if (patch.groundingMode && typeof window.NucleusWorkspaceSession !== 'undefined') {
    const current = typeof getWorkspaceSession === 'function' ? getWorkspaceSession(id) : {}
    const merged = window.NucleusWorkspaceSession.mergeSessionPatch(current, patch, id)
    if (patch.groundingMode === 'strict_course') {
      nextPatch = {
        ...patch,
        courseScope: {
          ...(merged.courseScope || {}),
          allowOtherCourses: false
        }
      }
    }
  }
  patchWorkspaceSession(id, nextPatch)
  if (typeof recordWorkspaceActivity === 'function' && (patch.groundingMode || patch.contextLock)) {
    const label = patch.groundingMode
      ? `Grounding: ${patch.groundingMode.replace(/_/g, ' ')}`
      : `Context lock: ${patch.contextLock}`
    recordWorkspaceActivity(id, 'context_change', label)
  }
}

function mountContextControllerHandlers(view, workspaceId) {
  if (!view) return
  const id = String(workspaceId || (typeof state !== 'undefined' ? state.activeWorkspaceId : '') || '')

  view.querySelectorAll('[data-ctx-grounding]').forEach(button => {
    button.addEventListener('click', () => {
      const mode = button.dataset.ctxGrounding
      if (!mode) return
      ctxApplySessionPatch(id, { groundingMode: mode })
      if (typeof render === 'function') render()
    })
  })

  view.querySelectorAll('[data-ctx-lock]').forEach(button => {
    button.addEventListener('click', () => {
      const lock = button.dataset.ctxLock
      if (!lock) return
      ctxApplySessionPatch(id, { contextLock: lock })
      if (typeof render === 'function') render()
    })
  })

  view.querySelectorAll('[data-ctx-allow-other-courses]').forEach(input => {
    input.addEventListener('change', () => {
      const session = typeof getWorkspaceSession === 'function' ? getWorkspaceSession(id) : {}
      patchWorkspaceSession(id, {
        courseScope: {
          ...(session.courseScope || {}),
          allowOtherCourses: input.checked
        }
      })
      if (typeof render === 'function') render()
    })
  })

  view.querySelectorAll('[data-ctx-course-id]').forEach(input => {
    input.addEventListener('change', () => {
      const courses = ctxGetCourses()
      const allIds = courses.map(course => course.id)
      const session = typeof getWorkspaceSession === 'function'
        ? getWorkspaceSession(id)
        : {}
      const selected = ctxEffectiveCourseIds(session, allIds)
      const courseId = String(input.dataset.ctxCourseId || '')
      if (!courseId) return

      if (input.checked) selected.add(courseId)
      else selected.delete(courseId)

      let primaryCourseIds = []
      if (selected.size !== allIds.length) {
        primaryCourseIds = allIds.filter(cid => selected.has(cid))
      }

      patchWorkspaceSession(id, {
        courseScope: {
          primaryCourseIds,
          allowOtherCourses: session.courseScope && session.courseScope.allowOtherCourses === false
            ? false
            : selected.size < allIds.length ? false : true
        }
      })
      if (typeof render === 'function') render()
    })
  })
}
