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


// ─── Data Helpers ─────────────────────────────────────────────────────────────

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


// ─── Tab Helpers ──────────────────────────────────────────────────────────────

function ensureWorkspaceCenter(workspaceId) {
  const tabId = `center:${workspaceId}`;
  if (!state.tabs.some(tab => sameTabId(tab.id, tabId))) {
    state.tabs.push({
      id: tabId,
      type: "center",
      workspaceId,
      label: "Project Center"
    });
  }
  return tabId;
}

function sameTabId(left, right) {
  return String(left) === String(right);
}

function ensureWorkspaceCenters() {
  workspaces.forEach(workspace => ensureWorkspaceCenter(workspace.id));
}

async function syncTabs() {
  await window.nucleus.tabschanged(state.tabs);
}

function getActiveTab() {
  return state.tabs.find(tab => sameTabId(tab.id, state.activeTabId)) || null;
}

function isWebContentTab(tab) {
  return tab && (tab.type === "browsertab" || tab.type === "canvastab");
}

function isBrowserToolbarTab(tab) {
  return tab && tab.type === "browsertab";
}

function getActiveWebContentTab() {
  const activeTab = getActiveTab();
  if (state.top === "workspace" && isWebContentTab(activeTab)) {
    return activeTab;
  }
  return null;
}

function getActiveBrowserTab() {
  const activeTab = getActiveTab();
  if (state.top === "workspace" && isBrowserToolbarTab(activeTab)) {
    return activeTab;
  }
  return null;
}

function getActiveCanvasTab() {
  const activeTab = getActiveTab();
  if (state.top === "workspace" && activeTab && activeTab.type === "canvastab") {
    return activeTab;
  }
  return null;
}

function syncActiveTab() {
  const activeTab = getActiveTab();
  if (state.top === "workspace" && isWebContentTab(activeTab)) {
    return window.nucleus.newactivetab(activeTab);
  }
  return window.nucleus.newactivetab("None");
}

function rememberActiveWorkspaceTab() {
  if (state.top !== "workspace" || !state.activeWorkspaceId || !state.activeTabId) return;
  state.activeTabByWorkspace[state.activeWorkspaceId] = state.activeTabId;
}

function getRememberedWorkspaceTabId(workspaceId) {
  const rememberedTabId = state.activeTabByWorkspace[workspaceId];
  if (rememberedTabId && state.tabs.some(tab => tab.workspaceId === workspaceId && sameTabId(tab.id, rememberedTabId))) {
    return rememberedTabId;
  }
  return ensureWorkspaceCenter(workspaceId);
}

