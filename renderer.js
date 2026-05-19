// ─── Data (owned by main process, renderer keeps local copies) ───────────────
let tasks;         // array of task objects
let workspaces;    // array of workspace objects
let projectGroups; // array of project group objects

// ─── UI State (owned by renderer) ────────────────────────────────────────────
let state = {
  activeSection: "projects",     // which top section is active: "projects" | "tasks" | "workspace"
  activeWorkspaceId: "nucleus",  // which workspace tab is selected
  activeTabId: null,             // which page tab is active within the workspace
  tabs: [
    { id: "center:nucleus", type: "center", workspaceId: "nucleus", label: "Project Center" }
  ],
  top: 'section'                 // whether the user is in a top section or a workspace: "section" | "workspace"
}


// ─── Data Helpers ─────────────────────────────────────────────────────────────

// finds a workspace by id, falls back to the first workspace if not found
function getWorkspace(workspaceId) {
  return workspaces.find(workspace => workspace.id === workspaceId) || workspaces[0];
}

// returns all tasks that belong to a specific workspace
function getWorkspaceTasks(workspaceId) {
  return tasks.filter(task => task.workspaceId === workspaceId);
}

// returns a greeting string based on the current hour
function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}


// ─── Tab Helpers ──────────────────────────────────────────────────────────────

// ensures a "Project Center" tab exists for a workspace, creates it if not
// returns the tab id
function ensureWorkspaceCenter(workspaceId) {
  const tabId = `center:${workspaceId}`;

  // only add the tab if it doesn't already exist
  if (!state.tabs.some(tab => tab.id === tabId)) {
    state.tabs.push({
      id: tabId,
      type: "center",
      workspaceId,
      label: "Project Center"
    });
  }
  return tabId;
}

// returns only the tabs that belong to the currently active workspace
function getVisibleTabs() {
  return state.tabs.filter(tab => tab.workspaceId === state.activeWorkspaceId);
}


// ─── Navigation ───────────────────────────────────────────────────────────────

// switches to a top level section (projects or tasks)
// clears the active tab since we're leaving the workspace view
function setActiveSection(section) {
  state.activeSection = section;
  state.activeTabId = null;
  render();
}

// switches to a workspace, ensuring its center tab exists and is active
function setActiveWorkspace(workspaceId) {
  state.activeSection = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = ensureWorkspaceCenter(workspaceId);
  render();
}


// ─── Task Actions ─────────────────────────────────────────────────────────────

// starts a task — tells main process, opens a tab for it, navigates to it
async function startTask(taskId) {
  // find the task object by id, bail if it doesn't exist
  const task = tasks.find(item => item.id === taskId);
  if (!task) return;

  // tell main process the task is starting
  try {
    await window.nucleus.startTask(task);
  } catch (error) {
    console.error("Unable to start task:", error);
    return;
  }

  // open a new tab for this task if one isn't already open
  const tabId = `task:${task.id}`;
  if (!state.tabs.some(tab => tab.id === tabId)) {
    state.tabs.push({
      id: tabId,
      type: "task",
      workspaceId: task.workspaceId,
      taskId: task.id,
      label: task.title
    });
  }

  // navigate to the workspace and the new task tab
  state.activeSection = "workspace";
  state.activeWorkspaceId = task.workspaceId;
  state.activeTabId = tabId;
  render();
}

// closes a tab, navigating to an adjacent tab if the closed one was active
function closeTab(tabId) {
  // find the tab and bail if it doesn't exist or is a center tab (not closeable)
  const tab = state.tabs.find(item => item.id === tabId);
  if (!tab || tab.type === "center") return;

  // remember the position of the tab before removing it
  const visibleTabs = getVisibleTabs();
  const index = visibleTabs.findIndex(item => item.id === tabId);

  // remove the tab from state
  state.tabs = state.tabs.filter(item => item.id !== tabId);

  // if the closed tab was active, navigate to the next best tab
  if (state.activeTabId === tabId) {
    const nextTab = visibleTabs[index] || visibleTabs[index - 1];
    state.activeTabId = nextTab && nextTab.id !== tabId
      ? nextTab.id
      : ensureWorkspaceCenter(state.activeWorkspaceId);
  }

  render();
}


