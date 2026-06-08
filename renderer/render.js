// ─── Render Functions ─────────────────────────────────────────────────────────

let appIconClickState = {
  target: null,
  timeout: null
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function activateAppIcon(card, openApp) {
  if (appIconClickState.target === card) {
    clearTimeout(appIconClickState.timeout);
    appIconClickState.target = null;
    appIconClickState.timeout = null;
    card.classList.remove("is-clicked");
    card.classList.add("is-launching");
    setTimeout(openApp, 180);
    return;
  }

  if (appIconClickState.target) {
    appIconClickState.target.classList.remove("is-clicked");
    clearTimeout(appIconClickState.timeout);
  }

  appIconClickState.target = card;
  card.classList.add("is-clicked");
  appIconClickState.timeout = setTimeout(() => {
    card.classList.remove("is-clicked");
    if (appIconClickState.target === card) {
      appIconClickState.target = null;
      appIconClickState.timeout = null;
    }
  }, 750);
}

// render the top level vertical tabs aka the section panel by toggleing active on or off
function renderPrimaryTabs() {
  document.querySelectorAll("#primary-tabs button").forEach(button => {
    button.classList.toggle("active", state.top !== "workspace" && button.dataset.section === state.activeSection);
  });
}

// render the tabs in the left panel for workspaces ** no container
function renderWorkspaceTabs() {
  const workspaceTabs = document.getElementById("workspace-tabs");

  // build html
  workspaceTabs.innerHTML = workspaces.map(workspace => `
    <button type="button" class="${state.top === 'workspace' && workspace.id === state.activeWorkspaceId ? "active" : ""}" data-workspace="${escapeHtml(workspace.id)}">
      <span class="workspace-tab-main">
        <span>${escapeHtml(workspace.name)}</span>
        <small>${getWorkspaceTasks(workspace.id).length} tasks</small>
      </span>
      <span class="workspace-delete" data-delete-workspace="${escapeHtml(workspace.id)}" title="Delete workspace">x</span>
    </button>
  `).join("");

  // add click listeners
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

// render the workspacepagetabs under the primary tabs ** no container
function renderWorkspacePageTabs() {
  const pageTabs = document.getElementById("workspace-page-tabs");
  const visibleTabs = getVisibleTabs();

  pageTabs.classList.toggle("is-hidden", state.top !== "workspace");

  // build html only if workspace on top
  pageTabs.innerHTML = state.top === "workspace" ? visibleTabs.map(tab => `
    <button type="button" class="workspace-page-tab ${sameTabId(tab.id, state.activeTabId) ? "active" : ""}" data-tab-id="${escapeHtml(tab.id)}">
      <span>${escapeHtml(tab.label)}</span>
      ${tab.type !== "center" ? `<span class="close-tab" data-close-tab="${escapeHtml(tab.id)}">x</span>` : ""}
    </button>
  `).join("") : "";

  // new tab button (+)
  if (state.top === "workspace") {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.id = "add-tab-btn";
    addBtn.className = "add-tab-btn";
    addBtn.title = "New tab";
    addBtn.textContent = "+";
    addBtn.addEventListener('click', () => {
      newbrowsertab(null, state.activeWorkspaceId, true);
    })
    pageTabs.appendChild(addBtn);
  }

  // add tab click listeners
  pageTabs.querySelectorAll(".workspace-page-tab").forEach(tabButton => {
    tabButton.addEventListener("click", async event => {
      const closeTarget = event.target.closest("[data-close-tab]");
      if (closeTarget) {
        closeTab(closeTarget.dataset.closeTab);
        return;
      }
      rememberActiveCanvasYIndex();
      state.activeTabId = tabButton.dataset.tabId;
      state.activeTabByWorkspace[state.activeWorkspaceId] = state.activeTabId;
      await syncActiveTab();
      render();
    });
  });
}

// renders the toolbar for browsertabs
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

  const saveFramesButton = document.createElement("button");
  saveFramesButton.type = "button";
  saveFramesButton.className = "browser-save-html-button";
  saveFramesButton.title = "Save page and iframe HTML";
  saveFramesButton.textContent = "Save Frames";
  saveFramesButton.addEventListener("click", writeActiveBrowserTabFramesHtml);

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
  toolbar.appendChild(saveFramesButton);
  toolbar.appendChild(form);
}

// render the tab toolbar for canvas
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

  const saveHtmlButton = document.createElement("button");
  saveHtmlButton.type = "button";
  saveHtmlButton.className = "canvas-save-html-button";
  saveHtmlButton.title = "Save page HTML";
  saveHtmlButton.textContent = "Save HTML";
  saveHtmlButton.addEventListener("click", writeActiveBrowserTabHtml);

  const saveFramesButton = document.createElement("button");
  saveFramesButton.type = "button";
  saveFramesButton.className = "canvas-save-html-button";
  saveFramesButton.title = "Save page and iframe HTML";
  saveFramesButton.textContent = "Save Frames";
  saveFramesButton.addEventListener("click", writeActiveBrowserTabFramesHtml);

  toolbar.appendChild(backButton);
  toolbar.appendChild(saveHtmlButton);
  toolbar.appendChild(saveFramesButton);
}