async function newWebContentTab(url, workspaceId, setactive = false, injection = null, type = "browsertab") {
  const prefix = type === "canvastab" ? "canvas" : "browser";
  const newtab = {
    id: `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    type,
    workspaceId,
    label: type === "canvastab" ? "Canvas" : "chrome",
    url,
    injection
  }
  state.tabs.push(newtab);
  if (setactive) {
    rememberActiveWorkspaceTab();
    state.top = 'workspace';
    state.activeWorkspaceId = workspaceId;
    state.activeTabId = newtab.id;
    state.activeTabByWorkspace[workspaceId] = newtab.id;
  }
  await syncTabs();
  if (setactive) {
    await syncActiveTab();
    render();
  }
}

function waitforwipe(wipeelement) {
  return new Promise (resolve => {
    function handler(event) {
      if (event.target !== wipeelement) {
        return
      }
      wipeelement.removeEventListener('animationend', handler)
      resolve()
    }

    wipeelement.addEventListener('animationend', handler)
  })

}

async function handlecanvaspagechange(loadpromise) {
  const wipe = document.getElementById('tab-wipe')
  wipe.classList.remove('hide')
  wipe.classList.add('show')

  const waittrans = waitforwipe(wipe)

  await loadpromise
  await waittrans

  wipe.classList.remove('show')
  wipe.classList.add('hide')

  await waitforwipe(wipe)
  wipe.classList.remove('hide')
  window.nucleus.canvasWipeHidden()
} 

function newbrowsertab(url, workspaceId, setactive = false, injection = null) {
  return newWebContentTab(url, workspaceId, setactive, injection, "browsertab");
}

function newCanvasTab(url, workspaceId, setactive = false, injection = null) {
  return newWebContentTab(url, workspaceId, setactive, injection, "canvastab");
}


function openCourseLinkInCanvasTab(link) {
  const href = link.getAttribute("href");
  if (!href || href === "#" || href.startsWith("#")) return;

  const workspaceId = getBrowserWorkspaceId();
  newCanvasTab(href, workspaceId, true, nucleusCanvasCSS);
}
function getVisibleTabs() {
  return state.tabs.filter(tab => tab.workspaceId === state.activeWorkspaceId);
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

async function navigateActiveBrowserTab(value) {
  const activeTab = getActiveBrowserTab();
  if (!activeTab) return;

  const result = await window.nucleus.navigateBrowserTab(activeTab.id, value);
  if (result && result.ok) {
    activeTab.url = result.url;
    await syncTabs();
    renderBrowserToolbar();
  }
}

function goBackActiveBrowserTab() {
  const activeTab = getActiveBrowserTab();
  if (!activeTab) return;
  window.nucleus.backBrowserTab(activeTab.id);
}

function goBackActiveCanvasTab() {
  const activeTab = getActiveCanvasTab();
  if (!activeTab) return;
  window.nucleus.backBrowserTab(activeTab.id);
}

async function writeActiveBrowserTabHtml() {
  const result = await window.nucleus.writeActiveTabHtml();
  if (!result || !result.ok) {
    console.error("Unable to write active tab HTML:", result && result.error);
    return;
  }
  console.log(`Wrote active tab HTML to assignmenthtml.json (${result.characters} characters).`);
}


// ─── Task Actions ─────────────────────────────────────────────────────────────
let renderafterupdate = false;
let pendingworkspaceID = null;
let pendingtabID = null;

async function startTask(taskId) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return;

  if (!task.workspaceId) {
    task.workspaceId = task.id + "wkspce";
    addworkspace(task.workspaceId, task.title);
  }

  renderafterupdate = true;
  pendingworkspaceID = task.workspaceId;
  pendingtabID = ensureWorkspaceCenter(task.workspaceId);

  try {
    await window.nucleus.startTask(task);
  } catch (error) {
    console.error("Unable to start task:", error);
  }
}

function closeTab(tabId) {
  const tab = state.tabs.find(item => sameTabId(item.id, tabId));
  if (!tab || tab.type === "center") return;

  const visibleTabs = getVisibleTabs();
  const index = visibleTabs.findIndex(item => sameTabId(item.id, tabId));

  state.tabs = state.tabs.filter(item => !sameTabId(item.id, tabId));

  if (sameTabId(state.activeTabId, tabId)) {
    const nextTab = visibleTabs[index] || visibleTabs[index - 1];
    state.activeTabId = nextTab && !sameTabId(nextTab.id, tabId)
      ? nextTab.id
      : ensureWorkspaceCenter(state.activeWorkspaceId);
  }
  state.activeTabByWorkspace[state.activeWorkspaceId] = state.activeTabId;

  syncTabs();
  syncActiveTab();
  render();
}


// ─── Render Functions ─────────────────────────────────────────────────────────

function renderPrimaryTabs() {
  document.querySelectorAll("#primary-tabs button").forEach(button => {
    button.classList.toggle("active", state.top !== "workspace" && button.dataset.section === state.activeSection);
  });
}

function renderWorkspaceTabs() {
  const workspaceTabs = document.getElementById("workspace-tabs");

  workspaceTabs.innerHTML = workspaces.map(workspace => `
    <button type="button" class="${state.top === 'workspace' && workspace.id === state.activeWorkspaceId ? "active" : ""}" data-workspace="${workspace.id}">
      <span class="workspace-tab-main">
        <span>${workspace.name}</span>
        <small>${getWorkspaceTasks(workspace.id).length} tasks</small>
      </span>
      <span class="workspace-delete" data-delete-workspace="${workspace.id}" title="Delete workspace">x</span>
    </button>
  `).join("");

  workspaceTabs.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", event => {
      const deleteTarget = event.target.closest("[data-delete-workspace]");
      if (deleteTarget) {
        event.stopPropagation();
        deleteWorkspace(deleteTarget.dataset.deleteWorkspace);
        return;
      }
      setActiveWorkspace(button.dataset.workspace);
    });
  });
}

function renderWorkspacePageTabs() {
  const pageTabs = document.getElementById("workspace-page-tabs");
  const visibleTabs = getVisibleTabs();

  pageTabs.classList.toggle("is-hidden", state.top !== "workspace");

  pageTabs.innerHTML = state.top === "workspace" ? visibleTabs.map(tab => `
    <button type="button" class="workspace-page-tab ${sameTabId(tab.id, state.activeTabId) ? "active" : ""}" data-tab-id="${tab.id}">
      <span>${tab.label}</span>
      ${tab.type !== "center" ? `<span class="close-tab" data-close-tab="${tab.id}">x</span>` : ""}
    </button>
  `).join("") : "";

  if (state.top === "workspace") {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.id = "add-tab-btn";
    addBtn.className = "add-tab-btn";
    addBtn.title = "New tab";
    addBtn.textContent = "+";
    addBtn.addEventListener('click', () => {
      newbrowsertab("https://www.google.com", state.activeWorkspaceId, true);
    })
    pageTabs.appendChild(addBtn);
  }

  pageTabs.querySelectorAll(".workspace-page-tab").forEach(tabButton => {
    tabButton.addEventListener("click", async event => {
      const closeTarget = event.target.closest("[data-close-tab]");
      if (closeTarget) {
        closeTab(closeTarget.dataset.closeTab);
        return;
      }
      state.activeTabId = tabButton.dataset.tabId;
      state.activeTabByWorkspace[state.activeWorkspaceId] = state.activeTabId;
      await syncActiveTab();
      render();
    });
  });
}

function renderBrowserToolbar() {
  const toolbar = document.getElementById("browser-toolbar");
  const activeTab = getActiveBrowserTab();

  toolbar.classList.toggle("is-hidden", !activeTab);
  toolbar.innerHTML = "";

  if (!activeTab) return;

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "browser-back-button";
  backButton.title = "Back";
  backButton.textContent = "Undo";
  backButton.addEventListener("click", goBackActiveBrowserTab);

  const saveHtmlButton = document.createElement("button");
  saveHtmlButton.type = "button";
  saveHtmlButton.className = "browser-save-html-button";
  saveHtmlButton.title = "Save page HTML";
  saveHtmlButton.textContent = "Save HTML";
  saveHtmlButton.addEventListener("click", writeActiveBrowserTabHtml);

  const form = document.createElement("form");
  form.className = "browser-url-form";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "browser-url-input";
  input.placeholder = "Search or enter URL";
  input.value = activeTab.url || "";

  form.addEventListener("submit", event => {
    event.preventDefault();
    navigateActiveBrowserTab(input.value);
  });

  form.appendChild(input);
  toolbar.appendChild(backButton);
  toolbar.appendChild(saveHtmlButton);
  toolbar.appendChild(form);
}

function renderCanvasToolbar() {
  const toolbar = document.getElementById("canvas-toolbar");
  const activeTab = getActiveCanvasTab();

  toolbar.classList.toggle("is-hidden", !activeTab);
  toolbar.innerHTML = "";

  if (!activeTab) return;

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "canvas-back-button";
  backButton.title = "Back";
  backButton.setAttribute("aria-label", "Back");
  backButton.textContent = "<";
  backButton.addEventListener("click", goBackActiveCanvasTab);

  toolbar.appendChild(backButton);
}

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

function renderProjectsDashboard() {
  const groups = getProjectGroups();

  if (groups.length === 0) {
    return `
      <header>
        <h1>Projects</h1>
        <p>${getGreeting()}. Classes and personal projects in one place.</p>
      </header>
      <section class="project-section">
        <div class="course-empty">No projects loaded yet.</div>
      </section>
    `;
  }

  return `
    <header>
      <h1>Projects</h1>
      <p>${getGreeting()}. Classes and personal projects in one place.</p>
    </header>

    ${groups.map(group => {
      const items = Array.isArray(group.items) ? group.items : [];
      return `
      <section class="project-section">
        <div class="section-heading">
          <h2>${group.label}</h2>
          <span>${items.length}</span>
        </div>
        <div class="project-grid">
          ${items.map(project => `
            <article class="project-card ${project.source === "canvas" ? "canvas-course-card" : ""}" ${project.source === "canvas" ? `data-canvas-course-id="${project.courseId}" tabindex="0" role="button"` : ""}>
              <span class="project-chip" style="background:${project.color}">${project.meta}</span>
              <h3>${project.name}</h3>
              <p>${project.details}</p>
              ${project.source === "canvas" ? `<span class="project-source">Canvas</span>` : ""}
            </article>
          `).join("")}
        </div>
      </section>
    `;
    }).join("")}
  `;
}

function renderCanvasCourseDashboard(courseId) {
  const course = canvasData && Array.isArray(canvasData.courses)
    ? canvasData.courses.find(item => String(item.id) === String(courseId))
    : null;

  if (!course) {
    return `
      <button type="button" class="course-back-button" data-back-to-projects>Back to projects</button>
      <section class="project-section">
        <div class="course-empty">This Canvas course was not found in the loaded data.</div>
      </section>
    `;
  }

  if (!window.nucleusCourseTemplates) {
    return `
      <button type="button" class="course-back-button" data-back-to-projects>Back to projects</button>
      <section class="project-section">
        <div class="course-empty">The course template script did not load.</div>
      </section>
    `;
  }

  return `
    <button type="button" class="course-back-button" data-open-section="projects">Back to projects</button>
    ${window.nucleusCourseTemplates.createCourseHtmlTemplate(course, canvasData)}
  `;
}

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

function renderCalendarPlaceholder() {
  return `
    <header>
      <h1>Calendar</h1>
      <p>Calendar view placeholder.</p>
    </header>
    <section class="workspace-panel">
      <div>
        <h2>Calendar</h2>
        <p>This tab is ready for the calendar UI.</p>
      </div>
    </section>
  `;
}

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

function renderView() {
  const activeTab = state.top === "workspace"
    ? state.tabs.find(tab => sameTabId(tab.id, state.activeTabId)) || {
        id: ensureWorkspaceCenter(state.activeWorkspaceId),
        type: "center",
        workspaceId: state.activeWorkspaceId
      }
    : null;

  const view = document.getElementById("view");

  if (state.top !== "workspace") {
    if (state.activeCourseId) {
      view.innerHTML = renderCanvasCourseDashboard(state.activeCourseId);
    } else if (state.activeSection === "projects") {
      view.innerHTML = renderProjectsDashboard();
    } else if (state.activeSection === "tasks") {
      view.innerHTML = renderSuggestedTasks();
    } else {
      view.innerHTML = renderCalendarPlaceholder();
    }
  } else if (activeTab.type === "task") {
    view.innerHTML = renderTaskWorkspace(activeTab);
  } else if (isWebContentTab(activeTab)) {
    view.innerHTML = "";
  } else {
    view.innerHTML = renderProjectCenter(getWorkspace(state.activeWorkspaceId));
  }

  view.querySelectorAll("[data-start-task]").forEach(button => {
    button.addEventListener("click", () => startTask(button.dataset.startTask));
  });

  view.querySelectorAll("[data-open-section]").forEach(button => {
    button.addEventListener("click", () => setActiveSection(button.dataset.openSection));
  });

  view.querySelectorAll("[data-back-to-projects]").forEach(button => {
    button.addEventListener("click", () => {
      state.activeCourseId = null;
      state.activeSection = "projects";
      state.top = "section";
      render();
    });
  });

  view.querySelectorAll("[data-canvas-course-id]").forEach(card => {
    const openCourse = () => {
      state.activeCourseId = card.dataset.canvasCourseId;
      state.activeSection = "projects";
      state.top = "section";
      syncActiveTab();
      render();
    };
    card.addEventListener("click", openCourse);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCourse();
      }
    });
  });

  view.querySelectorAll(".course-page a[href]").forEach(link => {
    link.addEventListener("click", event => {
      const href = link.getAttribute("href");
      if (!href || href === "#" || href.startsWith("#")) return;

      event.preventDefault();
      openCourseLinkInCanvasTab(link);
    });
  });
}

function render() {
  renderPrimaryTabs();
  renderWorkspaceTabs();
  renderWorkspacePageTabs();
  renderBrowserToolbar();
  renderCanvasToolbar();
  renderView();
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
    newbrowsertab(payload.url, payload.workspaceId, true
    );
  });
  window.nucleus.on("canvas:navigation", () => {
    const loadFN = new Promise(resolve => {
      const off = window.nucleus.on("canvas:navigation-finished", status => {
        off();
        resolve(status);
      });
    });

    handlecanvaspagechange(loadFN);
  });

  render();
});
