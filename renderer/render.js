// Renderer application controller.
// Functionality: owns browser-side UI state, bootstraps data from preload IPC,
// handles user actions, starts tasks, and listens for main-process updates.
// Dependencies: preload.js window.nucleus bridge, renderer/workspace-page-tabs.js
// tab mutators, renderer/render.js render functions, and taskoptimizer.js.
// ─── Data (owned by main process, renderer keeps local copies) ───────────────
let tasks;         // array of task objects
let workspaces;    // array of workspace objects
let projectGroups; // array of project group objects
let canvasData;    // parsed canvas_data.json snapshot
let nucleusCanvasCSS;

// ─── UI State (owned by renderer) ────────────────────────────────────────────
let state = {
  activeSection: "home",         // which top section is active: "home" | "tasks" | "calendar"
  activeWorkspaceId: "nucleus",  // which workspace tab is selected
  activeTabId: null,             // which page tab is active within the workspace
  activeCourseId: null,
  activeTabByWorkspace: {},
  workspaceSidebarCollapsed: false,
  aiPanelWidth: 340,
  aiPanelMinimized: false,
  currentCanvasPageContext: null,
  tabs: [
    { id: "center:nucleus", type: "center", workspaceId: "nucleus", label: "Project Center" }
  ],
  top: 'section'                 // whether the user is in a top section or a workspace: "section" | "workspace"
}
//------DEV FUNCTIONS

const AI_PANEL_MIN_WIDTH = 340;
const AI_PANEL_DEFAULT_WIDTH = 340;
const AI_PANEL_MAX_WIDTH = 680;

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
  return workspaces.find(workspace => workspace.id === workspaceId) || workspaces[0];
}

function getWorkspaceTasks(workspaceId) {
  return tasks.filter(task => task.workspaceId === workspaceId);
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function getProjectGroups() {
  return Array.isArray(projectGroups) ? projectGroups : [];
}

function getBrowserWorkspaceId() {
  if (workspaces.some(workspace => workspace.id === state.activeWorkspaceId)) {
    return state.activeWorkspaceId;
  }
  return workspaces[0] ? workspaces[0].id : "nucleus";
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
// and paints native apps / home into #view. These push that state + on-screen text
// into the main-process reactive context store so the sidekick snapshot is complete.

// Returns the surface kind for the renderer-painted (#view) surface, or null when
// the active surface is a WebContentsView (web / Canvas browser) the main process
// scrapes directly and therefore owns.
function getRendererSurfaceKind() {
  if (state.top !== "workspace") {
    return `section-${state.activeSection || "home"}`;
  }
  const tab = Array.isArray(state.tabs)
    ? state.tabs.find(item => sameTabId(item.id, state.activeTabId))
    : null;
  if (!tab) return "project-center";
  if (tab.type === "center") return "project-center";
  if (tab.type === "task") return "task";
  if (tab.type === "canvastab" && tab.canvasMode !== "browser") return "canvas-native";
  if (tab.type === "synapsetab") return "synapse";
  if (tab.type === "mailtab") return "mail";
  // browsertab and Canvas browser tabs are WebContentsView surfaces (main owns).
  return null;
}

function extractRendererVisibleText(maxBlocks = 24, maxChars = 2600) {
  const view = document.getElementById("view");
  const content = document.querySelector(".content");
  if (!view || !content) return null;
  const contentRect = content.getBoundingClientRect();
  const selectors = "h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,pre,code,td,th,caption,figcaption,label,button,a,span,div";
  const nodes = Array.from(view.querySelectorAll(selectors));
  const seen = new Set();
  const blocks = [];
  let chars = 0;
  for (const node of nodes) {
    if (!node || typeof node.getBoundingClientRect !== "function") continue;
    const rect = node.getBoundingClientRect();
    if (!rect || rect.width < 6 || rect.height < 6) continue;
    const intersects = rect.bottom > contentRect.top
      && rect.top < contentRect.bottom
      && rect.right > contentRect.left
      && rect.left < contentRect.right;
    if (!intersects) continue;
    const style = window.getComputedStyle(node);
    if (!style || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    let text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) continue;
    if (text.length > 280) text = text.slice(0, 280).trim();
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const remaining = Math.max(maxChars - chars, 0);
    if (!remaining) break;
    if (text.length > remaining) text = text.slice(0, remaining).trim();
    if (!text) break;
    blocks.push({
      tag: String(node.tagName || "").toLowerCase(),
      text,
      y: Math.round(content.scrollTop + (rect.top - contentRect.top)),
      x: Math.round(rect.left - contentRect.left)
    });
    chars += text.length;
    if (blocks.length >= maxBlocks) break;
  }
  blocks.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return {
    scroll: {
      y: Math.round(content.scrollTop),
      viewportHeight: Math.round(content.clientHeight),
      contentHeight: Math.round(content.scrollHeight)
    },
    blocks
  };
}

function syncContextUiState() {
  if (!window.nucleus || typeof window.nucleus.pushUiState !== "function") return;
  try {
    window.nucleus.pushUiState({
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
            canvasMode: tab.canvasMode
          }))
        : []
    });
  } catch (error) {
    console.error("Unable to push UI state context:", error);
  }
}

