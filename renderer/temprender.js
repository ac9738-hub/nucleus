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

function truncateTaskText(value, maxLength = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function renderTaskCard(task) {
  const details = truncateTaskText(task.details || "No description provided.");
  return `
    <article class="task-card" data-id="${task.id}">
      <div class="task-header">
        <span class="task-course" style="background:${task.color}">${task.course}</span>
        <span class="task-due">Due ${task.due}</span>
      </div>
      <h2>${task.title}</h2>
      <p title="${details}">${details}</p>
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