// ─── Render Functions ─────────────────────────────────────────────────────────

// syncs the active class on the three primary top tabs (Projects, Tasks, Workspace)
function renderPrimaryTabs() {
  document.querySelectorAll("#primary-tabs button").forEach(button => {
    button.classList.toggle("active", button.dataset.section === state.activeSection);
  });
}

// rebuilds the workspace tab strip (Biology, CS, Writing, etc.)
function renderWorkspaceTabs() {
  const workspaceTabs = document.getElementById("workspace-tabs");

  workspaceTabs.innerHTML = workspaces.map(workspace => `
    <button type="button" class="${workspace.id === state.activeWorkspaceId ? "active" : ""}" data-workspace="${workspace.id}">
      <span>${workspace.name}</span>
      <small>${getWorkspaceTasks(workspace.id).length} tasks</small>
    </button>
  `).join("");

  workspaceTabs.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => setActiveWorkspace(button.dataset.workspace));
  });
}

// rebuilds the page tab strip within a workspace (Project Center, open task tabs)
function renderWorkspacePageTabs() {
  const pageTabs = document.getElementById("workspace-page-tabs");
  const visibleTabs = getVisibleTabs();

  // hide the tab strip entirely when not in a workspace
  pageTabs.classList.toggle("is-hidden", state.top !== "workspace");

  pageTabs.innerHTML = state.activeSection === "workspace" ? visibleTabs.map(tab => `
    <button type="button" class="workspace-page-tab ${tab.id === state.activeTabId ? "active" : ""}" data-tab-id="${tab.id}">
      <span>${tab.label}</span>
      ${tab.type !== "center" ? `<span class="close-tab" data-close-tab="${tab.id}">x</span>` : ""}
    </button>
  `).join("") : "";

  pageTabs.querySelectorAll(".workspace-page-tab").forEach(tabButton => {
    tabButton.addEventListener("click", event => {
      const closeTarget = event.target.closest("[data-close-tab]");
      if (closeTarget) {
        closeTab(closeTarget.dataset.closeTab);
        return;
      }

      state.activeTabId = tabButton.dataset.tabId;
      render();
    });
  });
}

// builds the HTML for a single task card
function renderTaskCard(task) {
  return `
    <article class="task-card" data-id="${task.id}">
      <div class="task-header">
        <span class="task-course" style="background:${task.color}">${task.course}</span>
        <span class="task-due">Due ${task.due}</span>
      </div>
      <h2>${task.title}</h2>
      <p>${task.details}</p>
      <div class="task-footer">
        <span>${task.estimate}</span>
        <button type="button" class="start-task-button" data-start-task="${task.id}">Start task</button>
      </div>
    </article>
  `;
}

