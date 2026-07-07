// Renderer application controller.
// Functionality: owns browser-side UI state, bootstraps data from preload IPC,
// handles user actions, starts tasks, and listens for main-process updates.
// Dependencies: preload.js window.nucleus bridge, renderer/workspace-page-tabs.js
// tab mutators, renderer/render.js render functions, and taskoptimizer.js.
// ─── Data (owned by main process, renderer keeps local copies) ───────────────
const DEFAULT_WORKSPACES = [
  { id: "nucleus", name: "Nucleus", description: "Your main planning workspace." },
  { id: "biology", name: "Biology", description: "Labs, readings, and course projects." },
  { id: "computer-science", name: "Computer Science", description: "Problem sets, code practice, and notes." },
  { id: "writing", name: "Writing", description: "Drafts, revisions, and source work." }
];

// var (not let) so app.js and other classic scripts share these bindings.
var tasks = [];         // array of task objects
var workspaces = DEFAULT_WORKSPACES.slice();    // array of workspace objects
var projectGroups = []; // array of project group objects
var canvasData = {};    // parsed canvas_data.json snapshot
var canvasCachePolicy = { diskRecoveryEnabled: true, memoryCacheEnabled: true };
var workspaceSessions = {}; // per-workspace Control Center session state

function getWorkspaceSession(workspaceId) {
  const lib = window.NucleusWorkspaceSession
  const id = String(workspaceId || state.activeWorkspaceId || '')
  const raw = workspaceSessions[id]
  return lib && typeof lib.normalizeSession === 'function'
    ? lib.normalizeSession(raw, id)
    : (raw || {})
}

async function loadWorkspaceSessions() {
  if (!window.nucleus || typeof window.nucleus.getWorkspaceSessions !== 'function') {
    return
  }
  try {
    const result = await window.nucleus.getWorkspaceSessions()
    if (result && result.sessions && typeof result.sessions === 'object') {
      workspaceSessions = result.sessions
    }
  } catch (error) {
    console.error('Unable to load workspace sessions:', error)
  }
}

function patchWorkspaceSession(workspaceId, patch, options = {}) {
  const id = String(workspaceId || state.activeWorkspaceId || '')
  const lib = window.NucleusWorkspaceSession
  let next = null

  if (patch && patch.tabContext && options.tab && lib && typeof lib.setTabIncludeInContext === 'function') {
    const tabId = String(options.tab.id || '')
    const entry = patch.tabContext[tabId]
    if (tabId && entry) {
      next = lib.setTabIncludeInContext(
        getWorkspaceSession(id),
        tabId,
        entry.includeInContext !== false,
        options.tab
      )
      const rest = { ...patch }
      delete rest.tabContext
      if (Object.keys(rest).length) {
        next = lib.mergeSessionPatch(next, rest, id)
      }
    }
  }

  if (!next) {
    next = lib && typeof lib.mergeSessionPatch === 'function'
      ? lib.mergeSessionPatch(getWorkspaceSession(id), patch || {}, id)
      : { ...getWorkspaceSession(id), ...(patch || {}) }
  }

  workspaceSessions[id] = next
  if (window.nucleus && typeof window.nucleus.updateWorkspaceSession === 'function') {
    void window.nucleus.updateWorkspaceSession({ workspaceId: id, session: next })
  }
  syncContextUiState()
  return next
}

function recordWorkspaceActivity(workspaceId, type, label, ref) {
  const lib = window.NucleusWorkspaceSession
  if (!lib || typeof lib.recordActivity !== 'function') return
  const id = String(workspaceId || state.activeWorkspaceId || '')
  const next = lib.recordActivity(getWorkspaceSession(id), { type, label, ref }, id)
  workspaceSessions[id] = next
  if (window.nucleus && typeof window.nucleus.updateWorkspaceSession === 'function') {
    void window.nucleus.updateWorkspaceSession({ workspaceId: id, session: next })
  }
  syncContextUiState()
}

function mergeSnapshotTasks(incoming) {
  return Array.isArray(incoming) && incoming.length ? incoming : tasks;
}

function mergeSnapshotList(incoming, current) {
  return Array.isArray(incoming) && incoming.length ? incoming : current;
}

function mergeSnapshotRecord(incoming, current) {
  return incoming && typeof incoming === "object" && Object.keys(incoming).length
    ? incoming
    : current;
}

async function pullTasksFromMain() {
  if (!window.nucleus) return 0;
  if (typeof window.nucleus.getTasks === "function") {
    const payload = await window.nucleus.getTasks();
    if (payload && Array.isArray(payload.tasks) && payload.tasks.length) {
      tasks = payload.tasks;
      return payload.tasks.length;
    }
    return Number(payload && payload.taskCount) || 0;
  }
  if (typeof window.nucleus.getData === "function") {
    const data = await window.nucleus.getData();
    if (Array.isArray(data.tasks) && data.tasks.length) {
      tasks = data.tasks;
      return data.tasks.length;
    }
  }
  return 0;
}

async function waitForCachedTasks(initialCount) {
  if (initialCount > 0) return;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const count = await pullTasksFromMain();
      if (count > 0 && typeof render === "function") {
        try {
          render();
        } catch (error) {
          console.error("Render failed after task cache retry:", error);
        }
        return;
      }
    } catch (error) {
      console.error("Unable to refresh cached tasks:", error);
      return;
    }
  }
}

// ─── UI State (owned by renderer) ────────────────────────────────────────────
var state = {
  activeSection: "home",         // which top section is active: "home" | "tasks" | "calendar"
  activeWorkspaceId: "nucleus",  // which workspace tab is selected
  activeTabId: null,             // which page tab is active within the workspace
  activeCourseId: null,
  activeTabByWorkspace: {},
  workspaceSidebarCollapsed: false,
  aiPanelWidth: 340,
  aiPanelMinimized: false,
  tabs: [
    { id: "center:nucleus", type: "center", workspaceId: "nucleus", label: "Control Center" }
  ],
  top: 'section'                 // whether the user is in a top section or a workspace: "section" | "workspace"
}
//------DEV FUNCTIONS

const AI_PANEL_MIN_WIDTH = 340;
const AI_PANEL_DEFAULT_WIDTH = 340;
const AI_PANEL_MAX_WIDTH = 680;
let tabSnapshotOverlay = {
  visible: false,
  tabId: null,
  snapshotDataUrl: ""
};

window.__nucleusTabSnapshot = {
  get() {
    return tabSnapshotOverlay;
  },
  clear() {
    tabSnapshotOverlay = { visible: false, tabId: null, snapshotDataUrl: "" };
  }
};

