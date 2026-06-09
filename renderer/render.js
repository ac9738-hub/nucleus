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
  if (!task) return;

  const taskUrls = Array.isArray(task.urls) ? task.urls.filter(Boolean) : [];
  if (taskUrls.length) {
    const workspaceId = await ensureTaskWorkspace(task);
    if (!workspaceId) return;
    for (let index = 0; index < taskUrls.length; index += 1) {
      await openUrlInWorkspaceTab(taskUrls[index], workspaceId, index === 0);
    }
    await syncTabs();
    await syncActiveTab();
    render();
    return;
  }

  const workspaceId = await ensureTaskWorkspace(task);
  if (!workspaceId) return;

  if (task.source === "canvas" && task.courseId) {
    await openCanvasAppTab(workspaceId, task.courseId);
    return;
  }

  renderafterupdate = true;
  pendingworkspaceID = workspaceId;
  pendingtabID = ensureWorkspaceCenter(workspaceId);

  try {
    await window.nucleus.startTask(task);
  } catch (error) {
    console.error("Unable to start task:", error);
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
        pendingAttachments = pendingAttachments.filter(item => item.id !== button.dataset.attachmentId);
        renderPendingAttachments();
      });
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
      attachments: attachmentsToSend
    });
    input.value = "";
    pendingAttachments = [];
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


// ─── Startup ──────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll("#primary-tabs button").forEach(button => {
    button.addEventListener("click", () => setActiveSection(button.dataset.section));
  });
  document.getElementById("workspace-sidebar-toggle").addEventListener("click", toggleWorkspaceSidebar);
  document.getElementById("new-workspace-button").addEventListener("click", showNewWorkspaceForm);
  document.getElementById("cancel-new-workspace").addEventListener("click", hideNewWorkspaceForm);
  document.getElementById("new-workspace-form").addEventListener("submit", event => {
    event.preventDefault();
    manuallyAddWorkspace();
  });
  document.querySelector(".content").addEventListener("scroll", rememberActiveCanvasYIndex);
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
    if (sameTabId(tab.id, state.activeTabId)) {
      renderBrowserToolbar();
    }
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
    newCanvasTab(payload.url, payload.workspaceId, true, getCanvasInjectionConfig());
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
    }
  });
  window.nucleus.on("canvas:navigation", () => {
    handlecanvaspagechange();
  });
  window.nucleus.on("canvas:blank", () => {
    showCanvasBlankSlate();
  });
  window.nucleus.on("canvas:view-ready", payload => {
    if (payload && payload.id) {
      const tab = state.tabs.find(item => sameTabId(item.id, payload.id));
      if (tab) {
        tab.loading = false;
      }
    }
    hideCanvasBlankSlate();
  });

  render();
});
