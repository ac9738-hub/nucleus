// Workspace Control Center — context stats, class scope, open pages, session awareness.
// Dependencies: context-controller.js, NucleusWorkspaceSession, renderer globals.

function formatWccDue(value) {
  if (!value) return 'No due date'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return String(value)
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function getWccSession(workspaceId) {
  const lib = window.NucleusWorkspaceSession
  const id = workspaceId || (typeof state !== 'undefined' && state.activeWorkspaceId) || ''
  const raw = typeof workspaceSessions !== 'undefined' && workspaceSessions
    ? workspaceSessions[id]
    : null
  return lib && typeof lib.normalizeSession === 'function'
    ? lib.normalizeSession(raw, id)
    : (raw || {})
}

function renderWccHealthBadge(health) {
  const level = health && health.level ? health.level : 'weak'
  const label = health && health.label ? health.label : 'Weak'
  return `<span class="wcc-health wcc-health-${escapeHtml(level)}">${escapeHtml(label)}</span>`
}

function renderWccOverview(overview) {
  const dueText = formatWccDue(overview.dueAt)
  const reasons = overview.health && Array.isArray(overview.health.reasons)
    ? overview.health.reasons.slice(0, 4)
    : []

  return `
    <section class="wcc-overview" aria-label="Workspace overview">
      <div class="wcc-overview-main">
        <p class="wcc-eyebrow">Current course</p>
        <h2 class="wcc-course">${escapeHtml(overview.courseLabel)}</h2>
        <div class="wcc-overview-grid">
          <div>
            <span class="wcc-label">Working on</span>
            <strong>${escapeHtml(overview.assignmentLabel)}</strong>
          </div>
          <div>
            <span class="wcc-label">Goal</span>
            <strong>${escapeHtml(overview.goal)}</strong>
          </div>
          <div>
            <span class="wcc-label">Due</span>
            <strong>${escapeHtml(dueText)}</strong>
          </div>
        </div>
      </div>
      <div class="wcc-overview-side">
        <div class="wcc-meta-row">
          <span class="wcc-label">Grounding</span>
          <span class="wcc-pill">${escapeHtml(overview.groundingLabel)}</span>
        </div>
        <div class="wcc-meta-row">
          <span class="wcc-label">Context lock</span>
          <span class="wcc-pill wcc-pill-muted">${escapeHtml(overview.lockLabel)}</span>
        </div>
        <div class="wcc-meta-row">
          <span class="wcc-label">Context health</span>
          ${renderWccHealthBadge(overview.health)}
        </div>
        ${reasons.length ? `
          <ul class="wcc-health-reasons">
            ${reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    </section>
  `
}

function renderWccOpenPageItem(tab, session, workspaceId) {
  const lib = window.NucleusWorkspaceSession
  const included = lib && typeof lib.isTabIncludedInContext === 'function'
    ? lib.isTabIncludedInContext(session, tab.id)
    : true
  const kind = lib && typeof lib.tabKindLabel === 'function'
    ? lib.tabKindLabel(tab)
    : (typeof tabKindLabel === 'function' ? tabKindLabel(tab) : 'Tab')
  const subtitle = tab.url || kind
  const checked = included ? 'checked' : ''

  return `
    <article class="wcc-open-page" data-wcc-tab="${escapeHtml(tab.id)}">
      <button type="button" class="wcc-open-page-main" data-wcc-open-tab="${escapeHtml(tab.id)}">
        <div>
          <h3>${escapeHtml(tab.label || kind)}</h3>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <span class="wcc-pill">${escapeHtml(kind)}</span>
      </button>
      <label class="wcc-toggle" title="Include in AI context">
        <input type="checkbox" data-wcc-tab-context="${escapeHtml(tab.id)}" ${checked}>
        <span>Include in AI</span>
      </label>
    </article>
  `
}

function renderWccOpenPages(workspaceId, session) {
  const openTabs = state.tabs.filter(tab =>
    tab
    && tab.workspaceId === workspaceId
    && tab.type !== 'center'
  )

  return `
    <section class="wcc-panel" aria-label="Open pages">
      <div class="wcc-panel-heading">
        <h2>Open pages</h2>
        <span>${openTabs.length}</span>
      </div>
      <p class="wcc-panel-desc">Control which open tabs the AI can use as context.</p>
      <div class="wcc-list">
        ${openTabs.length
          ? openTabs.map(tab => renderWccOpenPageItem(tab, session, workspaceId)).join('')
          : '<div class="wcc-empty">No pages open yet. Open Canvas, a PDF, or a browser tab to build context.</div>'}
      </div>
    </section>
  `
}

function renderWccRecentActivity(session) {
  const items = Array.isArray(session.recentActivity) ? session.recentActivity.slice(0, 6) : []
  if (!items.length) return ''

  return `
    <section class="wcc-panel wcc-panel-compact" aria-label="Recent activity">
      <div class="wcc-panel-heading">
        <h2>Recent activity</h2>
        <span>${items.length}</span>
      </div>
      <div class="wcc-activity-list">
        ${items.map(item => {
          const time = item.at
            ? new Date(item.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
            : ''
          return `
            <div class="wcc-activity-item">
              <span class="wcc-activity-time">${escapeHtml(time)}</span>
              <span class="wcc-activity-label">${escapeHtml(item.label || item.type || 'Activity')}</span>
            </div>
          `
        }).join('')}
      </div>
    </section>
  `
}

function renderWccAppsFooter() {
  if (typeof renderWorkspaceApps !== 'function') return ''
  return `
    <section class="wcc-apps">
      <div class="wcc-panel-heading">
        <h2>Apps</h2>
      </div>
      ${renderWorkspaceApps()}
    </section>
  `
}

function renderWorkspaceControlCenter(workspace) {
  const workspaceId = workspace && workspace.id ? workspace.id : state.activeWorkspaceId
  const session = getWccSession(workspaceId)
  const lib = window.NucleusWorkspaceSession
  const overview = lib && typeof lib.resolveOverview === 'function'
    ? lib.resolveOverview(session, {
      workspace,
      tasks,
      tabs: state.tabs,
      activeTab: typeof getActiveTab === 'function' ? getActiveTab() : null,
      canvasData
    })
    : {
      courseLabel: workspace.name || 'Workspace',
      assignmentLabel: 'No active assignment',
      goal: 'Set a goal for this session',
      dueAt: null,
      groundingLabel: 'Workspace First',
      lockLabel: 'Balanced',
      health: { level: 'weak', label: 'Weak', reasons: [] }
    }

  const controlBar = typeof renderContextControlBar === 'function'
    ? renderContextControlBar(session, workspaceId)
    : ''
  const stats = typeof renderContextStats === 'function'
    ? renderContextStats(session, workspaceId, overview)
    : ''
  const tasksPanel = typeof renderContextTasksPanel === 'function'
    ? renderContextTasksPanel(session, workspaceId)
    : ''

  return `
    <div class="wcc-root ctx-root" data-wcc-workspace="${escapeHtml(workspaceId)}">
      <header class="wcc-header ctx-header">
        <div>
          <p class="wcc-eyebrow ctx-eyebrow">Context controller</p>
          <h1 class="wcc-title ctx-title">${escapeHtml(workspace.name || workspaceId)}</h1>
          <p class="wcc-subtitle ctx-subtitle">${escapeHtml(workspace.description || 'Mission control for your study session.')}</p>
        </div>
        <div class="wcc-header-actions">
          <button type="button" class="wcc-secondary-button" data-open-section="tasks">All tasks</button>
        </div>
      </header>

      ${controlBar}
      ${stats}

      <div class="ctx-grid">
        <div class="ctx-grid-main">
          ${renderWccOverview(overview)}
          ${renderWccOpenPages(workspaceId, session)}
        </div>
        <div class="ctx-grid-side">
          ${tasksPanel}
          ${renderWccRecentActivity(session)}
        </div>
      </div>

      ${renderWccAppsFooter()}
    </div>
  `
}

function mountWorkspaceControlCenterHandlers(view) {
  if (!view) return

  const workspaceId = view.querySelector('[data-wcc-workspace]')
    ? view.querySelector('[data-wcc-workspace]').dataset.wccWorkspace
    : state.activeWorkspaceId

  if (typeof mountContextControllerHandlers === 'function') {
    mountContextControllerHandlers(view, workspaceId)
  }

  view.querySelectorAll('[data-wcc-open-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.dataset.wccOpenTab
      if (!tabId || typeof switchWorkspaceTab !== 'function') return
      switchWorkspaceTab(tabId)
    })
  })

  view.querySelectorAll('[data-wcc-tab-context]').forEach(input => {
    input.addEventListener('change', () => {
      const tabId = input.dataset.wccTabContext
      if (!tabId || typeof patchWorkspaceSession !== 'function') return
      const tab = state.tabs.find(item => String(item.id) === String(tabId))
      const wsId = tab && tab.workspaceId ? tab.workspaceId : state.activeWorkspaceId
      patchWorkspaceSession(wsId, {
        tabContext: {
          [tabId]: { includeInContext: input.checked }
        }
      }, { tab })
      if (typeof render === 'function') render()
    })
  })
}