function applyTabViewState(payload) {
  if (!payload || !payload.id) return;
  const isActivePayload = sameTabId(payload.id, state.activeTabId);
  if (!isActivePayload && (payload.tier === 'active' || payload.tier === 'stashed')) {
  }
  const diag = window.__nucleusDiag;
  if (diag && diag.isEnabled("tabs")) {
    diag.logTabs("view_state", {
      tabId: payload.id,
      tier: payload.tier || "",
      discarded: Boolean(payload.discarded),
      loading: typeof payload.loading === "boolean" ? payload.loading : null,
      hasSnapshot: Boolean(payload.snapshotDataUrl),
      isActive: sameTabId(payload.id, state.activeTabId)
    });
  }
  const tab = state.tabs.find(item => sameTabId(item.id, payload.id));
  if (!tab) return;
  if (payload.tier === "active" && !sameTabId(payload.id, state.activeTabId)) {
    if (payload.snapshotDataUrl) {
      tab.snapshotDataUrl = payload.snapshotDataUrl;
    }
    if (typeof payload.loading === "boolean") {
      tab.loading = payload.loading;
    }
    return;
  }
  if (
    payload.tier === "stashed"
    && sameTabId(payload.id, state.activeTabId)
    && tab.type === "canvastab"
    && tab.canvasMode !== "browser"
  ) {
    if (payload.snapshotDataUrl) {
      tab.snapshotDataUrl = payload.snapshotDataUrl;
    }
    return;
  }

  const before = {
    loading: Boolean(tab.loading),
    viewTier: tab.viewTier || "",
    discarded: Boolean(tab.discarded),
    snapshotDataUrl: tab.snapshotDataUrl || ""
  };

  tab.discarded = Boolean(payload.discarded);
  if (payload.snapshotDataUrl) {
    tab.snapshotDataUrl = payload.snapshotDataUrl;
  }
  if (payload.tier === "active") {
    tab.discarded = false;
    if (sameTabId(payload.id, state.activeTabId)) {
      tab.viewTier = "active";
    }
  } else if (payload.tier) {
    tab.viewTier = payload.tier;
  }
  if (typeof payload.loading === "boolean") {
    tab.loading = payload.loading;
  }

  if (
    typeof payload.loading === "boolean"
    && !payload.loading
    && before.loading
    && sameTabId(payload.id, state.activeTabId)
    && tab.type === "canvastab"
    && tab.canvasMode === "browser"
    && (tab.snapshotDataUrl || before.snapshotDataUrl)
  ) {
    tabSnapshotOverlay = {
      visible: true,
      tabId: tab.id,
      snapshotDataUrl: tab.snapshotDataUrl || before.snapshotDataUrl
    };
  }

  const after = {
    loading: Boolean(tab.loading),
    viewTier: tab.viewTier || "",
    discarded: Boolean(tab.discarded),
    snapshotDataUrl: tab.snapshotDataUrl || ""
  };

  const inactiveSnapshotUpdate = payload.tier === "stashed"
    && !sameTabId(payload.id, state.activeTabId);
  if (inactiveSnapshotUpdate && !payload.snapshotDataUrl) {
    return;
  }

  const chromeChanged = before.viewTier !== after.viewTier
    || before.discarded !== after.discarded
    || before.loading !== after.loading;
  const viewChanged = before.loading !== after.loading
    || before.snapshotDataUrl !== after.snapshotDataUrl
    || (Boolean(payload.snapshotDataUrl) && before.snapshotDataUrl !== payload.snapshotDataUrl);

  if (!chromeChanged && !viewChanged) {
    return;
  }

  if (chromeChanged) {
    if (typeof patchWorkspacePageTabs === "function" && sameTabId(payload.id, state.activeTabId)) {
      patchWorkspacePageTabs();
    } else if (typeof scheduleRenderWorkspacePageTabs === "function") {
      scheduleRenderWorkspacePageTabs("patch");
    } else if (typeof renderWorkspacePageTabs === "function") {
      renderWorkspacePageTabs();
    }
  }

  if (sameTabId(payload.id, state.activeTabId)) {
    if (chromeChanged) {
      if (typeof renderBrowserToolbar === "function") {
        renderBrowserToolbar();
      }
      if (typeof renderCanvasToolbar === "function") {
        renderCanvasToolbar();
      }
    }
    if (viewChanged) {
      const diag = window.__nucleusDiag;
      if (diag && diag.isEnabled("tabs")) {
        diag.logTabs("view_repaint", {
          tabId: payload.id,
          loading: Boolean(tab.loading),
          hadLoading: before.loading,
          hasSnapshot: Boolean(tab.snapshotDataUrl),
          tier: payload.tier || tab.viewTier || ""
        });
      }
      if (typeof paintActiveView === "function") {
        paintActiveView({ skipTransition: true });
      } else if (typeof renderView === "function") {
        renderView();
      }
    }
  }
}

// TEST FUNCTION, write current pages HTML to assignmenthtml.json for inspection
async function writeActiveBrowserTabHtml() {
  const result = await window.nucleus.writeActiveTabHtml();
  if (!result || !result.ok) {
    console.error("Unable to write active tab HTML:", result && result.error);
    return;
  }
  console.log(`Wrote active tab HTML to assignmenthtml.json (${result.characters} characters).`);
}

// ─── Data Helpers ─────────────────────────────────────────────────────────────

async function writeActiveBrowserTabFramesHtml() {
  const result = await window.nucleus.writeActiveTabFramesHtml();
  if (!result || !result.ok) {
    console.error("Unable to write active tab frame HTML:", result && result.error);
    return;
  }
  console.log(`Wrote ${result.frames} frame HTML snapshots to ${result.directory}.`);
}

function getWorkspace(workspaceId) {
  const list = Array.isArray(workspaces) ? workspaces : [];
  return list.find(workspace => workspace.id === workspaceId) || list[0] || {
    id: workspaceId || "nucleus",
    name: "Workspace",
    description: ""
  };
}

function getWorkspaceTasks(workspaceId) {
  return (Array.isArray(tasks) ? tasks : []).filter(task => task.workspaceId === workspaceId);
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function getProjectGroups() {
  return Array.isArray(projectGroups) ? projectGroups : [];
}

function getBrowserWorkspaceId() {
  const list = Array.isArray(workspaces) ? workspaces : [];
  if (list.some(workspace => workspace.id === state.activeWorkspaceId)) {
    return state.activeWorkspaceId;
  }
  return list[0] ? list[0].id : "nucleus";
}

function getMaxAiPanelWidth() {
  return Math.max(AI_PANEL_MIN_WIDTH, Math.min(AI_PANEL_MAX_WIDTH, window.innerWidth - 420));
}

function clampAiPanelWidth(width) {
  const numericWidth = Number(width);
  if (!Number.isFinite(numericWidth)) return AI_PANEL_DEFAULT_WIDTH;
  return Math.max(AI_PANEL_MIN_WIDTH, Math.min(getMaxAiPanelWidth(), Math.round(numericWidth)));
}

function syncRightPanelWidth(width) {
  if (window.nucleus && typeof window.nucleus.setRightPanelWidth === "function") {
    window.nucleus.setRightPanelWidth(width).catch(error => {
      console.error("Unable to sync right panel width:", error);
    });
  }
}

function applyAiPanelLayout(syncNative = true) {
  const reservedWidth = state.aiPanelMinimized ? 0 : clampAiPanelWidth(state.aiPanelWidth);
  if (!state.aiPanelMinimized) {
    state.aiPanelWidth = reservedWidth;
  }
  document.documentElement.style.setProperty("--right-panel-width", `${reservedWidth}px`);
  document.body.classList.toggle("ai-panel-minimized", state.aiPanelMinimized);
  if (syncNative) {
    syncRightPanelWidth(reservedWidth);
  }
  if (typeof syncContextUiState === "function") {
    syncContextUiState();
  }
}

function minimizeAiPanel() {
  state.aiPanelMinimized = true;
  applyAiPanelLayout();
}

function restoreAiPanel() {
  state.aiPanelMinimized = false;
  state.aiPanelWidth = clampAiPanelWidth(state.aiPanelWidth || AI_PANEL_DEFAULT_WIDTH);
  applyAiPanelLayout();
}

function setupAiPanelControls() {
  const handle = document.getElementById("ai-panel-resize-handle");
  const minimizeButton = document.getElementById("ai-panel-minimize");
  const restoreButton = document.getElementById("ai-panel-restore");
  let dragging = false;
  let pendingWidth = null;
  let animationFrame = null;

  function commitPendingWidth() {
    animationFrame = null;
    if (pendingWidth == null) return;
    state.aiPanelWidth = clampAiPanelWidth(pendingWidth);
    state.aiPanelMinimized = false;
    applyAiPanelLayout();
  }

  if (handle) {
    handle.addEventListener("pointerdown", event => {
      if (state.aiPanelMinimized) return;
      dragging = true;
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("ai-panel-resizing");
      event.preventDefault();
    });

    handle.addEventListener("pointermove", event => {
      if (!dragging) return;
      pendingWidth = window.innerWidth - event.clientX;
      if (!animationFrame) {
        animationFrame = requestAnimationFrame(commitPendingWidth);
      }
    });

    handle.addEventListener("pointerup", event => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture(event.pointerId);
      document.body.classList.remove("ai-panel-resizing");
      commitPendingWidth();
    });

    handle.addEventListener("pointercancel", () => {
      dragging = false;
      document.body.classList.remove("ai-panel-resizing");
      commitPendingWidth();
    });
  }

  if (minimizeButton) {
    minimizeButton.addEventListener("click", minimizeAiPanel);
  }
  if (restoreButton) {
    restoreButton.addEventListener("click", restoreAiPanel);
  }

  window.addEventListener("resize", () => {
    if (!state.aiPanelMinimized) {
      state.aiPanelWidth = clampAiPanelWidth(state.aiPanelWidth);
    }
    applyAiPanelLayout();
  });

  applyAiPanelLayout();
}


// ─── Render-context contributors ──────────────────────────────────────────────
// The renderer owns UI state (sections, layout, workspace catalog, full tab list)
// and pushes it into the main-process native context store.

let lastContextUiStateKey = ''