// update taskcard html in the DOM
function truncateTaskText(value, maxLength = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

const CANVAS_COURSE_BORDER_COLORS = [
  "#ff4d4d",
  "#35c46a",
  "#4d8dff",
  "#f2c94c",
  "#ffffff",
  "#a66cff"
];

function isCanvasTask(task) {
  return task && (
    task.source === "canvas" ||
    task.type === "canvas-assignment" ||
    String(task.id || "").startsWith("canvas-assignment-") ||
    String(task.course || "").startsWith("Canvas ")
  );
}

function getCanvasCourseKey(task) {
  return String(task.courseId || task.course || "Canvas");
}

function getCanvasCourseDisplayName(task) {
  if (!isCanvasTask(task)) {
    return task.course || "";
  }

  const courseId = String(task.courseId || "").trim()
    || String(task.course || "").replace(/^Canvas\s+/i, "").trim();
  const courses = canvasData && Array.isArray(canvasData.courses)
    ? canvasData.courses
    : [];
  const course = courses.find(item => String(item.id) === courseId);

  if (course) {
    return course.name || course.course_code || task.course || `Canvas ${courseId}`;
  }

  return task.course || (courseId ? `Canvas ${courseId}` : "Canvas");
}

function getCanvasCourseBorderColor(task) {
  if (!isCanvasTask(task)) return "";

  const courseKeys = [];
  tasks.forEach(item => {
    if (!isCanvasTask(item)) return;
    const key = getCanvasCourseKey(item);
    if (!courseKeys.includes(key)) {
      courseKeys.push(key);
    }
  });

  const courseIndex = courseKeys.indexOf(getCanvasCourseKey(task));
  return CANVAS_COURSE_BORDER_COLORS[courseIndex % CANVAS_COURSE_BORDER_COLORS.length];
}

function renderTaskCard(task) {
  const urls = Array.isArray(task.urls) ? task.urls : [];
  const details = truncateTaskText(task.details || "No description provided.");
  const borderColor = getCanvasCourseBorderColor(task);
  const cardStyle = borderColor ? ` style="--task-course-border:${borderColor}"` : "";
  const courseName = getCanvasCourseDisplayName(task);
  const encodedUrls = encodeURIComponent(JSON.stringify(urls));
  return `
    <article class="task-card" data-id="${escapeHtml(task.id)}" data-task-urls="${escapeHtml(encodedUrls)}"${cardStyle}>
      <div class="task-header">
        <span class="task-course" style="background:${escapeHtml(task.color)}">${escapeHtml(courseName)}</span>
        <span class="task-due">Due ${escapeHtml(task.due)}</span>
      </div>
      <h2>${escapeHtml(task.title)}</h2>
      <p title="${escapeHtml(details)}">${escapeHtml(details)}</p>
      <div class="task-footer">
        <span>${escapeHtml(task.estimate)}</span>
        <button type="button" class="start-task-button" data-start-task="${escapeHtml(task.id)}">Start task</button>
      </div>
    </article>
  `;
}

function getTasksForCards() {
  if (window.TaskOptimizer && typeof window.TaskOptimizer.orderTasks === "function") {
    return window.TaskOptimizer.orderTasks(tasks).map(score => score.task || score);
  }

  return tasks;
}

// returns the html for the apps dashboard
function renderAppsDashboard() {
  const apps = [
    { id: "canvas-app", name: "Canvas", meta: "Canvas", details: "Open Canvas courses, files, modules, and assignments.", color: "#d4537e" }
  ];

  return `
    <header>
      <h1>Apps</h1>
      <p>${getGreeting()}. Open native apps inside your workspace.</p>
    </header>
    <section class="project-section">
      <div class="section-heading">
        <h2>Apps</h2>
        <span>${apps.length}</span>
      </div>
      <div class="app-grid">
        ${apps.map(app => `
          <article class="app-launch-card" data-open-canvas-app="true" tabindex="0" role="button" aria-label="Open ${app.name}">
            <div class="app-icon canvas-app-icon" aria-hidden="true">
              <img src="app/canvas/assets/canvas_icon.png" alt="">
            </div>
            <span class="app-name">${app.name}</span>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

// render tasks container
function renderSuggestedTasks() {
  return `
    <header>
      <h1>Tasks</h1>
      <p>All suggested tasks across classes, projects, and workspaces.</p>
    </header>
    <section>
      <div class="task-grid">
        ${getTasksForCards().map(renderTaskCard).join("")}
      </div>
    </section>
  `;
}

// calender tab
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

//  return the html of the projectcenter tab
function renderProjectCenter(workspace) {
  return `
    <header>
      <h1>${escapeHtml(workspace.name)} Project Center</h1>
      <p>${escapeHtml(workspace.description)}</p>
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

// ???
function renderTaskWorkspace(tab) {
  const task = tasks.find(item => item.id === tab.taskId);
  if (!task) return renderProjectCenter(getWorkspace(state.activeWorkspaceId));
  const courseName = getCanvasCourseDisplayName(task);

  return `
    <header>
      <h1>${escapeHtml(task.title)}</h1>
      <p>${escapeHtml(courseName)} / Due ${escapeHtml(task.due)} / ${escapeHtml(task.estimate)}</p>
    </header>

    <section class="workspace-panel">
      <div>
        <h2>Workspace</h2>
        <p>${escapeHtml(task.details)}</p>
      </div>
      <button type="button" class="start-task-button">Begin work</button>
    </section>
  `;
}

// renders the inner view (everything that's not the paneels)
function renderView() {
  const activeTab = state.top === "workspace"
    ? state.tabs.find(tab => sameTabId(tab.id, state.activeTabId)) || {
        id: ensureWorkspaceCenter(state.activeWorkspaceId),
        type: "center",
        workspaceId: state.activeWorkspaceId
      }
    : null;

  const view = document.getElementById("view");

  // injects html to view object based on what pagetype is active
  if (state.top !== "workspace") {
    if (state.activeSection === "projects") {
      view.innerHTML = renderAppsDashboard();
    } else if (state.activeSection === "tasks") {
      view.innerHTML = renderSuggestedTasks();
    } else {
      view.innerHTML = renderCalendarPlaceholder();
    }
  } else if (activeTab.type === "task") {
    view.innerHTML = renderTaskWorkspace(activeTab);
  } else if (activeTab.type === "canvastab" && activeTab.canvasMode !== "browser") {
    view.innerHTML = window.nucleusCanvasApp
      ? window.nucleusCanvasApp.renderCanvasApp(activeTab, canvasData)
      : `<section class="workspace-panel"><div><h2>Canvas</h2><p>The Canvas app script did not load.</p></div></section>`;
  } else if (isWebContentTab(activeTab)) {
    view.innerHTML = "";
  } else {
    view.innerHTML = renderProjectCenter(getWorkspace(state.activeWorkspaceId));
  }

  restoreActiveCanvasYIndex();

  // attach click listeners to buttons
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

  view.querySelectorAll("[data-back-to-canvas-app]").forEach(button => {
    button.addEventListener("click", () => {
      const activeTab = getActiveTab();
      if (activeTab && activeTab.type === "canvastab" && activeTab.canvasMode !== "browser") {
        rememberActiveCanvasYIndex();
        if (Array.isArray(activeTab.nativeHistory)) {
          activeTab.nativeHistory.pop();
        }
        activeTab.canvasNativePage = "dashboard";
        activeTab.courseId = null;
        activeTab.courseSection = "homepage";
        activeTab.yindex = 0;
        syncTabs();
        render();
      }
    });
  });

  view.querySelectorAll("[data-course-section]").forEach(button => {
    button.addEventListener("click", () => {
      const activeTab = getActiveTab();
      if (!activeTab || activeTab.type !== "canvastab" || activeTab.canvasMode === "browser") return;
      const section = button.dataset.courseSection;
      if (!["homepage", "assignments", "modules", "files"].includes(section)) return;
      rememberActiveCanvasYIndex();
      activeTab.courseSection = section;
      activeTab.yindex = 0;
      syncTabs();
      render();
    });
  });

  view.querySelectorAll("[data-open-canvas-app]").forEach(card => {
    const openCanvas = () => openCanvasAppTab(getBrowserWorkspaceId());
    card.addEventListener("click", () => activateAppIcon(card, openCanvas));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateAppIcon(card, openCanvas);
      }
    });
  });

  view.querySelectorAll("[data-canvas-course-id]").forEach(card => {
    const openCourse = () => {
      if (state.top === "workspace") {
        const activeTab = getActiveTab();
        if (activeTab && activeTab.type === "canvastab" && activeTab.canvasMode !== "browser") {
          pushCanvasNativeHistory(activeTab);
          activeTab.canvasNativePage = "course";
          activeTab.courseId = card.dataset.canvasCourseId;
          activeTab.courseSection = "homepage";
          activeTab.yindex = 0;
          syncTabs();
          render();
          return;
        }
      }
      openCanvasAppTab(getBrowserWorkspaceId(), card.dataset.canvasCourseId);
    };
    card.addEventListener("click", openCourse);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCourse();
      }
    });
  });
  // linke handlers for canvas. IMPORTANT
  view.querySelectorAll(".course-page a[href]").forEach(link => {
    link.addEventListener("click", event => {
      const href = link.getAttribute("href");
      if (!href || href === "#" || href.startsWith("#")) return;

      event.preventDefault();
      openCourseLinkInCanvasTab(link);
    });
  });
}

// renders whole page
function render() {
  renderPrimaryTabs();
  renderWorkspaceTabs();
  renderWorkspacePageTabs();
  renderBrowserToolbar();
  renderCanvasToolbar();
  renderView();
}