// builds the HTML for the Projects dashboard
function renderProjectsDashboard() {
  return `
    <header>
      <h1>Projects</h1>
      <p>${getGreeting()}. Classes and personal projects in one place.</p>
    </header>

    ${projectGroups.map(group => `
      <section class="project-section">
        <div class="section-heading">
          <h2>${group.label}</h2>
          <span>${group.items.length}</span>
        </div>
        <div class="project-grid">
          ${group.items.map(project => `
            <article class="project-card">
              <span class="project-chip" style="background:${project.color}">${project.meta}</span>
              <h3>${project.name}</h3>
              <p>${project.details}</p>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("")}
  `;
}

// builds the HTML for the Tasks page
function renderSuggestedTasks() {
  return `
    <header>
      <h1>Tasks</h1>
      <p>All suggested tasks across classes, projects, and workspaces.</p>
    </header>
    <section>
      <div class="task-grid">
        ${tasks.map(renderTaskCard).join("")}
      </div>
    </section>
  `;
}

// builds the HTML for a workspace's Project Center
function renderProjectCenter(workspace) {
  return `
    <header>
      <h1>${workspace.name} Project Center</h1>
      <p>${workspace.description}</p>
    </header>

    <section class="workspace-panel">
      <div>
        <h2>Project Center</h2>
        <p>Workspace tabs appear above this page. Use the Tasks top tab to start suggested work items.</p>
      </div>
      <div class="workspace-actions">
        <button type="button" class="start-task-button" data-open-section="tasks">View tasks</button>
      </div>
    </section>
  `;
}

// builds the HTML for an open task workspace tab
function renderTaskWorkspace(tab) {
  const task = tasks.find(item => item.id === tab.taskId);
  if (!task) return renderProjectCenter(getWorkspace(state.activeWorkspaceId));

  return `
    <header>
      <h1>${task.title}</h1>
      <p>${task.course} / Due ${task.due} / ${task.estimate}</p>
    </header>

    <section class="workspace-panel">
      <div>
        <h2>Workspace</h2>
        <p>${task.details}</p>
      </div>
      <button type="button" class="start-task-button">Begin work</button>
    </section>
  `;
}

// decides what to show in the main content area and renders it
function renderView() {
  const activeTab = state.activeSection === "workspace"
    ? state.tabs.find(tab => tab.id === state.activeTabId) || {
        id: ensureWorkspaceCenter(state.activeWorkspaceId),
        type: "center",
        workspaceId: state.activeWorkspaceId
      }
    : null;

  const view = document.getElementById("view");

  if (state.activeSection === "projects") {
    view.innerHTML = renderProjectsDashboard();
  } else if (state.activeSection === "tasks") {
    view.innerHTML = renderSuggestedTasks();
  } else if (activeTab.type === "task") {
    view.innerHTML = renderTaskWorkspace(activeTab);
  } else {
    view.innerHTML = renderProjectCenter(getWorkspace(state.activeWorkspaceId));
  }

  view.querySelectorAll("[data-start-task]").forEach(button => {
    button.addEventListener("click", () => startTask(button.dataset.startTask));
  });

  view.querySelectorAll("[data-open-section]").forEach(button => {
    button.addEventListener("click", () => setActiveSection(button.dataset.openSection));
  });
}

// master render function — rebuilds all four regions of the UI
function render() {
  renderPrimaryTabs();
  renderWorkspaceTabs();
  renderWorkspacePageTabs();
  renderView();
}


// ─── AI Agent ─────────────────────────────────────────────────────────────────

function startagent() {
  const input = document.getElementById("ai-input");
  const messages = document.getElementById("ai-messages");
  let currentResponse = null;

  // listen for streaming chunks from Claude
  window.nucleus.on('prompt:response-chunk', (chunk) => {
    // create response div on first chunk
    if (!currentResponse) {
      currentResponse = document.createElement("div");
      currentResponse.classList.add("ai-message", "response");
      messages.appendChild(currentResponse);
    }
    currentResponse.innerText += chunk;
    messages.scrollTop = messages.scrollHeight;
  });

  input.addEventListener("keypress", event => {
    if (event.key !== "Enter") return;
    if (input.value.trim() === "") return;

    // reset response div for new message
    currentResponse = null;

    // add user message to chat
    const message = document.createElement("div");
    message.classList.add("ai-message");
    message.innerText = input.value;
    messages.appendChild(message);

    window.nucleus.sendprompt(input.value);
    input.value = "";
    messages.scrollTop = messages.scrollHeight;
  });
}


// ─── Startup ──────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // attach click listeners to the primary top tabs
  document.querySelectorAll("#primary-tabs button").forEach(button => {
    button.addEventListener("click", () => setActiveSection(button.dataset.section));
  });

  // fetch initial data from main process
  const data = await window.nucleus.getData();
  tasks = data.tasks || [];
  workspaces = data.workspaces || [];
  projectGroups = data.projectGroups || [];

  // start the AI agent
  startagent();

  // listen for main process pushing updated data down
  window.nucleus.on('tasks:update', updatedTasks => {
    tasks = updatedTasks;
    render();
  });

  window.nucleus.on('workspaces:update', updatedWorkspaces => {
    workspaces = updatedWorkspaces;
    render();
  });

  // initial render
  render();
});