function buildContextUiStatePayload() {
  return {
    top: state.top,
    activeSection: state.activeSection,
    activeWorkspaceId: state.activeWorkspaceId,
    activeTabId: state.activeTabId,
    workspaceSidebarCollapsed: state.workspaceSidebarCollapsed,
    aiPanelWidth: state.aiPanelWidth,
    aiPanelMinimized: state.aiPanelMinimized,
    workspaces: Array.isArray(workspaces)
      ? workspaces.map(workspace => ({
          id: workspace.id,
          name: workspace.name,
          description: workspace.description
        }))
      : [],
    tabs: Array.isArray(state.tabs)
      ? state.tabs.map(tab => ({
          id: tab.id,
          type: tab.type,
          label: tab.label,
          workspaceId: tab.workspaceId,
          url: tab.url || "",
          canvasMode: tab.canvasMode,
          courseId: tab.courseId || "",
          courseSection: tab.courseSection || "",
          canvasNativePage: tab.canvasNativePage || ""
        }))
      : [],
    workspaceSessions: workspaceSessions
  };
}

function syncContextUiState() {
  if (!window.nucleus || typeof window.nucleus.pushUiState !== "function") return;
  try {
    const payload = buildContextUiStatePayload();
    const key = JSON.stringify(payload);
    if (key === lastContextUiStateKey) return;
    lastContextUiStateKey = key;
    window.nucleus.pushUiState(payload);
  } catch (error) {
    console.error("Unable to push UI state context:", error);
  }
}

function syncRenderContext() {
  syncContextUiState();
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function queueSyncActiveTab() {
  if (!window.nucleus || typeof window.nucleus.newactivetab !== "function") {
    return;
  }
  Promise.resolve(syncActiveTab()).catch(error => {
    console.error("Unable to sync active tab:", error);
  });
}

async function setActiveSection(section) {
  rememberActiveWorkspaceTab();
  state.activeSection = section;
  state.activeTabId = null;
  state.activeCourseId = null;
  state.top = 'section';
  if (window.nucleusViewTransition) {
    window.nucleusViewTransition.beginTransition();
  }
  render();
  queueSyncActiveTab();
}

function setActiveWorkspace(workspaceId) {
  const switchGen = bumpTabSurfaceSyncGeneration();
  rememberActiveWorkspaceTab();
  state.top = 'workspace';
  state.activeCourseId = null;
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = getRememberedWorkspaceTabId(workspaceId);

  patchOptimisticWorkspaceTabActive(state.activeTabId);

  renderWorkspaceSidebarCollapseState();
  renderPrimaryTabs();
  renderWorkspaceTabs();
  if (typeof updateWorkspacePageTabs === "function") {
    updateWorkspacePageTabs({ tabBar: "full" });
  } else {
    patchWorkspacePageTabs();
  }

  renderBrowserToolbar();
  renderCanvasToolbar();
  beginPendingViewTransition();
  paintActiveView({ fast: true });

  if (typeof syncRenderContext === "function") {
    syncRenderContext();
  }
  deferWorkspaceSurfaceSync(switchGen);
}

function addworkspace(workspaceid, name) {
  return window.nucleus.newWorkspace({
    id: workspaceid,
    name,
    description: `Workspace for ${name}.`
  });
}

function slugifyWorkspaceName(name) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  let candidate = base;
  let suffix = 2;

  while (workspaces.some(workspace => workspace.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function manuallyAddWorkspace() {
  const form = document.getElementById("new-workspace-form");
  const input = document.getElementById("new-workspace-input");
  const name = input.value;
  if (!name || !name.trim()) return;

  const trimmedName = name.trim();
  const workspaceId = slugifyWorkspaceName(trimmedName);
  const result = await addworkspace(workspaceId, trimmedName);

  if (result === 1 || result === 2 || (result && result.ok === false)) {
    console.error("Unable to create workspace:", result);
    input.select();
    return;
  }

  input.value = "";
  form.classList.add("is-hidden");
  state.top = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = ensureWorkspaceCenter(workspaceId);
  state.activeTabByWorkspace[workspaceId] = state.activeTabId;
  render();
  queueTabSyncAfterRender();
}

function showNewWorkspaceForm() {
  const form = document.getElementById("new-workspace-form");
  const input = document.getElementById("new-workspace-input");
  form.classList.remove("is-hidden");
  input.focus();
}

function hideNewWorkspaceForm() {
  const form = document.getElementById("new-workspace-form");
  const input = document.getElementById("new-workspace-input");
  input.value = "";
  form.classList.add("is-hidden");
}

function renderWorkspaceSidebarCollapseState() {
  document.body.classList.toggle("workspace-sidebar-collapsed", Boolean(state.workspaceSidebarCollapsed));
  if (typeof syncContextUiState === "function") {
    syncContextUiState();
  }
  const toggle = document.getElementById("workspace-sidebar-toggle");
  if (!toggle) return;
  const collapsed = Boolean(state.workspaceSidebarCollapsed);
  toggle.textContent = collapsed ? ">" : "<";
  toggle.setAttribute("aria-label", collapsed ? "Expand workspace sidecar" : "Collapse workspace sidecar");
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.title = collapsed ? "Expand workspace sidecar" : "Collapse workspace sidecar";
}

async function setWorkspaceSidebarCollapsed(collapsed) {
  state.workspaceSidebarCollapsed = Boolean(collapsed);
  renderWorkspaceSidebarCollapseState();
  if (window.nucleus && typeof window.nucleus.setWorkspaceSidebarCollapsed === "function") {
    try {
      await window.nucleus.setWorkspaceSidebarCollapsed(state.workspaceSidebarCollapsed);
    } catch (error) {
      console.error("Unable to update workspace sidecar layout:", error);
    }
  }
}

function toggleWorkspaceSidebar() {
  setWorkspaceSidebarCollapsed(!state.workspaceSidebarCollapsed);
}

async function deleteWorkspace(workspaceId) {
  const result = await window.nucleus.deleteWorkspace(workspaceId);
  if (!result || !result.ok) {
    console.error("Unable to delete workspace:", result && result.error);
    return;
  }

  state.tabs = state.tabs.filter(tab => tab.workspaceId !== workspaceId);
  delete state.activeTabByWorkspace[workspaceId];

  if (state.activeWorkspaceId === workspaceId) {
    const fallback = workspaces.find(workspace => workspace.id !== workspaceId);
    if (fallback) {
      state.top = "workspace";
      state.activeWorkspaceId = fallback.id;
      state.activeTabId = getRememberedWorkspaceTabId(fallback.id);
    } else {
      state.top = "section";
      state.activeTabId = null;
    }
  }

  await syncTabs();
  syncActiveTab();
  render();
}

// ─── Task Actions ─────────────────────────────────────────────────────────────
let renderafterupdate = false;
let pendingworkspaceID = null;
let pendingtabID = null;
let startTaskErrorTimeout = null;

function showStartTaskError(message) {
  console.error(message);
  let banner = document.getElementById("start-task-error");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "start-task-error";
    banner.className = "start-task-error-banner";
    banner.setAttribute("role", "alert");
    document.body.appendChild(banner);
  }
  banner.textContent = message;
  banner.hidden = false;
  clearTimeout(startTaskErrorTimeout);
  startTaskErrorTimeout = setTimeout(() => {
    banner.hidden = true;
  }, 8000);
}

function revertStartTaskNavigation() {
  state.top = "section";
  state.activeSection = "tasks";
  render();
}

function isCanvasSourceTask(task) {
  return task && task.source === "canvas" && task.courseId;
}

function canvasTaskSection(task) {
  if (task.type === "canvas-study-task") return "files";
  if (task.type === "canvas-assignment") return "assignments";
  return "homepage";
}

function isLikelyDownloadUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.href);
    const path = parsed.pathname.toLowerCase();
    if (/\.(pdf|zip|docx?|pptx?|xlsx?|csv|png|jpe?g|gif|webp)(\?|$)/.test(path)) {
      return true;
    }
    if (path.includes("/files/") && (path.endsWith("/download") || parsed.searchParams.has("download_frd"))) {
      return true;
    }
  } catch (_error) {
    return false;
  }
  return false;
}

function pickPrimaryBrowserUrl(task) {
  const candidates = [
    task.assignmenturl,
    ...(Array.isArray(task.urls) ? task.urls : [])
  ].map(value => String(value || "").trim()).filter(Boolean);

  for (const url of candidates) {
    if (!isLikelyDownloadUrl(url)) {
      return url;
    }
  }
  return candidates[0] || "";
}