function syncContextScreenText() {
  if (!window.nucleus || typeof window.nucleus.pushScreenText !== "function") return;
  const kind = getRendererSurfaceKind();
  if (!kind) return; // WebContentsView surface; main process owns the screen slice.
  const extracted = extractRendererVisibleText();
  if (!extracted) return;
  try {
    window.nucleus.pushScreenText({
      kind,
      url: "",
      title: document.title || "",
      scroll: extracted.scroll,
      blocks: extracted.blocks
    });
  } catch (error) {
    console.error("Unable to push screen-text context:", error);
  }
}

// Called from the global render() funnel (app.js) so any app-state change refreshes
// the relevant context slices.
function syncRenderContext() {
  syncContextUiState();
  syncContextScreenText();
}

let screenTextScrollScheduled = false;
function scheduleRendererScreenTextSync() {
  if (screenTextScrollScheduled) return;
  screenTextScrollScheduled = true;
  requestAnimationFrame(() => {
    screenTextScrollScheduled = false;
    syncContextScreenText();
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function setActiveSection(section) {
  rememberActiveWorkspaceTab();
  state.activeSection = section;
  state.activeTabId = null;
  state.activeCourseId = null;
  state.top = 'section';
  syncActiveTab();
  render();
}

function setActiveWorkspace(workspaceId) {
  rememberActiveWorkspaceTab();
  state.top = 'workspace';
  state.activeCourseId = null;
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = getRememberedWorkspaceTabId(workspaceId);
  syncTabs();
  syncActiveTab();
  render();
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
  syncTabs();
  syncActiveTab();
  render();
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
  const sendButton = document.querySelector(".ai-send-button");
  const attachButton = document.getElementById("ai-attach-button");
  const fileInput = document.getElementById("ai-file-input");
  const attachmentsContainer = document.getElementById("ai-attachments");
  let currentResponse = null;
  let sidekickResponseInFlight = false;
  let pendingAttachments = [];
  let pendingRegionContext = null;
  let pendingRegionAttachmentId = null;
  const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

  function setSidekickInFlight(value) {
    sidekickResponseInFlight = value;
    input.disabled = value;
    if (sendButton) {
      sendButton.disabled = value;
    }
    if (attachButton) {
      attachButton.disabled = value;
    }
  }

  window.nucleus.on('prompt:response-chunk', (chunk) => {
    if (!currentResponse) {
      currentResponse = document.createElement("div");
      currentResponse.classList.add("ai-message", "response");
      messages.appendChild(currentResponse);
    }
    currentResponse.innerText += chunk;
    messages.scrollTop = messages.scrollHeight;
  });

  window.nucleus.on('prompt:response-done', () => {
    currentResponse = null;
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

  function regionVisibleTextLines(result) {
    const blocks = result && Array.isArray(result.visibleText) ? result.visibleText : [];
    if (!blocks.length) return [];
    const lines = ["Visible text in region:"];
    blocks.slice(0, 20).forEach((block, index) => {
      lines.push(`${index + 1}. [${block.tag || "text"}] ${block.text}`);
    });
    return lines;
  }

  function applyRegionCaptureResult(result, activeTab) {
    if (result.mode === "indexed" && result.indexedContext) {
      const context = result.indexedContext;
      const pageLabel = Array.isArray(context.pages) && context.pages.length
        ? context.pages.map(page => page.pageNumber || page.pageid || "").filter(Boolean).join(", ")
        : "none";
      const contextText = [
        "Selected screen region context (indexed):",
        `URL: ${result.url || activeTab.url || ""}`,
        `Region (app px): x=${result.region && result.region.x}, y=${result.region && result.region.y}, w=${result.region && result.region.width}, h=${result.region && result.region.height}`,
        `Pages: ${pageLabel}`,
        `Concepts: ${Array.isArray(context.concepts) ? context.concepts.map(item => item.name).filter(Boolean).join("; ") : ""}`,
        `Details: ${Array.isArray(context.details) ? context.details.map(item => item.name).filter(Boolean).join("; ") : ""}`,
        `Examples: ${Array.isArray(context.examples) ? context.examples.map(item => item.name).filter(Boolean).join("; ") : ""}`,
        `Problems: ${Array.isArray(context.problems) ? context.problems.map(item => item.name).filter(Boolean).join("; ") : ""}`,
        ...regionVisibleTextLines(result)
      ].join("\n");
      upsertRegionAttachment({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: `Screen context${pageLabel && pageLabel !== "none" ? ` · pages ${pageLabel}` : ""}`,
        type: "application/x-nucleus-region-context",
        size: 0,
        kind: "metadata",
        note: "Indexed context capture",
        source: "region"
      }, contextText);
    } else if (result.mode === "screenshot" && result.image && result.image.data) {
      const contextText = [
        "Selected screen region context:",
        `URL: ${result.url || activeTab.url || ""}`,
        `Region (app px): x=${result.region && result.region.x}, y=${result.region && result.region.y}, w=${result.region && result.region.width}, h=${result.region && result.region.height}`,
        "Indexed context unavailable; attached screenshot instead.",
        ...regionVisibleTextLines(result)
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
    } else {
      const contextText = [
        "Selected screen region context:",
        `URL: ${result.url || activeTab.url || ""}`,
        `Region (app px): x=${result.region && result.region.x}, y=${result.region && result.region.y}, w=${result.region && result.region.width}, h=${result.region && result.region.height}`,
        ...regionVisibleTextLines(result)
      ].join("\n");
      upsertRegionAttachment({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: "Screen context",
        type: "application/x-nucleus-region-context",
        size: 0,
        kind: "metadata",
        note: "Context capture",
        source: "region"
      }, contextText);
    }
    const systemMessage = document.createElement("div");
    systemMessage.classList.add("ai-message", "system");
    systemMessage.innerText = result.mode === "indexed"
      ? "Captured indexed context and added it to input as a removable object."
      : "Captured selected region and added it to input as a removable object.";
    messages.appendChild(systemMessage);
    messages.scrollTop = messages.scrollHeight;
  }

  async function captureRegionFromShortcut(payload = {}) {
    // TODO(remove): temporary region-capture shortcut diagnostics
    console.log('[DEBUG][TODO_REMOVE] region_capture', {
      stage: 'renderer_shortcut_received',
      payloadTabId: payload && payload.tabId ? payload.tabId : '',
      activeTabId: state && state.activeTabId ? state.activeTabId : ''
    })
    if (!window.nucleus || typeof window.nucleus.captureRegionShortcut !== "function") {
      console.log('[DEBUG][TODO_REMOVE] region_capture', { stage: 'renderer_missing_ipc_bridge' })
      return;
    }
    const activeTab = payload && payload.tabId
      ? (Array.isArray(state.tabs) ? state.tabs.find(item => sameTabId(item.id, payload.tabId)) : null)
      : getActiveWebLikeTab();
    if (!activeTab) {
      console.log('[DEBUG][TODO_REMOVE] region_capture', { stage: 'renderer_no_active_web_tab' })
      const systemMessage = document.createElement("div");
      systemMessage.classList.add("ai-message", "system");
      systemMessage.innerText = "Region capture needs an active browser or Canvas web tab.";
      messages.appendChild(systemMessage);
      messages.scrollTop = messages.scrollHeight;
      return;
    }
    console.log('[DEBUG][TODO_REMOVE] region_capture', {
      stage: 'renderer_capture_start',
      tabId: activeTab.id,
      tabType: activeTab.type,
      url: activeTab.url || ''
    })
    try {
      const result = await window.nucleus.captureRegionShortcut({ tabId: activeTab.id });
      console.log('[DEBUG][TODO_REMOVE] region_capture', {
        stage: 'renderer_capture_finished',
        tabId: activeTab.id,
        ok: Boolean(result && result.ok),
        mode: result && result.mode ? result.mode : '',
        cancelled: Boolean(result && result.cancelled),
        error: result && result.error ? result.error : ''
      })
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
      console.log('[DEBUG][TODO_REMOVE] region_capture', { stage: 'renderer_ipc_event_received', payload })
      captureRegionFromShortcut(payload || {});
    });
    window.nucleus.on("shortcut:region_capture_failed", (payload) => {
      console.log('[DEBUG][TODO_REMOVE] region_capture', { stage: 'renderer_ipc_event_failed', payload })
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

    currentResponse = null;

    const attachmentsToSend = pendingAttachments.slice();
    const message = document.createElement("div");
    message.classList.add("ai-message");
    message.innerText = promptText || "Sent attachments";
    renderUserAttachmentSummary(message, attachmentsToSend);
    messages.appendChild(message);

    setSidekickInFlight(true);
    window.nucleus.sendprompt({
      text: promptText,
      attachments: attachmentsToSend,
      systemContext: "",
      regionContext: pendingRegionContext || ""
    });
    input.value = "";
    pendingAttachments = [];
    pendingRegionContext = null;
    pendingRegionAttachmentId = null;
    renderPendingAttachments();
    messages.scrollTop = messages.scrollHeight;
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
  requestAnimationFrame(() => previous.forEach(link => link.remove()));
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

function openSettings() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;
  overlay.classList.remove("is-hidden");
  renderThemeOptions();
}

function closeSettings() {
  const overlay = document.getElementById("settings-overlay");
  if (!overlay) return;
  overlay.classList.add("is-hidden");
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
  const settingsOverlay = document.getElementById("settings-overlay");
  if (settingsOverlay) {
    settingsOverlay.addEventListener("click", event => {
      if (event.target === settingsOverlay) closeSettings();
    });
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeSettings();
  });
  document.getElementById("cancel-new-workspace").addEventListener("click", hideNewWorkspaceForm);
  document.getElementById("new-workspace-form").addEventListener("submit", event => {
    event.preventDefault();
    manuallyAddWorkspace();
  });
  document.querySelector(".content").addEventListener("scroll", rememberActiveCanvasYIndex);
  // Refresh on-screen text for renderer-painted (native app / home) surfaces on
  // every y-scroll, mirroring the WebContentsView scroll-driven refresh.
  document.querySelector(".content").addEventListener("scroll", scheduleRendererScreenTextSync);
  setupAiPanelControls();

  const data = await window.nucleus.getData();
  tasks = data.tasks || [];
  workspaces = data.workspaces || [];
  projectGroups = data.projectGroups || [];
  canvasData = data.canvasData || {};
  ensureWorkspaceCenters();
  syncTabs();

  startagent();

  window.nucleus.on('tasks:update', updatedTasks => {
    tasks = updatedTasks;
    render();
  });

  window.nucleus.on('workspaces:update', updatedWorkspaces => {
    workspaces = updatedWorkspaces;
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
    syncTabs();
    if (renderafterupdate) {
      state.top = 'workspace';
      state.activeWorkspaceId = pendingworkspaceID;
      state.activeTabId = pendingtabID;
      state.activeTabByWorkspace[pendingworkspaceID] = pendingtabID;
      renderafterupdate = false;
      pendingworkspaceID = null;
      pendingtabID = null;
      syncActiveTab();
    }
    render();
  });

  window.nucleus.on('canvas:update', data => {
    if (!data) return;
    tasks = data.tasks || tasks || [];
    workspaces = data.workspaces || workspaces || [];
    projectGroups = data.projectGroups || projectGroups || [];
    canvasData = data.canvasData || {};
    ensureWorkspaceCenters();
    syncTabs();
    render();
  });

  nucleusCanvasCSS = await window.nucleus.getinjection()


  window.nucleus.on('tabs:url_update', payload => {
    const tab = state.tabs.find(item => sameTabId(item.id, payload.id));
    if (!tab) return;
    tab.url = payload.url;
    if (isWebPageTab(tab)) {
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
    renderWorkspacePageTabs();
  });

  window.nucleus.on('canvas:visible_context', payload => {
    state.currentCanvasPageContext = payload || null;
    window.currentCanvasPageContext = state.currentCanvasPageContext;
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
    newCanvasTab(payload.url, payload.workspaceId, true, getCanvasInjectionConfig()).then(result => {
      if (result && result.ok === false) {
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
    syncActiveTab();
    render();
  });
  window.nucleus.on('tabs:tool_close_tab', payload => {
    if (!payload || !payload.tabId) return;
    closeTab(payload.tabId);
  });
  window.nucleus.on('engine:open-app-in-tab', payload => {
    if (!payload || !payload.tabId) return;
    if (payload.app === "canvas") {
      openCanvasAppInExistingTab(payload.tabId);
    } else if (payload.app === "synapse") {
      openSynapseAppInExistingTab(payload.tabId);
    } else if (payload.app === "mail") {
      openMailAppInExistingTab(payload.tabId);
    }
  });
  window.nucleus.on("canvas:view-ready", payload => {
    if (payload && payload.id) {
      const tab = state.tabs.find(item => sameTabId(item.id, payload.id));
      if (tab) {
        tab.loading = false;
      }
    }
  });

  render();
});
