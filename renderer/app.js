// ─── Data (owned by main process, renderer keeps local copies) ───────────────
let tasks;         // array of task objects
let workspaces;    // array of workspace objects
let projectGroups; // array of project group objects
let canvasData;    // parsed canvas_data.json snapshot
let nucleusCanvasCSS;

// ─── UI State (owned by renderer) ────────────────────────────────────────────
let state = {
  activeSection: "projects",     // which top section is active: "projects" | "tasks" | "calendar"
  activeWorkspaceId: "nucleus",  // which workspace tab is selected
  activeTabId: null,             // which page tab is active within the workspace
  activeCourseId: null,
  activeTabByWorkspace: {},
  tabs: [
    { id: "center:nucleus", type: "center", workspaceId: "nucleus", label: "Project Center" }
  ],
  top: 'section'                 // whether the user is in a top section or a workspace: "section" | "workspace"
}
//------DEV FUNCTIONS

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
  let currentResponse = null;

  window.nucleus.on('prompt:response-chunk', (chunk) => {
    if (!currentResponse) {
      currentResponse = document.createElement("div");
      currentResponse.classList.add("ai-message", "response");
      messages.appendChild(currentResponse);
    }
    currentResponse.innerText += chunk;
    messages.scrollTop = messages.scrollHeight;
  });

  function submitPrompt() {
    if (input.value.trim() === "") return;

    currentResponse = null;

    const message = document.createElement("div");
    message.classList.add("ai-message");
    message.innerText = input.value;
    messages.appendChild(message);

    window.nucleus.sendprompt(input.value);
    input.value = "";
    messages.scrollTop = messages.scrollHeight;
  }

  window.sendMessage = submitPrompt;

  input.addEventListener("keypress", event => {
    if (event.key !== "Enter") return;
    submitPrompt();
  });
}


// ─── Startup ──────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll("#primary-tabs button").forEach(button => {
    button.addEventListener("click", () => setActiveSection(button.dataset.section));
  });
  document.getElementById("new-workspace-button").addEventListener("click", showNewWorkspaceForm);
  document.getElementById("cancel-new-workspace").addEventListener("click", hideNewWorkspaceForm);
  document.getElementById("new-workspace-form").addEventListener("submit", event => {
    event.preventDefault();
    manuallyAddWorkspace();
  });
  document.querySelector(".content").addEventListener("scroll", rememberActiveCanvasYIndex);

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
    if (!payload || payload.app !== "canvas" || !payload.tabId) return;
    openCanvasAppInExistingTab(payload.tabId);
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