async function ensureTaskWorkspace(task) {
  if (!task.workspaceId) {
    task.workspaceId = task.id + "wkspce";
  }

  const workspaceId = task.workspaceId;
  if (!workspaces.some(workspace => workspace.id === workspaceId)) {
    let workspaceName = task.title || "Task";
    let result = await addworkspace(workspaceId, workspaceName);
    if (result === 2) {
      workspaceName = `${workspaceName} (${String(task.id || workspaceId).slice(0, 8)})`;
      result = await addworkspace(workspaceId, workspaceName);
    }

    const created = result && result.ok !== false && result !== 2;
    if (!created && result !== 1) {
      console.error("Unable to create task workspace:", result && result.error ? result.error : result);
      return null;
    }

    if (!workspaces.some(workspace => workspace.id === workspaceId)) {
      workspaces.push({
        id: workspaceId,
        name: workspaceName,
        description: `Workspace for ${workspaceName}.`
      });
    }
  }

  const centerTabId = ensureWorkspaceCenter(workspaceId);
  state.top = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = centerTabId;
  state.activeTabByWorkspace[workspaceId] = centerTabId;
  return workspaceId;
}

async function startTask(taskId) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) {
    showStartTaskError("Task not found.");
    return;
  }

  const workspaceId = await ensureTaskWorkspace(task);
  if (!workspaceId) {
    showStartTaskError("Unable to create a workspace for this task.");
    return;
  }

  if (typeof recordWorkspaceActivity === "function") {
    recordWorkspaceActivity(workspaceId, "task_start", `Started ${task.title || "task"}`, { taskId: task.id });
  }

  if (isCanvasSourceTask(task)) {
    const result = await openCanvasAppTab(workspaceId, task.courseId, {
      courseSection: canvasTaskSection(task)
    });
    if (!result || result.ok === false) {
      revertStartTaskNavigation();
      showStartTaskError(result && result.error ? result.error : "Unable to open Canvas for this task.");
      return;
    }
    return;
  }

  const primaryUrl = pickPrimaryBrowserUrl(task);
  if (primaryUrl) {
    const result = await openUrlInWorkspaceTab(primaryUrl, workspaceId, true);
    if (!result || result.ok === false) {
      revertStartTaskNavigation();
      showStartTaskError(result && result.error ? result.error : "Unable to open the task link.");
      return;
    }
    await syncTabs();
    await syncActiveTab();
    render();
    return;
  }

  await syncTabs();
  await syncActiveTab();
  render();

  try {
    await window.nucleus.startTask(task);
  } catch (error) {
    console.error("Unable to start task:", error);
    showStartTaskError("Unable to start this task.");
  }
}

// ─── AI Agent ─────────────────────────────────────────────────────────────────

function startagent() {
  const input = document.getElementById("ai-input");
  const messages = document.getElementById("ai-messages");
  const sendButton = document.getElementById("ai-send-button") || document.querySelector(".ai-send-button");
  const usageToast = document.getElementById("ai-usage-toast");
  const usageToastCopy = document.getElementById("ai-usage-toast-copy");
  const usageToastDismiss = document.getElementById("ai-usage-toast-dismiss");
  const attachButton = document.getElementById("ai-attach-button");
  const fileInput = document.getElementById("ai-file-input");
  const attachmentsContainer = document.getElementById("ai-attachments");
  let currentResponse = null;
  let responseTextEl = null;
  let responseBuffer = "";
  let deltaBuffer = "";
  let deltaRaf = 0;
  let scrollTarget = 0;
  let scrollAnimFrame = 0;
  let sidekickResponseInFlight = false;
  let sidekickAnswerMode = "grounded";
  let sidekickModel = "claude-sonnet-4-6";
  const SIDEKICK_MODE_STORAGE_KEY = "nucleus.sidekickAnswerMode";
  const SIDEKICK_MODEL_STORAGE_KEY = "nucleus.sidekickModel";
  let sidekickComposerControls = null;
  let pendingAttachments = [];
  let pendingRegionContext = null;
  let pendingRegionAttachmentId = null;
  const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

  function updateAnswerModeUi() {
    const inputEl = document.getElementById("ai-input");
    const sub = document.querySelector(".ai-panel-header-sub");
    if (inputEl) {
      inputEl.placeholder = sidekickAnswerMode === "grounded"
        ? "Ask about your courses, tasks, or screen…"
        : "Ask anything (general knowledge)…";
    }
    if (sub) {
      sub.textContent = sidekickAnswerMode === "grounded"
        ? "Grounded in your Canvas"
        : "General answers";
    }
  }

  function setAnswerMode(mode) {
    sidekickAnswerMode = window.SidekickComposerControls
      ? window.SidekickComposerControls.normalizeMode(mode)
      : (String(mode || "").trim().toLowerCase() === "general" ? "general" : "grounded");
    try {
      localStorage.setItem(SIDEKICK_MODE_STORAGE_KEY, sidekickAnswerMode);
    } catch (_error) {}
    if (sidekickComposerControls) sidekickComposerControls.setAnswerMode(sidekickAnswerMode);
    updateAnswerModeUi();
  }

  function setSidekickModel(model) {
    sidekickModel = window.SidekickComposerControls
      ? window.SidekickComposerControls.normalizeModel(model)
      : String(model || "claude-sonnet-4-6");
    try {
      localStorage.setItem(SIDEKICK_MODEL_STORAGE_KEY, sidekickModel);
    } catch (_error) {}
    if (sidekickComposerControls) sidekickComposerControls.setSidekickModel(sidekickModel);
  }

  let storedMode = "grounded";
  let storedModel = "claude-sonnet-4-6";
  try {
    storedMode = localStorage.getItem(SIDEKICK_MODE_STORAGE_KEY) || "grounded";
    storedModel = localStorage.getItem(SIDEKICK_MODEL_STORAGE_KEY) || "claude-sonnet-4-6";
  } catch (_error) {}

  if (window.SidekickComposerControls) {
    sidekickComposerControls = window.SidekickComposerControls.init({
      answerMode: storedMode,
      sidekickModel: storedModel,
      onModeChange: function (mode) {
        sidekickAnswerMode = mode;
        try {
          localStorage.setItem(SIDEKICK_MODE_STORAGE_KEY, mode);
        } catch (_error) {}
        updateAnswerModeUi();
      },
      onModelChange: function (model) {
        sidekickModel = model;
        try {
          localStorage.setItem(SIDEKICK_MODEL_STORAGE_KEY, model);
        } catch (_error) {}
      }
    });
    sidekickAnswerMode = sidekickComposerControls.getAnswerMode();
    sidekickModel = sidekickComposerControls.getSidekickModel();
  } else {
    sidekickAnswerMode = String(storedMode).trim().toLowerCase() === "general" ? "general" : "grounded";
    sidekickModel = storedModel;
  }
  updateAnswerModeUi();

  function showAiUsageToast(message) {
    if (!usageToast) return;
    const text = String(message || "").trim();
    if (usageToastCopy && text) usageToastCopy.textContent = text;
    usageToast.classList.remove("is-hidden");
  }

  function hideAiUsageToast() {
    if (!usageToast) return;
    usageToast.classList.add("is-hidden");
  }

  window.showAiUsageToast = showAiUsageToast;
  window.hideAiUsageToast = hideAiUsageToast;

  if (usageToastDismiss) {
    usageToastDismiss.addEventListener("click", hideAiUsageToast);
  }

  if (sendButton) {
    sendButton.addEventListener("click", () => {
      submitPrompt();
    });
  }

  if (window.nucleus && typeof window.nucleus.on === "function") {
    window.nucleus.on("prompt:usage-warning", (payload) => {
      const message = payload && typeof payload === "object"
        ? payload.message
        : payload;
      showAiUsageToast(message || "Usage limit reached. Responses may be slower.");
    });
  }

  function setSidekickInFlight(value) {
    sidekickResponseInFlight = value;
    input.disabled = value;
    if (sendButton) {
      sendButton.disabled = value;
    }
    if (attachButton) {
      attachButton.disabled = value;
    }
    document.querySelectorAll(".ai-dropdown-trigger").forEach(trigger => {
      trigger.disabled = value;
    });
  }

  function smoothScrollStep() {
    if (!messages) {
      scrollAnimFrame = 0;
      return;
    }
    scrollTarget = Math.max(0, messages.scrollHeight - messages.clientHeight);
    const current = messages.scrollTop;
    const diff = scrollTarget - current;
    if (Math.abs(diff) < 0.5) {
      messages.scrollTop = scrollTarget;
      scrollAnimFrame = 0;
      return;
    }
    messages.scrollTop = current + diff * 0.14;
    scrollAnimFrame = requestAnimationFrame(smoothScrollStep);
  }

  function scrollMessagesToBottom(immediate = false) {
    if (!messages) return;
    scrollTarget = Math.max(0, messages.scrollHeight - messages.clientHeight);
    if (immediate) {
      if (scrollAnimFrame) {
        cancelAnimationFrame(scrollAnimFrame);
        scrollAnimFrame = 0;
      }
      messages.scrollTop = scrollTarget;
      return;
    }
    if (!scrollAnimFrame) {
      scrollAnimFrame = requestAnimationFrame(smoothScrollStep);
    }
  }

  function appendStreamChunk(textEl, text) {
    if (!textEl || !text) return;
    const span = document.createElement("span");
    span.className = "ai-stream-chunk";
    span.textContent = text;
    textEl.appendChild(span);
  }

  function dismissHero() {
    messages.querySelectorAll(".ai-hero-card, .ai-quick-actions").forEach(node => node.remove());
  }

  function beginThinkingBubble(initialStatus = 'Thinking…') {
    const node = document.createElement("div");
    node.classList.add("ai-message", "response", "ai-thinking");
    node.innerHTML =
      `<div class="ai-agent-status" aria-live="polite">${escapeHtml(initialStatus)}</div>` +
      '<div class="ai-thinking-dots" aria-hidden="true"><span></span><span></span><span></span></div>';
    messages.appendChild(node);
    currentResponse = node;
    responseTextEl = null;
    responseBuffer = "";
    scrollMessagesToBottom();
  }

  function setAgentStatus(label) {
    const text = String(label || "").trim();
    if (!text) return;
    if (!currentResponse || !currentResponse.classList.contains("ai-thinking")) {
      beginThinkingBubble(text);
      return;
    }
    let statusEl = currentResponse.querySelector(".ai-agent-status");
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.className = "ai-agent-status";
      statusEl.setAttribute("aria-live", "polite");
      currentResponse.insertBefore(statusEl, currentResponse.firstChild);
    }
    statusEl.textContent = text;
    scrollMessagesToBottom();
  }

  function transitionThinkingToStream() {
    if (!currentResponse) return;
    if (!currentResponse.classList.contains("ai-thinking")) return;
    currentResponse.classList.remove("ai-thinking");
    currentResponse.classList.add("ai-streaming");
    currentResponse.innerHTML =
      '<div class="ai-response-text"></div><span class="ai-stream-cursor" aria-hidden="true"></span>';
    responseTextEl = currentResponse.querySelector(".ai-response-text");
    responseBuffer = "";
    deltaBuffer = "";
  }

  function ensureStreamingBubble() {
    if (currentResponse && responseTextEl) return;
    if (currentResponse && currentResponse.classList.contains("ai-thinking")) {
      transitionThinkingToStream();
      return;
    }
    const node = document.createElement("div");
    node.classList.add("ai-message", "response", "ai-streaming");
    node.innerHTML =
      '<div class="ai-response-text"></div><span class="ai-stream-cursor" aria-hidden="true"></span>';
    messages.appendChild(node);
    currentResponse = node;
    responseTextEl = node.querySelector(".ai-response-text");
    responseBuffer = "";
    deltaBuffer = "";
    scrollMessagesToBottom();
  }

  function flushDelta() {
    if (deltaRaf) {
      cancelAnimationFrame(deltaRaf);
      deltaRaf = 0;
    }
    if (!responseTextEl || !deltaBuffer) return;
    appendStreamChunk(responseTextEl, deltaBuffer);
    deltaBuffer = "";
    scrollMessagesToBottom();
  }

  function pushChunk(chunk) {
    const text = String(chunk || "");
    if (!text) return;
    ensureStreamingBubble();
    responseBuffer += text;
    deltaBuffer += text;
    if (deltaRaf) return;
    deltaRaf = requestAnimationFrame(() => {
      deltaRaf = 0;
      if (!responseTextEl || !deltaBuffer) return;
      const batch = deltaBuffer;
      deltaBuffer = "";
      appendStreamChunk(responseTextEl, batch);
      scrollMessagesToBottom();
    });
  }

  function finalizeResponse() {
    flushDelta();
    if (!currentResponse) return;
    currentResponse.classList.remove("ai-thinking", "ai-streaming");
    const cursor = currentResponse.querySelector(".ai-stream-cursor");
    if (cursor) cursor.remove();
  }

  window.nucleus.on('prompt:response-chunk', (chunk) => {
    pushChunk(chunk);
  });

  window.nucleus.on('prompt:status', (payload) => {
    const label = payload && typeof payload === 'object' ? payload.label : payload;
    setAgentStatus(label);
  });

  window.nucleus.on('prompt:response-replace', (text) => {
    flushDelta();
    ensureStreamingBubble();
    responseBuffer = String(text || "");
    if (responseTextEl) {
      responseTextEl.textContent = responseBuffer;
    }
    currentResponse.classList.remove("ai-streaming");
    const cursor = currentResponse.querySelector(".ai-stream-cursor");
    if (cursor) cursor.remove();
    highlightInlineCitations(currentResponse);
    scrollMessagesToBottom();
  });

  window.nucleus.on('prompt:response-citations', (citations) => {
    if (!currentResponse || !Array.isArray(citations) || !citations.length) return;
    highlightInlineCitations(currentResponse);
    const footer = document.createElement("div");
    footer.className = "ai-citations";
    footer.innerHTML = citations.map(citation => {
      const label = escapeHtml(citation.citeLabel || "");
      const hint = escapeHtml(citation.weekLabel || citation.itemName || citation.fileid || "source");
      const title = escapeHtml(citation.text || "");
      return `<span class="ai-citation-chip" title="${title}">[${label}] ${hint}</span>`;
    }).join(" ");
    currentResponse.appendChild(footer);
    scrollMessagesToBottom();
  });

  function highlightInlineCitations(element) {
    if (!element) return;
    const textEl = element.querySelector(".ai-response-text") || element;
    const raw = textEl.textContent || "";
    if (!/\[(?:C|R)\d+\]/.test(raw)) return;
    textEl.innerHTML = escapeHtml(raw).replace(
      /\[(C|R)(\d+)\]/g,
      '<span class="ai-cite-inline" title="Grounded source">[$1$2]</span>'
    );
  }

  window.nucleus.on('prompt:response-done', () => {
    if (currentResponse && currentResponse.classList.contains("ai-thinking")) {
      currentResponse.remove();
    } else {
      finalizeResponse();
    }
    currentResponse = null;
    responseTextEl = null;
    responseBuffer = "";
    deltaBuffer = "";
    setSidekickInFlight(false);
    input.focus();
  });

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderPendingAttachments() {
    if (!attachmentsContainer) return;
    attachmentsContainer.innerHTML = pendingAttachments.map(attachment => `
      <span class="ai-attachment-chip" title="${escapeHtml(attachment.name)}">
        <span>${escapeHtml(attachment.name)}${attachment.size ? ` · ${escapeHtml(formatBytes(attachment.size))}` : ""}</span>
        <button type="button" class="ai-attachment-remove" data-attachment-id="${escapeHtml(attachment.id)}" aria-label="Remove ${escapeHtml(attachment.name)}">x</button>
      </span>
    `).join("");
    attachmentsContainer.querySelectorAll("[data-attachment-id]").forEach(button => {
      button.addEventListener("click", () => {
        const removedId = button.dataset.attachmentId;
        pendingAttachments = pendingAttachments.filter(item => item.id !== removedId);
        if (removedId === pendingRegionAttachmentId) {
          pendingRegionAttachmentId = null;
          pendingRegionContext = null;
        }
        renderPendingAttachments();
      });
    });
  }

  function removePendingRegionAttachment() {
    if (!pendingRegionAttachmentId) return;
    pendingAttachments = pendingAttachments.filter(item => item.id !== pendingRegionAttachmentId);
    pendingRegionAttachmentId = null;
  }

  function upsertRegionAttachment(attachment, contextText) {
    removePendingRegionAttachment();
    pendingRegionAttachmentId = attachment.id;
    pendingAttachments.push(attachment);
    pendingRegionContext = contextText;
    renderPendingAttachments();
  }

  function getActiveWebLikeTab() {
    if (!Array.isArray(state.tabs)) return null;
    const active = state.tabs.find(item => sameTabId(item.id, state.activeTabId));
    if (!active) return null;
    if (active.type === "browsertab") return active;
    if (active.type === "canvastab" && active.canvasMode === "browser") return active;
    return null;
  }

  function applyRegionCaptureResult(result, activeTab) {
    if (result.mode === "screenshot" && result.image && result.image.data) {
      const contextText = [
        "Selected screen region:",
        `URL: ${result.url || activeTab.url || ""}`,
        `Region (app px): x=${result.region && result.region.x}, y=${result.region && result.region.y}, w=${result.region && result.region.width}, h=${result.region && result.region.height}`
      ].join("\n");
      upsertRegionAttachment({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: result.image.name || "Region screenshot.png",
        type: result.image.mimeType || "image/png",
        size: 0,
        kind: "image",
        data: result.image.data,
        source: "region"
      }, contextText);
    }
    const systemMessage = document.createElement("div");
    systemMessage.classList.add("ai-message", "system");
    systemMessage.innerText = "Captured selected region and added it to input as a removable object.";
    messages.appendChild(systemMessage);
    messages.scrollTop = messages.scrollHeight;
  }

  async function captureRegionFromShortcut(payload = {}) {
    if (!window.nucleus || typeof window.nucleus.captureRegionShortcut !== "function") {
      return;
    }
    const activeTab = payload && payload.tabId
      ? (Array.isArray(state.tabs) ? state.tabs.find(item => sameTabId(item.id, payload.tabId)) : null)
      : getActiveWebLikeTab();
    if (!activeTab) {
      const systemMessage = document.createElement("div");
      systemMessage.classList.add("ai-message", "system");
      systemMessage.innerText = "Region capture needs an active browser or Canvas web tab.";
      messages.appendChild(systemMessage);
      messages.scrollTop = messages.scrollHeight;
      return;
    }
    try {
      const result = await window.nucleus.captureRegionShortcut({ tabId: activeTab.id });
      if (!result || !result.ok) {
        if (result && result.cancelled) return;
        throw new Error((result && result.error) || "Unable to capture region.");
      }
      applyRegionCaptureResult(result, activeTab);
    } catch (error) {
      const systemMessage = document.createElement("div");
      systemMessage.classList.add("ai-message", "system");
      systemMessage.innerText = error && error.message ? error.message : String(error);
      messages.appendChild(systemMessage);
      messages.scrollTop = messages.scrollHeight;
    }
  }

  if (window.nucleus && typeof window.nucleus.on === "function") {
    window.nucleus.on("shortcut:region_capture", (payload) => {
      captureRegionFromShortcut(payload || {});
    });
    window.nucleus.on("shortcut:region_capture_failed", (payload) => {
      const systemMessage = document.createElement("div");
      systemMessage.classList.add("ai-message", "system");
      systemMessage.innerText = payload && payload.message
        ? payload.message
        : "Region capture is unavailable on the current tab.";
      messages.appendChild(systemMessage);
      messages.scrollTop = messages.scrollHeight;
    });
  }

  function readFileAs(file, method) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error(`Unable to read ${file.name}`));
      reader[method](file);
    });
  }

  function dataUrlPayload(dataUrl) {
    const text = String(dataUrl || "");
    const comma = text.indexOf(",");
    if (comma === -1) return "";
    return text.slice(comma + 1);
  }

  async function buildAttachment(file, source = "file") {
    const type = file.type || "application/octet-stream";
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base = {
      id,
      name: file.name || (source === "paste" ? "Pasted screenshot.png" : "Attachment"),
      type,
      size: file.size || 0,
      source
    };

    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { ...base, kind: "metadata", note: "File is too large to attach directly." };
    }

    if (type.startsWith("image/")) {
      const dataUrl = await readFileAs(file, "readAsDataURL");
      return { ...base, kind: "image", data: dataUrlPayload(dataUrl) };
    }

    if (type === "application/pdf") {
      const dataUrl = await readFileAs(file, "readAsDataURL");
      return { ...base, kind: "document", data: dataUrlPayload(dataUrl) };
    }

    if (type.startsWith("text/") || /\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(file.name || "")) {
      const text = await readFileAs(file, "readAsText");
      return { ...base, kind: "text", text: String(text || "").slice(0, 60000) };
    }

    return { ...base, kind: "metadata", note: "Unsupported binary file attached as metadata only." };
  }

  async function addFiles(fileList, source = "file") {
    const files = Array.from(fileList || []);
    for (const file of files) {
      try {
        pendingAttachments.push(await buildAttachment(file, source));
      } catch (error) {
        pendingAttachments.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name || "Attachment",
          type: file.type || "",
          size: file.size || 0,
          kind: "metadata",
          note: error && error.message ? error.message : String(error),
          source
        });
      }
    }
    renderPendingAttachments();
  }

  function renderUserAttachmentSummary(container, attachments) {
    if (!attachments.length) return;
    const summary = document.createElement("div");
    summary.className = "ai-attachment-summary";
    summary.innerText = attachments.map(item => `Attached: ${item.name}`).join("\n");
    container.appendChild(summary);
  }

  async function submitPrompt() {
    const promptText = input.value.trim();
    if (sidekickResponseInFlight || (promptText === "" && pendingAttachments.length === 0)) return;

    dismissHero();

    const attachmentsToSend = pendingAttachments.slice();
    const message = document.createElement("div");
    message.classList.add("ai-message");
    message.innerText = promptText || "Sent attachments";
    renderUserAttachmentSummary(message, attachmentsToSend);
    messages.appendChild(message);

    beginThinkingBubble();

    setSidekickInFlight(true);
    window.nucleus.sendprompt({
      text: promptText,
      answerMode: sidekickComposerControls
        ? sidekickComposerControls.getAnswerMode()
        : sidekickAnswerMode,
      sidekickModel: sidekickComposerControls
        ? sidekickComposerControls.getSidekickModel()
        : sidekickModel,
      attachments: attachmentsToSend,
      systemContext: "",
      regionContext: pendingRegionContext || ""
    });
    input.value = "";
    pendingAttachments = [];
    pendingRegionContext = null;
    pendingRegionAttachmentId = null;
    renderPendingAttachments();
    scrollMessagesToBottom();
  }

  window.sendMessage = submitPrompt;

  if (attachButton && fileInput) {
    attachButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      addFiles(fileInput.files);
      fileInput.value = "";
    });
  }

  input.addEventListener("paste", event => {
    const items = Array.from(event.clipboardData && event.clipboardData.items ? event.clipboardData.items : []);
    const imageFiles = items
      .filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length) {
      addFiles(imageFiles, "paste");
    }
  });

  input.addEventListener("keypress", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitPrompt();
  });

  renderPendingAttachments();
}


// ─── Settings + Theme ─────────────────────────────────────────────────────────

// Replaces the active theme <link> tags so a theme switch applies without a
// full window reload (preserving open tabs and app state).
function applyThemeStylesheets(stylesheets) {
  if (!Array.isArray(stylesheets) || !stylesheets.length) return;
  const head = document.head;
  const previous = Array.from(head.querySelectorAll('link[data-theme-style]'));
  document.documentElement.classList.add("theme-switching");
  // Cache-bust so the same path under a new theme reloads even if cached.
  const stamp = Date.now();
  const fresh = stylesheets.map(href => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${href}?v=${stamp}`;
    link.dataset.themeStyle = "1";
    head.appendChild(link);
    return link;
  });
  // Remove the old sheets once the new ones are in the DOM to avoid a flash.
  requestAnimationFrame(() => {
    previous.forEach(link => link.remove());
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("theme-switching");
    });
  });
  return fresh;
}

async function renderThemeOptions() {
  const container = document.getElementById("theme-options");
  if (!container || !window.nucleus || typeof window.nucleus.listThemes !== "function") return;

  let data;
  try {
    data = await window.nucleus.listThemes();
  } catch (error) {
    console.error("Unable to list themes:", error);
    return;
  }

  const themes = (data && Array.isArray(data.themes)) ? data.themes : [];
  const active = data && data.active ? data.active : "default";

  container.innerHTML = themes.map(theme => `
    <button type="button" class="theme-option ${theme.name === active ? "active" : ""}" data-theme="${escapeHtml(theme.name)}">
      <span class="theme-swatch theme-swatch--${escapeHtml(theme.name)}" aria-hidden="true"></span>
      <span class="theme-option-label">${escapeHtml(theme.label || theme.name)}</span>
      <span class="theme-option-check" aria-hidden="true">✓</span>
    </button>
  `).join("");

  container.querySelectorAll(".theme-option").forEach(button => {
    button.addEventListener("click", async () => {
      const name = button.dataset.theme;
      if (!name || button.classList.contains("active")) return;
      try {
        const result = await window.nucleus.setTheme(name);
        if (result && result.ok) {
          // Swapping the stylesheet link is enough: each theme's styles.css owns
          // its own :root tokens, so the new file fully reskins the renderer.
          applyThemeStylesheets(result.rendererStylesheets);
          container.querySelectorAll(".theme-option").forEach(option => {
            option.classList.toggle("active", option.dataset.theme === (result.active || name));
          });
        }
      } catch (error) {
        console.error("Unable to set theme:", error);
      }
    });
  });
}

async function openSettings() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay || !overlay.classList.contains("is-hidden")) return;
  if (window.NucleusRendererOverlay) {
    await window.NucleusRendererOverlay.open();
  }
  overlay.classList.remove("is-hidden");
  renderThemeOptions();
}

async function closeSettings() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay || overlay.classList.contains("is-hidden")) return;
  overlay.classList.add("is-hidden");
  if (window.NucleusRendererOverlay) {
    await window.NucleusRendererOverlay.close();
  }
}

async function logoutCanvas() {
  const confirmed = window.confirm(
    "Log out of Canvas?\n\n" +
    "Saved login cookies will be removed from this device. " +
    "Synced course data and parsed graph are kept."
  );
  if (!confirmed) return;

  const button = document.getElementById("canvas-logout-button");
  if (button) {
    button.disabled = true;
    button.textContent = "Logging out…";
  }

  try {
    const result = await window.nucleus.logoutCanvas();
    if (!result || !result.ok) {
      throw new Error(result && result.error ? result.error : "Logout failed.");
    }
    window.alert("Logged out of Canvas.");
  } catch (error) {
    console.error("Unable to log out of Canvas:", error);
    window.alert(error && error.message ? error.message : "Unable to log out of Canvas.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Log out of Canvas";
    }
  }
}

async function syncCanvasData() {
  const confirmed = window.confirm(
    "Download courses, files, and assignments from Canvas now?\n\n" +
    "This runs a full sync in the main process console ([canvas] logs). " +
    "It can take several minutes while the parser runs."
  );
  if (!confirmed) return;

  const button = document.getElementById("sync-canvas-button");
  if (button) {
    button.disabled = true;
    button.textContent = "Syncing…";
  }

  try {
    if (!window.nucleus || typeof window.nucleus.syncCanvasData !== "function") {
      throw new Error("Sync is unavailable in this build.");
    }
    const result = await window.nucleus.syncCanvasData();
    if (!result || !result.ok) {
      throw new Error(result && result.error ? result.error : "Sync failed.");
    }
    if (typeof resetCanvasAppBootstrap === "function") {
      resetCanvasAppBootstrap();
    }
    window.alert(
      "Canvas API download finished. The parser is still running in the background — " +
      "watch the terminal for [canvas] logs until you see \"parser all passes completed\"."
    );
  } catch (error) {
    console.error("Unable to sync Canvas data:", error);
    window.alert(error && error.message ? error.message : "Unable to sync Canvas data.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Sync Canvas now";
    }
  }
}

async function clearCanvasSyncData() {
  const confirmed = window.confirm(
    "Clear all Canvas sync data from disk?\n\n" +
    "This removes course snapshots, downloaded files, parsed graph, and homepage caches. " +
    "Your Canvas login stays saved. Use Settings → Sync Canvas now when you want to download again."
  );
  if (!confirmed) return;

  const button = document.getElementById("clear-canvas-sync-button");
  if (button) {
    button.disabled = true;
    button.textContent = "Clearing…";
  }

  try {
    const result = await window.nucleus.clearCanvasSyncData();
    if (!result || !result.ok) {
      throw new Error(result && result.error ? result.error : "Clear failed.");
    }
    if (typeof resetCanvasAppBootstrap === "function") {
      resetCanvasAppBootstrap();
    }
    const removedCount = Array.isArray(result.removed) ? result.removed.length : 0;
    const taskCount = Number(result.removedTasks) || 0;
    let message =
      `Canvas sync data cleared.${removedCount ? ` Removed ${removedCount} path(s).` : ""}` +
      `${taskCount ? ` Removed ${taskCount} Canvas task(s).` : ""}` +
      "\n\nNothing will re-download until you click Sync Canvas now in Settings.";
    if (Array.isArray(result.lingering) && result.lingering.length) {
      message += `\n\nWarning: these files could not be removed: ${result.lingering.join(", ")}`;
    }
    window.alert(message);
  } catch (error) {
    console.error("Unable to clear Canvas sync data:", error);
    window.alert(error && error.message ? error.message : "Unable to clear Canvas sync data.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Clear Canvas sync data";
    }
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll("#primary-tabs button").forEach(button => {
    button.addEventListener("click", () => setActiveSection(button.dataset.section));
  });
  document.getElementById("workspace-sidebar-toggle").addEventListener("click", toggleWorkspaceSidebar);
  document.getElementById("new-workspace-button").addEventListener("click", showNewWorkspaceForm);

  const openSettingsButton = document.getElementById("open-settings-button");
  if (openSettingsButton) openSettingsButton.addEventListener("click", openSettings);
  const profileCard = document.getElementById("profile-card");
  if (profileCard) profileCard.addEventListener("click", openSettings);
  const closeSettingsButton = document.getElementById("close-settings-button");
  if (closeSettingsButton) closeSettingsButton.addEventListener("click", closeSettings);
  const syncCanvasButton = document.getElementById("sync-canvas-button");
  if (syncCanvasButton) syncCanvasButton.addEventListener("click", syncCanvasData);
  const clearCanvasSyncButton = document.getElementById("clear-canvas-sync-button");
  if (clearCanvasSyncButton) clearCanvasSyncButton.addEventListener("click", clearCanvasSyncData);
  const canvasLogoutButton = document.getElementById("canvas-logout-button");
  if (canvasLogoutButton) canvasLogoutButton.addEventListener("click", logoutCanvas);
  const settingsOverlay = document.getElementById("settings-overlay");
  if (settingsOverlay) {
    settingsOverlay.addEventListener("click", event => {
      if (event.target === settingsOverlay) closeSettings();
    });
  }
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const overlay = document.getElementById("settings-overlay");
    if (overlay && !overlay.classList.contains("is-hidden")) {
      closeSettings();
    }
  });
  document.getElementById("cancel-new-workspace").addEventListener("click", hideNewWorkspaceForm);
  document.getElementById("new-workspace-form").addEventListener("submit", event => {
    event.preventDefault();
    manuallyAddWorkspace();
  });
  document.querySelector(".content").addEventListener("scroll", rememberActiveCanvasYIndex);
  setupAiPanelControls();

  function safeRender(reason) {
    if (typeof render !== "function") {
      console.error("render() is unavailable during startup:", reason);
      return;
    }
    try {
      render();
    } catch (error) {
      console.error("Render failed during startup:", reason, error);
    }
  }

  if (!window.nucleus) {
    console.error("window.nucleus preload bridge is unavailable; UI will remain static.");
    safeRender("missing-preload");
    return;
  }

  safeRender("initial-defaults");

  let tasksUpdateRenderFrame = null;
  window.nucleus.on('tasks:update', updatedTasks => {
    tasks = updatedTasks;
    if (tasksUpdateRenderFrame) return;
    tasksUpdateRenderFrame = requestAnimationFrame(() => {
      tasksUpdateRenderFrame = null;
      safeRender("tasks-update");
    });
  });

  window.nucleus.on('workspaces:update', updatedWorkspaces => {
    workspaces = (updatedWorkspaces && updatedWorkspaces.length)
      ? updatedWorkspaces
      : DEFAULT_WORKSPACES.slice();
    state.tabs = state.tabs.filter(tab => workspaces.some(workspace => workspace.id === tab.workspaceId));
    Object.keys(state.activeTabByWorkspace).forEach(workspaceId => {
      const rememberedTabId = state.activeTabByWorkspace[workspaceId];
      const stillValid = workspaces.some(workspace => workspace.id === workspaceId)
        && state.tabs.some(tab => tab.workspaceId === workspaceId && sameTabId(tab.id, rememberedTabId));
      if (!stillValid) {
        delete state.activeTabByWorkspace[workspaceId];
      }
    });
    ensureWorkspaceCenters();
    syncTabs().catch(error => {
      console.error("Unable to sync tabs after workspace update:", error);
    });
    if (renderafterupdate) {
      state.top = 'workspace';
      state.activeWorkspaceId = pendingworkspaceID;
      state.activeTabId = pendingtabID;
      state.activeTabByWorkspace[pendingworkspaceID] = pendingtabID;
      renderafterupdate = false;
      pendingworkspaceID = null;
      pendingtabID = null;
      queueSyncActiveTab();
    }
    safeRender("workspaces-update");
  });

  window.nucleus.on('canvas:update', data => {
    if (!data) return;
    if (data.canvasWiped) {
      tasks = Array.isArray(data.tasks) ? data.tasks : [];
      workspaces = (data.workspaces && data.workspaces.length)
        ? data.workspaces
        : (workspaces.length ? workspaces : DEFAULT_WORKSPACES.slice());
      projectGroups = Array.isArray(data.projectGroups) ? data.projectGroups : projectGroups;
      canvasData = {};
    } else {
      tasks = mergeSnapshotTasks(data.tasks);
      workspaces = (data.workspaces && data.workspaces.length)
        ? data.workspaces
        : (workspaces.length ? workspaces : DEFAULT_WORKSPACES.slice());
      projectGroups = mergeSnapshotList(data.projectGroups, projectGroups);
      canvasData = mergeSnapshotRecord(data.canvasData, canvasData);
    }
    ensureWorkspaceCenters();
    syncTabs().catch(error => {
      console.error("Unable to sync tabs after canvas update:", error);
    });
    safeRender("canvas-update");
  });

  window.nucleus.on('tabs:url_update', payload => {
    const tab = state.tabs.find(item => sameTabId(item.id, payload.id));
    if (!tab) return;
    tab.url = payload.url;
    if (isWebPageTab(tab) && typeof scheduleRenderWorkspacePageTabs === "function") {
      scheduleRenderWorkspacePageTabs(sameTabId(tab.id, state.activeTabId) ? "full" : "patch");
    } else if (isWebPageTab(tab)) {
      renderWorkspacePageTabs();
    }
    if (sameTabId(tab.id, state.activeTabId)) {
      renderBrowserToolbar();
    }
  });

  window.nucleus.on('tabs:title_update', payload => {
    const tab = state.tabs.find(item => sameTabId(item.id, payload.id));
    if (!tab || !isWebPageTab(tab)) return;
    tab.pageTitle = String(payload.title || "").trim();
    if (typeof scheduleRenderWorkspacePageTabs === "function") {
      scheduleRenderWorkspacePageTabs(sameTabId(tab.id, state.activeTabId) ? "full" : "patch");
    } else {
      renderWorkspacePageTabs();
    }
  });

  window.nucleus.on("tabs:view_state", payload => {
    applyTabViewState(payload);
  });

  window.nucleus.on("tabs:snapshot_overlay", payload => {
    if (!payload || !payload.tabId) return;
    tabSnapshotOverlay = {
      visible: Boolean(payload.visible),
      tabId: payload.tabId,
      snapshotDataUrl: payload.snapshotDataUrl || tabSnapshotOverlay.snapshotDataUrl || ""
    };
    if (payload.snapshotDataUrl) {
      tabSnapshotOverlay.snapshotDataUrl = payload.snapshotDataUrl;
    }
    if (sameTabId(payload.tabId, state.activeTabId)) {
      if (typeof paintActiveView === "function") {
        paintActiveView({ skipTransition: true });
      } else if (typeof renderView === "function") {
        renderView();
      }
    }
  });

  window.nucleus.on('tabs:open_browser_window', payload => {
    if (!payload || !workspaces.some(workspace => workspace.id === payload.workspaceId)) {
      console.error("Unable to open browser tab: workspace not found", payload);
      return;
    }
    openUrlInWorkspaceTab(payload.url, payload.workspaceId, true);
  });
  window.nucleus.on('tabs:open_canvas_window', payload => {
    if (!payload || !workspaces.some(workspace => workspace.id === payload.workspaceId)) {
      console.error("Unable to open Canvas tab: workspace not found", payload);
      return;
    }
    if (!payload.url) {
      openCanvasAppTab(payload.workspaceId, payload.courseId || null);
      return;
    }
    openCanvasBrowserUrl(payload.url, payload.workspaceId, {
      setActive: true,
      courseId: payload.courseId || null
    }).then(result => {
      if (result && result.ok === false && result.reason !== "cancelled" && result.reason !== "busy") {
        showStartTaskError(result.error || "Unable to open Canvas link.");
      }
    });
  });
  window.nucleus.on('tabs:tool_focus_tab', payload => {
    const tab = payload && state.tabs.find(item => sameTabId(item.id, payload.tabId));
    if (!tab) return;
    rememberActiveCanvasYIndex();
    state.top = "workspace";
    state.activeWorkspaceId = tab.workspaceId;
    state.activeTabId = tab.id;
    state.activeTabByWorkspace[tab.workspaceId] = tab.id;
    render();
    queueSyncActiveTab();
  });
  window.nucleus.on('tabs:tool_close_tab', payload => {
    if (!payload || !payload.tabId) return;
    closeTab(payload.tabId);
  });
  window.nucleus.on('engine:open-app-in-tab', async payload => {
    if (!payload || !payload.app) return;
    const sourceTab = payload.tabId
      ? state.tabs.find(item => sameTabId(item.id, payload.tabId))
      : null;
    const workspaceId = payload.workspaceId
      || (sourceTab && sourceTab.workspaceId)
      || getBrowserWorkspaceId();

    if (payload.app === "canvas") {
      const result = await openCanvasAppTab(workspaceId);
      if (result && result.ok === false) return;
    } else if (payload.app === "synapse") {
      await openSynapseAppTab(workspaceId);
    } else if (payload.app === "mail") {
      await openMailAppTab(workspaceId);
    }
  });
  window.nucleus.on("canvas:view-ready", payload => {
    if (payload && payload.id) {
      const tab = state.tabs.find(item => sameTabId(item.id, payload.id));
      if (tab && sameTabId(tab.id, state.activeTabId)) {
        if (window.__nucleusTabSnapshot) {
          window.__nucleusTabSnapshot.clear();
        }
        if (typeof renderBrowserToolbar === "function") {
          renderBrowserToolbar();
        }
        if (typeof renderCanvasToolbar === "function") {
          renderCanvasToolbar();
        }
        if (tab.type === "canvastab" && tab.canvasMode === "browser") {
          if (typeof paintActiveView === "function") {
            paintActiveView({ skipTransition: true, fast: true });
          } else if (typeof renderView === "function") {
            renderView();
          }
        }
      }
    }
  });

  const readyPromise = typeof window.nucleus.notifyRendererReady === "function"
    ? window.nucleus.notifyRendererReady().catch(error => {
      console.error("Unable to notify main process that renderer is ready:", error);
      return { ok: false, taskCount: 0 };
    })
    : Promise.resolve({ taskCount: 0 });
  if (typeof window.nucleus.getCanvasCachePolicy === "function") {
    try {
      canvasCachePolicy = window.nucleus.getCanvasCachePolicy() || canvasCachePolicy;
    } catch (error) {
      console.error("Unable to read Canvas cache policy:", error);
    }
  }
  const dataPromise = typeof window.nucleus.getData === "function"
    ? window.nucleus.getData().catch(error => {
      console.error("Unable to bootstrap renderer data:", error);
      return null;
    })
    : Promise.resolve(null);

  const [ready, data] = await Promise.all([readyPromise, dataPromise]);
  const readyTaskCount = Number(ready && ready.taskCount) || 0;

  await loadWorkspaceSessions();

  try {
    if (data) {
      tasks = Array.isArray(data.tasks) ? data.tasks : [];
      workspaces = (data.workspaces && data.workspaces.length)
        ? data.workspaces
        : DEFAULT_WORKSPACES.slice();
      projectGroups = Array.isArray(data.projectGroups) ? data.projectGroups : projectGroups;
      canvasData = (data.canvasData && Array.isArray(data.canvasData.courses) && data.canvasData.courses.length)
        ? data.canvasData
        : {};
    } else {
      workspaces = DEFAULT_WORKSPACES.slice();
    }
    ensureWorkspaceCenters();
    safeRender("after-get-data");
    syncTabs().catch(error => {
      console.error("Unable to sync tabs on startup:", error);
    });
    queueSyncActiveTab();
  } catch (error) {
    console.error("Unable to apply bootstrap renderer data:", error);
    workspaces = DEFAULT_WORKSPACES.slice();
    safeRender("bootstrap-fallback");
  }

  if (typeof window.nucleus.requestCanvasUpdate === "function") {
    window.nucleus.requestCanvasUpdate().catch(error => {
      console.error("Unable to request Canvas data update:", error);
    });
  }

  if (canvasCachePolicy.diskRecoveryEnabled && !tasks.length) {
    try {
      const pulled = await pullTasksFromMain();
      if (pulled > 0) {
        safeRender("after-pull-tasks");
      }
    } catch (error) {
      console.error("Unable to pull cached tasks on startup:", error);
    }
  }

  if (canvasCachePolicy.diskRecoveryEnabled) {
    void waitForCachedTasks(readyTaskCount || tasks.length);
  }

  try {
    startagent();
  } catch (error) {
    console.error("Unable to start LUMI agent UI:", error);
  }
});
