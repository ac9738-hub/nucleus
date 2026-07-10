// ─── Render Functions ─────────────────────────────────────────────────────────

// Renderer view templates.
// Functionality: renders sidebars, task cards, toolbars, project center, Canvas
// native app surfaces, and event listeners for generated DOM.
// Dependencies: renderer/app.js state/data globals and renderer/workspace-page-tabs.js
// navigation helpers are loaded before/after this file by index.html.

let appIconClickState = {
  target: null,
  timeout: null
};

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
    const isActive = state.top !== "workspace" && button.dataset.section === state.activeSection;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

// render the tabs in the left panel for workspaces ** no container
function renderWorkspaceTabs() {
  const workspaceTabs = document.getElementById("workspace-tabs");
  if (!workspaceTabs) return;
  const workspaceList = Array.isArray(workspaces) ? workspaces : [];

  // build html
  workspaceTabs.innerHTML = workspaceList.map(workspace => `
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

function isWebPageTab(tab) {
  return tab && (tab.type === "browsertab" || (tab.type === "canvastab" && tab.canvasMode === "browser"));
}

function titleFromUrl(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  if (text.startsWith("nucleus://search")) return "Search";
  if (text.startsWith("nucleus://")) return "";
  try {
    const parsed = new URL(text);
    return parsed.hostname.replace(/^www\./i, "") || "";
  } catch (_) {
    return "";
  }
}

function getCanvasTabCourseName(tab) {
  if (!tab || !tab.courseId) return "";
  const courses = canvasData && Array.isArray(canvasData.courses) ? canvasData.courses : [];
  const course = courses.find(item => String(item.id) === String(tab.courseId));
  return course ? (course.name || course.course_code || "") : "";
}

const NATIVE_TAB_ICONS = {
  canvas: "app/canvas/assets/canvas_icon.png",
  mail: "app/mail/assets/mail_icon.svg",
  synapse: "app/synapse/assets/synapse_icon.png"
};

const WEB_TAB_ICON_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><ellipse cx="8" cy="8" rx="6" ry="2.2" fill="none" stroke="currentColor" stroke-width="1"/><path d="M8 2v12" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;

const CENTER_TAB_ICON_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7.5 8 3l5 4.5V13a1 1 0 0 1-1 1h-3v-4H7v4H4a1 1 0 0 1-1-1V7.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

function getNativeTabIconKind(tab) {
  if (!tab) return null;
  if (tab.type === "center") return "center";
  if (tab.type === "mailtab") return "mail";
  if (tab.type === "synapsetab") return "synapse";
  if (tab.type === "artifacttab") return "artifact";
  if (tab.type === "canvastab" && tab.canvasMode !== "browser") return "canvas";
  return null;
}

function renderWorkspaceTabIcon(tab) {
  const kind = getNativeTabIconKind(tab);
  if (kind) {
    if (kind === "center") {
      return `<span class="workspace-page-tab-icon workspace-page-tab-icon-center">${CENTER_TAB_ICON_SVG}</span>`;
    }
    if (kind === "artifact" && window.nucleusArtifactTabs && typeof window.nucleusArtifactTabs.renderArtifactTabIcon === "function") {
      return window.nucleusArtifactTabs.renderArtifactTabIcon(tab);
    }
    const src = NATIVE_TAB_ICONS[kind];
    return `<span class="workspace-page-tab-icon workspace-page-tab-icon-${kind}"><img src="${escapeHtml(src)}" alt="" draggable="false"></span>`;
  }
  if (isWebPageTab(tab)) {
    return `<span class="workspace-page-tab-icon workspace-page-tab-icon-web">${WEB_TAB_ICON_SVG}</span>`;
  }
  return "";
}

function getTabDisplayTitle(tab) {
  if (!tab) return "Tab";
  if (tab.type === "center") return tab.label || "Control Center";
  if (tab.type === "mailtab") return "Mail";
  if (tab.type === "synapsetab") return "Synapse";
  if (tab.type === "artifacttab") return tab.label || "Artifact";
  if (tab.type === "canvastab" && tab.canvasMode !== "browser") {
    if (tab.canvasNativePage === "course") {
      const courseName = getCanvasTabCourseName(tab);
      if (courseName) return courseName;
    }
    return "Canvas";
  }
  if (isWebPageTab(tab)) {
    const pageTitle = String(tab.pageTitle || "").trim();
    if (pageTitle) return pageTitle;
    const label = String(tab.label || "").trim();
    if (label && label !== "chrome" && label !== "Canvas") return label;
    return titleFromUrl(tab.url) || "New Tab";
  }
  return tab.label || "Tab";
}

function renderWorkspaceTabVisual(tab) {
  return renderWorkspaceTabIcon(tab);
}

function demoteSiblingWebTabViewTiers(activeTabId, workspaceId) {
  state.tabs.forEach(tab => {
    if (!tab || tab.workspaceId !== workspaceId) return;
    if (sameTabId(tab.id, activeTabId)) return;
    if (typeof isWebContentTab === "function" && !isWebContentTab(tab)) return;
    tab.viewTier = "stashed";
  });
}

function parseTabVisualElement(visualHtml) {
  const temp = document.createElement("div");
  temp.innerHTML = visualHtml.trim();
  return temp.firstElementChild;
}

function tabVisualsMatch(existingVisual, newVisual) {
  if (!existingVisual || !newVisual) return false;
  if (existingVisual.classList.contains("workspace-page-tab-thumb")) {
    return newVisual.classList.contains("workspace-page-tab-thumb")
      && existingVisual.getAttribute("src") === newVisual.getAttribute("src");
  }
  return existingVisual.outerHTML === newVisual.outerHTML;
}

function setViewSwitching(active) {
  const view = document.getElementById("view");
  if (!view) return;
  view.classList.toggle("view-is-switching", Boolean(active));
  view.classList.toggle("view-is-ready", !active);
}

function patchOptimisticWorkspaceTabActive(tabId) {
  const pageTabs = document.getElementById("workspace-page-tabs");
  if (!pageTabs) return;
  pageTabs.querySelectorAll(".workspace-page-tab").forEach(btn => {
    btn.classList.toggle("active", sameTabId(btn.dataset.tabId, tabId));
  });
  setViewSwitching(true);
}

let pendingViewTransition = null;

function getViewTransitionApi() {
  return window.nucleusViewTransition || null;
}

function beginPendingViewTransition() {
  const vt = getViewTransitionApi();
  pendingViewTransition = vt ? vt.beginTransition() : null;
  return pendingViewTransition;
}

function consumePendingViewTransition() {
  const transition = pendingViewTransition;
  pendingViewTransition = null;
  return transition;
}

function getActiveViewContext() {
  const activeTab = state.top === "workspace"
    ? state.tabs.find(tab => sameTabId(tab.id, state.activeTabId)) || {
        id: ensureWorkspaceCenter(state.activeWorkspaceId),
        type: "center",
        workspaceId: state.activeWorkspaceId
      }
    : null;
  return { activeTab };
}

function composeActiveViewHtml() {
  const { activeTab } = getActiveViewContext();

  if (state.top !== "workspace") {
    if (state.activeSection === "home") return renderHomeDashboard();
    if (state.activeSection === "tasks") return renderSuggestedTasks();
    return renderCalendarPlaceholder();
  }
  if (activeTab.type === "task") return renderTaskWorkspace(activeTab);
  if (activeTab.type === "canvastab" && activeTab.canvasMode !== "browser") {
    return window.nucleusCanvasApp
      ? window.nucleusCanvasApp.renderCanvasApp(activeTab, canvasData)
      : `<section class="workspace-panel"><div><h2>Canvas</h2><p>The Canvas app script did not load.</p></div></section>`;
  }
  if (activeTab.type === "synapsetab") {
    return window.nucleusSynapseApp
      ? window.nucleusSynapseApp.renderSynapseApp(activeTab, synapseState)
      : `<section class="workspace-panel"><div><h2>Synapse</h2><p>The Synapse app script did not load.</p></div></section>`;
  }
  if (activeTab.type === "mailtab") {
    return window.nucleusMailApp
      ? window.nucleusMailApp.renderMailApp(activeTab, mailState)
      : `<section class="workspace-panel"><div><h2>Mail</h2><p>The Mail app script did not load.</p></div></section>`;
  }
  if (activeTab.type === "artifacttab") {
    return window.nucleusArtifactTabs
      ? window.nucleusArtifactTabs.renderArtifactTabView(activeTab)
      : `<section class="workspace-panel"><div><h2>Artifact</h2><p>The artifact tab script did not load.</p></div></section>`;
  }
  if (isWebContentTab(activeTab)) {
    const diag = window.__nucleusDiag;
    if (diag && diag.isEnabled("tabs")) {
      diag.logTabs("flash_risk_empty_shell", {
        tabId: activeTab.id,
        tabType: activeTab.type,
        canvasMode: activeTab.canvasMode || "",
        loading: Boolean(activeTab.loading),
        hasSnapshot: Boolean(activeTab.snapshotDataUrl),
        viewTier: activeTab.viewTier || ""
      });
    }
    if (activeTab.type === "canvastab" && activeTab.canvasMode === "browser") {
      return "";
    }
    if (window.__nucleusDiag && window.__nucleusDiag.isEnabled("render")) {
      window.__nucleusDiag.logRender("render_view", {
        kind: "web_content",
        tabType: activeTab.type,
        loading: Boolean(activeTab.loading),
        discarded: Boolean(activeTab.discarded),
        viewTier: activeTab.viewTier || "",
        hasSnapshot: Boolean(activeTab.snapshotDataUrl)
      });
    }
    const overlay = window.__nucleusTabSnapshot ? window.__nucleusTabSnapshot.get() : null;
    const restoreSnapshot =
      overlay &&
      overlay.visible &&
      sameTabId(activeTab.id, overlay.tabId) &&
      overlay.snapshotDataUrl
        ? overlay.snapshotDataUrl
        : "";
    const loadingSnapshot =
      activeTab.loading && activeTab.snapshotDataUrl
        ? activeTab.snapshotDataUrl
        : "";
    const placeholderSnapshot = restoreSnapshot || loadingSnapshot;
    if (placeholderSnapshot) {
      return `<img class="tab-restore-snapshot" src="${escapeHtml(placeholderSnapshot)}" alt="">`;
    }
    return "";
  }
  return renderWorkspaceControlCenter(getWorkspace(state.activeWorkspaceId));
}

function collectNativeCourseDomLinks(root) {
  const tracker = resolveNativeCanvasTracker()
  if (!tracker || typeof tracker.collectVisibleCourseLinks !== "function") return []
  const scope = root || document.getElementById("view")
  if (!scope) return []
  const domApi = typeof window !== "undefined" ? window.nucleusCanvasPreloadDom : null
  return tracker.collectVisibleCourseLinks(scope)
    .map(entry => entry.url)
    .filter(url => {
      if (!url) return false
      if (domApi && typeof domApi.isCanvasPreloadableUrl === "function") {
        return domApi.isCanvasPreloadableUrl(url)
      }
      return /^https?:\/\/[^/]+\/courses\/\d+\/.+/i.test(String(url))
    })
}

let nativeCoursePointerTrackerCleanup = null
let nativeCoursePointerInstallKey = ""
let nativePointerTabSyncSent = false

function teardownNativeCoursePointerTracker() {
  if (typeof nativeCoursePointerTrackerCleanup === "function") {
    nativeCoursePointerTrackerCleanup()
    nativeCoursePointerTrackerCleanup = null
  }
  nativeCoursePointerInstallKey = ""
  nativePointerTabSyncSent = false
}

function ensureNativePointerTabSynced() {
  if (nativePointerTabSyncSent) return
  nativePointerTabSyncSent = true
  if (typeof syncActiveTab === "function") {
    void syncActiveTab().catch(() => {})
  }
}

function resolveNativeCanvasTracker() {
  if (typeof globalThis !== "undefined" && globalThis.nucleusCanvasNativeTracker) {
    return globalThis.nucleusCanvasNativeTracker
  }
  if (typeof window !== "undefined" && window.nucleusCanvasNativeTracker) {
    return window.nucleusCanvasNativeTracker
  }
  return null
}

function installNativeCoursePointerTracker(root, tab) {
  if (!tab || tab.type !== "canvastab" || tab.canvasMode === "browser") {
    return
  }
  if (!tab.courseId || !root) {
    return
  }

  const tracker = resolveNativeCanvasTracker()
  if (!tracker || typeof tracker.installNativeCoursePointerTracker !== "function") {
    return
  }

  const installKey = `${String(tab.id || "")}:${String(tab.courseId || "")}:${String(tab.courseSection || "homepage")}`
  if (installKey === nativeCoursePointerInstallKey && nativeCoursePointerTrackerCleanup) {
    return
  }

  teardownNativeCoursePointerTracker()
  nativeCoursePointerInstallKey = installKey

  nativeCoursePointerTrackerCleanup = tracker.installNativeCoursePointerTracker({
    root,
    getTabId() {
      const active = typeof getActiveTab === "function" ? getActiveTab() : null
      return active && active.id ? String(active.id) : String(tab && tab.id || "")
    },
    onPointerHints(links, meta = {}) {
      if (!window.nucleus || typeof window.nucleus.canvasPreloadPointerHints !== "function") {
        return
      }
      const active = typeof getActiveTab === "function" ? getActiveTab() : null
      if (!active || active.type !== "canvastab" || active.canvasMode === "browser") {
        return
      }
      if (!active.courseId) return
      const hintTabId = String(meta.tabId || (active && active.id) || "")
      if (!hintTabId || !sameTabId(active.id, hintTabId)) {
        return
      }
      ensureNativePointerTabSynced()
      const domLinks = Array.isArray(links)
        ? links.map(entry => entry && entry.url).filter(Boolean)
        : []
      window.nucleus.canvasPreloadPointerHints({
        tabId: active.id,
        courseId: String(active.courseId),
        courseSection: active.courseSection || "homepage",
        source: "native_course",
        emitReason: meta.emitReason || "",
        domLinks,
        links
      }).catch(() => {})
    },
    onLinkMousedown(url) {
      if (!window.nucleus || typeof window.nucleus.canvasPreloadPlan !== "function") return
      const active = typeof getActiveTab === "function" ? getActiveTab() : tab
      if (!active || active.type !== "canvastab" || active.canvasMode === "browser") return
      window.nucleus.canvasPreloadPlan({
        tabId: active.id,
        courseId: active.courseId ? String(active.courseId) : "",
        courseSection: active.courseSection || "homepage",
        urls: [url],
        reason: "link_mousedown"
      }).catch(() => {})
    }
  })
}

function mountCanvasCourseLinkHandlers(root) {
  root.querySelectorAll(".course-page a[href]").forEach(link => {
    link.addEventListener("click", event => {
      const target = event.currentTarget;
      const href = target.getAttribute("href");
      if (!href || href === "#" || href.startsWith("#")) return;
      event.preventDefault();
      event.stopPropagation();
      openCourseLinkInCanvasTab(target);
    });
  });

  const viewRoot = document.getElementById("view") || root
  const tab = typeof getActiveTab === "function" ? getActiveTab() : null
  installNativeCoursePointerTracker(viewRoot, tab)
}

function scheduleNativeCanvasSectionPreload(tab) {
  if (!tab || !window.nucleus || typeof window.nucleus.canvasPreloadPlan !== "function") return
  if (!tab.courseId) return

  const key = String(tab.id || tab.courseId)
  const now = Date.now()
  const last = scheduleNativeCanvasSectionPreload._at.get(key) || 0

  const view = document.getElementById("view")
  const domLinks = collectNativeCourseDomLinks(view)
  const domSig = domLinks.slice(0, 8).join("|")
  const lastSig = scheduleNativeCanvasSectionPreload._domSig.get(key) || ""
  if (domSig && domSig === lastSig && now - last < 5000) return
  if (now - last < 3500) return
  scheduleNativeCanvasSectionPreload._at.set(key, now)
  if (domSig) scheduleNativeCanvasSectionPreload._domSig.set(key, domSig)

  window.nucleus.canvasPreloadPlan({
    tabId: tab.id,
    courseId: String(tab.courseId),
    courseSection: tab.courseSection || "homepage",
    domLinks,
    reason: "native_section"
  }).catch(() => {})
}
scheduleNativeCanvasSectionPreload._at = new Map();
scheduleNativeCanvasSectionPreload._domSig = new Map();

function patchCanvasCourseSection(view, activeTab, section) {
  const templates = window.nucleusCourseTemplates;
  if (!templates || typeof templates.renderCourseSectionHtml !== "function") return false;
  const coursePage = view.querySelector(".course-page");
  if (!coursePage || String(coursePage.dataset.courseId) !== String(activeTab.courseId)) return false;

  const html = templates.renderCourseSectionHtml(activeTab.courseId, canvasData, section);
  if (!html) return false;

  coursePage.querySelectorAll(".course-tabs button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.courseSection === section);
  });

  const vt = getViewTransitionApi();
  const transition = vt ? vt.beginTransition() : null;
  const mountSection = root => mountCanvasCourseLinkHandlers(root);

  if (vt && transition) {
    vt.paintViewSection(coursePage, html, {
      generation: transition.generation,
      mount: mountSection
    });
  } else {
    const existing = coursePage.querySelector("[data-course-section-page]");
    if (existing) existing.outerHTML = html;
    mountSection(coursePage);
  }
  return true;
}

function patchWorkspacePageTabs() {
  const pageTabs = document.getElementById("workspace-page-tabs");
  if (!pageTabs || state.top !== "workspace") return;

  pageTabs.querySelectorAll(".workspace-page-tab").forEach(btn => {
    const tab = state.tabs.find(item => sameTabId(item.id, btn.dataset.tabId));
    if (!tab) return;

    btn.classList.toggle("active", sameTabId(tab.id, state.activeTabId));
    btn.classList.toggle("is-discarded", Boolean(tab.discarded));
    btn.classList.toggle(
      "is-loading",
      Boolean(tab.loading) && sameTabId(tab.id, state.activeTabId)
    );

    const displayTitle = getTabDisplayTitle(tab);
    const label = btn.querySelector(".workspace-page-tab-label");
    if (label && label.textContent !== displayTitle) {
      label.textContent = displayTitle;
    }
    if (btn.title !== displayTitle) {
      btn.title = displayTitle;
    }

    const newVisual = parseTabVisualElement(renderWorkspaceTabVisual(tab));
    if (!newVisual) return;
    const existingVisual = btn.querySelector(".workspace-page-tab-thumb, .workspace-page-tab-icon");
    if (existingVisual && tabVisualsMatch(existingVisual, newVisual)) return;
    if (existingVisual) {
      existingVisual.replaceWith(newVisual);
      return;
    }
    if (label) {
      btn.insertBefore(newVisual, label);
    }
  });
}

function renderWorkspaceViewPartial(options = {}) {
  if (options.shell !== "minimal") {
    renderWorkspaceSidebarCollapseState();
    renderPrimaryTabs();
    renderWorkspaceTabs();
  }
  updateWorkspacePageTabs(options);
  renderBrowserToolbar();
  renderCanvasToolbar();
}

function paintActiveView(options = {}) {
  const view = document.getElementById("view");
  if (!view) return;
  const { activeTab } = getActiveViewContext();
  const html = composeActiveViewHtml();
  const vt = getViewTransitionApi();
  let transition = options.transition || null;
  if (!transition && !options.skipTransition) {
    transition = consumePendingViewTransition()
      || (vt && typeof vt.consumeActiveTransition === "function" ? vt.consumeActiveTransition() : null);
  }
  const skipCrossfade = Boolean(
    options.skipTransition
    || options.fast
    || (activeTab && isWebContentTab(activeTab) && !html)
  );

  if (vt && transition && !options.skipTransition) {
    vt.paintView(view, html, {
      generation: transition.generation,
      enabled: transition.enabled,
      skipCrossfade,
      mount: root => mountActiveViewHandlers(root, activeTab)
    });
  } else {
    view.innerHTML = html;
    mountActiveViewHandlers(view, activeTab);
    if (vt) vt.completeTransition(transition && transition.generation);
  }
  restoreActiveCanvasYIndex();
}

// Fast path: native Canvas is DOM-only — skip full shell render().
function refreshCanvasNativeView(options = {}) {
  if (options.pointerOnly) {
    const activeTab = typeof getActiveTab === "function" ? getActiveTab() : null
    const view = document.getElementById("view")
    if (view && activeTab) {
      installNativeCoursePointerTracker(view, activeTab)
    }
    return
  }

  const useCrossfade = options.useCrossfade === true || options.skipTransition === false
  const skipTransition = !useCrossfade
  renderWorkspaceViewPartial({
    tabBar: options.tabBar || "patch",
    shell: options.shell || "minimal"
  });
  const vt = getViewTransitionApi();
  const transition = options.transition
    || (!skipTransition && vt ? vt.beginTransition() : null);
  paintActiveView({ transition, skipTransition, fast: options.fast });
  const activeTab = typeof getActiveTab === "function" ? getActiveTab() : null;
  const view = document.getElementById("view");
  if (view && activeTab) {
    installNativeCoursePointerTracker(view, activeTab);
  }
  scheduleNativeCanvasSectionPreload(activeTab);
  if (typeof syncRenderContext === "function") {
    syncRenderContext();
  }
}

function switchWorkspaceTab(nextTabId) {
  const switchGen = bumpTabSurfaceSyncGeneration();
  patchOptimisticWorkspaceTabActive(nextTabId);

  try {
    rememberActiveCanvasYIndex();
    const nextTab = state.tabs.find(item => sameTabId(item.id, nextTabId));
    if (!nextTab) {
      finishTabSurfaceSwitch(switchGen);
      return;
    }

    state.activeTabId = nextTabId;
    state.activeTabByWorkspace[state.activeWorkspaceId] = state.activeTabId;
    if (nextTab.type !== "center" && typeof recordWorkspaceActivity === "function") {
      recordWorkspaceActivity(
        nextTab.workspaceId || state.activeWorkspaceId,
        "tab_open",
        `Opened ${nextTab.label || nextTab.type || "tab"}`,
        { tabId: nextTab.id }
      );
    }
    demoteSiblingWebTabViewTiers(state.activeTabId, state.activeWorkspaceId);
    if (typeof isWebContentTab === "function" && isWebContentTab(nextTab)) {
      nextTab.loading = true;
    } else {
      nextTab.loading = false;
    }
    nextTab.pendingSwitchSlate = !!(
      nextTab.type === "canvastab" && nextTab.canvasMode === "browser"
    );
    nextTab.viewTier = "active";

    if (window.__nucleusTabSnapshot) {
      window.__nucleusTabSnapshot.clear();
    }
    patchWorkspacePageTabs();
    renderWorkspaceViewPartial({ tabBar: "patch", shell: "minimal" });
    beginPendingViewTransition();
    paintActiveView({ fast: true });

    const needsFullTabPush = nextTab.type === "canvastab"
      || nextTab.type === "mailtab"
      || nextTab.type === "synapsetab"
      || nextTab.type === "artifacttab";
    const revealSurface = () => {
      if (typeof revealActiveTabSurface !== "function") return Promise.resolve();
      return revealActiveTabSurface().catch(error => {
        console.error("Unable to reveal active tab surface:", error);
      });
    };

    if (needsFullTabPush && typeof syncTabs === "function") {
      syncTabs({ deferWebViewEnsure: true })
        .then(() => revealSurface())
        .catch(error => {
          console.error("Unable to sync tabs before reveal:", error);
          return revealSurface();
        });
    } else {
      revealSurface();
    }

    if (typeof syncRenderContext === "function") {
      syncRenderContext();
    }
    deferActiveTabSync(switchGen, { surfaceSynced: true });
  } catch (error) {
    console.error("Unable to switch workspace tab:", error);
    const vt = getViewTransitionApi();
    if (vt) vt.cancelTransition();
    finishTabSurfaceSwitch(switchGen);
    const view = document.getElementById("view");
    if (view) {
      paintActiveView({ skipTransition: true });
    }
  }
}

let workspacePageTabsRenderFrame = null;
let workspacePageTabsRenderMode = "patch";

function scheduleRenderWorkspacePageTabs(mode = "patch") {
  workspacePageTabsRenderMode = mode === "full" ? "full" : workspacePageTabsRenderMode;
  if (workspacePageTabsRenderFrame) return;
  workspacePageTabsRenderFrame = requestAnimationFrame(() => {
    workspacePageTabsRenderFrame = null;
    const useFullRebuild = workspacePageTabsRenderMode === "full";
    workspacePageTabsRenderMode = "patch";
    updateWorkspacePageTabs({ tabBar: useFullRebuild ? "full" : "patch" });
  });
}

let lastWorkspaceTabBarSignature = "";

function getWorkspaceTabBarSignature() {
  return getVisibleTabs().map(tab => `${tab.id}:${tab.discarded ? 1 : 0}`).join("|");
}

function updateWorkspacePageTabs(options = {}) {
  const pageTabs = document.getElementById("workspace-page-tabs");
  if (state.top !== "workspace") {
    if (pageTabs) {
      pageTabs.classList.add("is-hidden");
      pageTabs.innerHTML = "";
    }
    lastWorkspaceTabBarSignature = "";
    return;
  }

  const signature = getWorkspaceTabBarSignature();
  const visibleCount = getVisibleTabs().length;
  const needsFullRebuild = options.tabBar === "full"
    || signature !== lastWorkspaceTabBarSignature
    || !pageTabs
    || !pageTabs.querySelector(".workspace-page-tab");

  if (options.tabBar !== "skip") {
    if (needsFullRebuild) {
      renderWorkspacePageTabs();
      lastWorkspaceTabBarSignature = signature;
    } else {
      patchWorkspacePageTabs();
    }
  }
}

// render the workspacepagetabs under the primary tabs ** no container
function renderWorkspacePageTabs() {
  const pageTabs = document.getElementById("workspace-page-tabs");
  if (!pageTabs) return;
  const visibleTabs = getVisibleTabs();

  pageTabs.classList.toggle("is-hidden", state.top !== "workspace");

  // build html only if workspace on top
  pageTabs.innerHTML = state.top === "workspace" ? visibleTabs.map(tab => {
    const displayTitle = getTabDisplayTitle(tab);
    return `
    <button type="button" class="workspace-page-tab ${sameTabId(tab.id, state.activeTabId) ? "active" : ""}${tab.discarded ? " is-discarded" : ""}${tab.loading && sameTabId(tab.id, state.activeTabId) ? " is-loading" : ""}" data-tab-id="${escapeHtml(tab.id)}" title="${escapeHtml(displayTitle)}">
      ${renderWorkspaceTabVisual(tab)}
      <span class="workspace-page-tab-label">${escapeHtml(displayTitle)}</span>
      ${tab.type !== "center" ? `<span class="close-tab" data-close-tab="${escapeHtml(tab.id)}" aria-label="Close tab">×</span>` : ""}
    </button>
  `;
  }).join("") : "";

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
    tabButton.addEventListener("click", event => {
      const closeTarget = event.target.closest("[data-close-tab]");
      if (closeTarget) {
        closeTab(closeTarget.dataset.closeTab);
        return;
      }
      switchWorkspaceTab(tabButton.dataset.tabId);
    });
  });
  lastWorkspaceTabBarSignature = getWorkspaceTabBarSignature();
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
  saveHtmlButton.addEventListener("click", () => {
    if (typeof writeActiveBrowserTabHtml === "function") {
      writeActiveBrowserTabHtml();
    }
  });

  const saveFramesButton = document.createElement("button");
  saveFramesButton.type = "button";
  saveFramesButton.className = "browser-save-html-button";
  saveFramesButton.title = "Save page and iframe HTML";
  saveFramesButton.textContent = "Save Frames";
  saveFramesButton.addEventListener("click", () => {
    if (typeof writeActiveBrowserTabFramesHtml === "function") {
      writeActiveBrowserTabFramesHtml();
    }
  });

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

function isStudyTask(task) {
  return Boolean(
    task && (
      task.type === "canvas-study-task" ||
      (Array.isArray(task.studySections) && task.studySections.length)
    )
  );
}

function renderStudySectionsBlock(task) {
  if (!isStudyTask(task) || !window.StudySections) return "";

  const stats = window.StudySections.getStudyProgressStats(task);
  if (!stats.total) return "";

  if (stats.isComplete) {
    return `<div class="study-sections study-sections--complete">${stats.total} study sections complete</div>`;
  }

  const next = stats.nextSection;
  if (!next) return "";

  return `
    <div class="study-sections">
      <div class="study-sections-header">Section ${stats.completed + 1} of ${stats.total}</div>
      <p class="study-section-next">${escapeHtml(next.label || next.title || "Study session")}</p>
      <button type="button" class="study-section-complete-button" data-complete-study-section="${escapeHtml(task.id)}" data-section-id="${escapeHtml(next.id)}">Mark section done</button>
    </div>
  `;
}

function renderTaskCard(task) {
  const urls = Array.isArray(task.urls) ? task.urls : [];
  const details = truncateTaskText(task.details || "No description provided.");
  const borderColor = getCanvasCourseBorderColor(task);
  const cardStyle = borderColor ? ` style="--task-course-border:${borderColor}"` : "";
  const courseName = getCanvasCourseDisplayName(task);
  const encodedUrls = encodeURIComponent(JSON.stringify(urls));
  const dueText = formatTaskDueDisplay(task.due);
  const studySectionsHtml = renderStudySectionsBlock(task);
  return `
    <article class="task-card" data-id="${escapeHtml(task.id)}" data-task-urls="${escapeHtml(encodedUrls)}"${cardStyle}>
      <div class="task-header">
        <span class="task-course" style="background:${escapeHtml(task.color)}">${escapeHtml(courseName)}</span>
        <span class="task-due">${escapeHtml(dueText)}</span>
      </div>
      <h2>${escapeHtml(task.title)}</h2>
      <p title="${escapeHtml(details)}">${escapeHtml(details)}</p>
      ${studySectionsHtml}
      <div class="task-footer">
        <span>${escapeHtml(task.estimate)}</span>
        <button type="button" class="start-task-button" data-start-task="${escapeHtml(task.id)}">Start task</button>
      </div>
    </article>
  `;
}

function getTasksForCards() {
  const sourceTasks = Array.isArray(tasks) ? tasks : [];
  if (window.TaskOptimizer && typeof window.TaskOptimizer.orderTasks === "function") {
    return window.TaskOptimizer.orderTasks(sourceTasks).map(score => score.task || score);
  }

  return sourceTasks;
}

function dueTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function formatDueDateDDMM(value) {
  const timestamp = dueTimestamp(value);
  if (!Number.isFinite(timestamp)) return "No due date";
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function getDaysTillDue(value) {
  const timestamp = dueTimestamp(value);
  if (!Number.isFinite(timestamp)) return null;
  const due = new Date(timestamp);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((dueDay - today) / msPerDay);
}

function formatTaskDueDisplay(value) {
  const ddmm = formatDueDateDDMM(value);
  const days = getDaysTillDue(value);
  if (days == null) return ddmm;
  if (days < 0) return `${ddmm} • ${Math.abs(days)}d overdue`;
  if (days === 0) return `${ddmm} • due today`;
  if (days === 1) return `${ddmm} • 1 day left`;
  return `${ddmm} • ${days} days left`;
}

function formatHubDue(value) {
  const timestamp = dueTimestamp(value);
  if (!Number.isFinite(timestamp)) return value || "No due date";
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isSameCalendarDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function getTodaysDashboardItems(sourceTasks) {
  const today = new Date();
  return sourceTasks
    .filter(task => {
      const timestamp = dueTimestamp(task.due);
      return Number.isFinite(timestamp) && isSameCalendarDay(new Date(timestamp), today);
    })
    .slice()
    .sort((left, right) => dueTimestamp(left.due) - dueTimestamp(right.due))
    .slice(0, 5);
}

function getContinueWorkingTasks(orderedTasks, unfinishedTabs) {
  const byId = new Map(tasks.map(task => [String(task.id), task]));
  const seen = new Set();
  const openTaskItems = unfinishedTabs
    .map(tab => byId.get(String(tab.taskId || tab.id || "")))
    .filter(Boolean)
    .filter(task => {
      const key = String(task.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (openTaskItems.length) {
    return openTaskItems.slice(0, 4);
  }

  return orderedTasks
    .filter(task => !String(task.status || "").match(/done|complete|finished/i))
    .slice(0, 4);
}

function renderHubEmpty(message) {
  return `<div class="home-empty">${escapeHtml(message)}</div>`;
}

function renderHomeTaskItem(task, index) {
  const courseName = getCanvasCourseDisplayName(task) || task.course || "Task";
  const details = truncateTaskText(task.details || "", 96);
  return `
    <article class="home-list-item home-task-item">
      <div class="home-rank">${index + 1}</div>
      <div class="home-item-main">
        <h3>${escapeHtml(task.title || "Untitled task")}</h3>
        <p>${escapeHtml(details || courseName)}</p>
      </div>
      <div class="home-item-side">
        <span>${escapeHtml(formatHubDue(task.due))}</span>
        <button type="button" class="home-action-button" data-start-task="${escapeHtml(task.id)}">Start</button>
      </div>
    </article>
  `;
}

function tabKindLabel(tab) {
  if (!tab) return "Tab";
  if (tab.type === "canvastab") return tab.canvasMode === "browser" ? "Canvas page" : "Canvas";
  if (tab.type === "synapsetab") return "Synapse";
  if (tab.type === "mailtab") return "Mail";
  if (tab.type === "artifacttab") return "Artifact";
  if (tab.type === "browsertab") return "Browser";
  if (tab.type === "task") return "Task";
  return "Workspace";
}

function renderHomeTabItem(tab) {
  return `
    <button type="button" class="home-list-item home-tab-item" data-home-tab="${escapeHtml(tab.id)}">
      <div class="home-item-main">
        <h3>${escapeHtml(tab.label || tabKindLabel(tab))}</h3>
        <p>${escapeHtml(tab.url || tabKindLabel(tab))}</p>
      </div>
      <span class="home-pill">${escapeHtml(tabKindLabel(tab))}</span>
    </button>
  `;
}

function renderHomeWorkspaceItem(workspace) {
  const workspaceTasks = getWorkspaceTasks(workspace.id);
  const openTabs = state.tabs.filter(tab => tab.workspaceId === workspace.id && tab.type !== "center");
  return `
    <button type="button" class="home-list-item home-workspace-item" data-home-workspace="${escapeHtml(workspace.id)}">
      <div class="home-item-main">
        <h3>${escapeHtml(workspace.name || workspace.id)}</h3>
        <p>${escapeHtml(workspace.description || `${workspaceTasks.length} tasks`)}</p>
      </div>
      <span class="home-pill">${openTabs.length} tabs</span>
    </button>
  `;
}

function renderHomeCalendarItem(task, index) {
  const courseName = getCanvasCourseDisplayName(task) || task.course || "Calendar";
  return `
    <article class="home-list-item home-calendar-item">
      <div class="home-calendar-dot">${index + 1}</div>
      <div class="home-item-main">
        <h3>${escapeHtml(task.title || "Untitled event")}</h3>
        <p>${escapeHtml(courseName)}</p>
      </div>
      <span class="home-pill">${escapeHtml(formatHubDue(task.due))}</span>
    </article>
  `;
}

function getDashboardUpdates(priorityTasks, continueTasks, todaysItems, unfinishedTabs) {
  const updates = [];
  if (todaysItems.length) {
    updates.push({
      tone: "blue",
      title: `${todaysItems.length} item${todaysItems.length === 1 ? "" : "s"} on today's calendar`,
      detail: todaysItems[0].title || "Open calendar"
    });
  }
  if (priorityTasks.length) {
    updates.push({
      tone: "purple",
      title: "Top priority queue refreshed",
      detail: priorityTasks[0].title || "Review priority tasks"
    });
  }
  if (continueTasks.length) {
    updates.push({
      tone: "teal",
      title: "Continue working list ready",
      detail: continueTasks[0].title || "Pick up where you left off"
    });
  }
  if (unfinishedTabs.length) {
    updates.push({
      tone: "amber",
      title: `${unfinishedTabs.length} unfinished tab${unfinishedTabs.length === 1 ? "" : "s"}`,
      detail: unfinishedTabs[0].label || unfinishedTabs[0].url || "Workspace tabs"
    });
  }

  return updates.slice(0, 5);
}

function renderHomeUpdateItem(update) {
  return `
    <article class="home-list-item home-update-item">
      <span class="home-update-dot home-update-${escapeHtml(update.tone)}"></span>
      <div class="home-item-main">
        <h3>${escapeHtml(update.title)}</h3>
        <p>${escapeHtml(update.detail)}</p>
      </div>
    </article>
  `;
}

function renderHomeDashboard() {
  const orderedTasks = getTasksForCards();
  const priorityTasks = orderedTasks.slice(0, 5);
  const unfinishedTabs = state.tabs
    .filter(tab => tab.type !== "center")
    .slice(-6)
    .reverse();
  const continueTasks = getContinueWorkingTasks(orderedTasks, unfinishedTabs);
  const todaysItems = getTodaysDashboardItems(tasks);
  const activeWorkspace = getWorkspace(getBrowserWorkspaceId());
  const recentWorkspaces = (Array.isArray(workspaces) ? workspaces : [])
    .filter(workspace => !activeWorkspace || workspace.id !== activeWorkspace.id)
    .slice(-5)
    .reverse();
  const dashboardUpdates = getDashboardUpdates(priorityTasks, continueTasks, todaysItems, unfinishedTabs);
  const totalTasks = tasks.length;
  const highPriorityCount = priorityTasks.length;
  const openTabCount = unfinishedTabs.length;
  const todaysCount = todaysItems.length;
  const focusScore = totalTasks ? Math.max(30, Math.min(98, 100 - Math.max(0, totalTasks - highPriorityCount) * 4)) : 100;

  return `
    <header class="home-header">
      <div>
        <h1>${getGreeting()}</h1>
        <p>Your work hub for tasks, tabs, events, and active spaces.</p>
      </div>
      <div class="home-header-actions">
        <button type="button" class="home-primary-action" data-open-section="tasks">New focus</button>
        <button type="button" class="home-secondary-action" data-open-section="calendar">Calendar</button>
      </div>
    </header>

    <section class="home-stats" aria-label="Dashboard summary">
      <article class="home-stat-card">
        <span class="home-stat-orb home-stat-purple"></span>
        <div><strong>${totalTasks}</strong><span>Tasks today</span></div>
      </article>
      <article class="home-stat-card">
        <span class="home-stat-orb home-stat-blue"></span>
        <div><strong>${openTabCount}</strong><span>Unfinished tabs</span></div>
      </article>
      <article class="home-stat-card">
        <span class="home-stat-orb home-stat-amber"></span>
        <div><strong>${todaysCount}</strong><span>Today calendar</span></div>
      </article>
      <article class="home-stat-card">
        <span class="home-stat-orb home-stat-teal"></span>
        <div><strong>${focusScore}%</strong><span>Focus score</span></div>
      </article>
    </section>

    <section class="home-dashboard">
      <article class="home-panel home-panel-large home-priority-panel">
        <div class="home-panel-heading">
          <h2>Top priority new tasks</h2>
          <span>${priorityTasks.length}</span>
        </div>
        <div class="home-list">
          ${priorityTasks.length ? priorityTasks.map(renderHomeTaskItem).join("") : renderHubEmpty("No priority tasks yet.")}
        </div>
      </article>

      <article class="home-panel home-continue-panel">
        <div class="home-panel-heading">
          <h2>Continue working</h2>
          <span>${continueTasks.length}</span>
        </div>
        <div class="home-list">
          ${continueTasks.length ? continueTasks.map(renderHomeTaskItem).join("") : renderHubEmpty("Nothing in progress yet.")}
        </div>
      </article>

      <article class="home-panel home-calendar-panel">
        <div class="home-panel-heading">
          <h2>Today's calendar</h2>
          <span>${todaysItems.length}</span>
        </div>
        <div class="home-list">
          ${todaysItems.length ? todaysItems.map(renderHomeCalendarItem).join("") : renderHubEmpty("No events or tasks due today.")}
        </div>
      </article>

      <article class="home-panel home-recent-panel">
        <div class="home-panel-heading">
          <h2>Recent workspaces</h2>
          <span>${recentWorkspaces.length}</span>
        </div>
        <div class="home-list">
          ${recentWorkspaces.length ? recentWorkspaces.map(renderHomeWorkspaceItem).join("") : renderHubEmpty("No other workspaces yet.")}
        </div>
      </article>

      <article class="home-panel home-updates-panel">
        <div class="home-panel-heading">
          <h2>Notifications/updates</h2>
          <span>${dashboardUpdates.length}</span>
        </div>
        <div class="home-list">
          ${dashboardUpdates.length ? dashboardUpdates.map(renderHomeUpdateItem).join("") : renderHubEmpty("No updates right now.")}
        </div>
      </article>
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
      <p role="status">Calendar is not available yet. Weekly schedules live in each Canvas course for now.</p>
    </header>
    <section class="workspace-panel" aria-labelledby="calendar-coming-soon-title">
      <div>
        <h2 id="calendar-coming-soon-title">Coming soon</h2>
        <p>A unified calendar across Canvas assignments, mail events, and tasks is planned for a future release.</p>
      </div>
    </section>
  `;
}

function renderWorkspaceApps() {
  const apps = [
    { name: "Canvas", open: "data-open-canvas-app", iconClass: "canvas-app-icon", icon: "app/canvas/assets/canvas_icon.png" },
    { name: "Synapse", open: "data-open-synapse-app", iconClass: "synapse-app-icon", icon: "app/synapse/assets/synapse_icon.png" },
    { name: "Mail", open: "data-open-mail-app", iconClass: "mail-app-icon", icon: "app/mail/assets/mail_icon.svg" }
  ];

  return `
    <section class="project-section">
      <div class="section-heading">
        <h2>Apps</h2>
        <span>${apps.length}</span>
      </div>
      <div class="app-grid">
        ${apps.map(app => `
          <article class="app-launch-card" ${app.open}="true" tabindex="0" role="button" aria-label="Open ${escapeHtml(app.name)}">
            <div class="app-icon ${escapeHtml(app.iconClass)}" aria-hidden="true">
              <img src="${escapeHtml(app.icon)}" alt="">
            </div>
            <span class="app-name">${escapeHtml(app.name)}</span>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

// ???
function renderTaskWorkspace(tab) {
  const task = tasks.find(item => item.id === tab.taskId);
  if (!task) return renderWorkspaceControlCenter(getWorkspace(state.activeWorkspaceId));
  const courseName = getCanvasCourseDisplayName(task);
  const dueText = formatTaskDueDisplay(task.due);

  return `
    <header>
      <h1>${escapeHtml(task.title)}</h1>
      <p>${escapeHtml(courseName)} / ${escapeHtml(dueText)} / ${escapeHtml(task.estimate)}</p>
    </header>

    <section class="workspace-panel">
      <div>
        <h2>Workspace</h2>
        <p>${escapeHtml(task.details)}</p>
      </div>
      <button type="button" class="start-task-button" data-start-task="${escapeHtml(task.id)}">Begin work</button>
    </section>
  `;
}

// renders the inner view (everything that's not the paneels)
function renderView() {
  paintActiveView();
}

function mountActiveViewHandlers(view, activeTab) {
  if (!view) return;

  const onNativeCoursePage = activeTab
    && activeTab.type === "canvastab"
    && activeTab.canvasMode !== "browser"
    && activeTab.courseId
    && view.querySelector(".course-page");
  if (!onNativeCoursePage) {
    teardownNativeCoursePointerTracker();
  }

  view.querySelectorAll("[data-start-task]").forEach(button => {
    button.addEventListener("click", () => startTask(button.dataset.startTask));
  });

  view.querySelectorAll("[data-complete-study-section]").forEach(button => {
    button.addEventListener("click", async event => {
      event.stopPropagation();
      if (!window.nucleus || typeof window.nucleus.updateStudySectionProgress !== "function") return;
      const taskId = button.dataset.completeStudySection;
      const sectionId = button.dataset.sectionId;
      if (!taskId || !sectionId) return;
      button.disabled = true;
      try {
        await window.nucleus.updateStudySectionProgress({ taskId, sectionId, status: "done" });
      } finally {
        button.disabled = false;
      }
    });
  });

  view.querySelectorAll("[data-open-section]").forEach(button => {
    button.addEventListener("click", () => setActiveSection(button.dataset.openSection));
  });

  if (typeof mountWorkspaceControlCenterHandlers === "function") {
    mountWorkspaceControlCenterHandlers(view);
  }

  view.querySelectorAll("[data-artifact-download]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!window.nucleus || typeof window.nucleus.downloadArtifact !== "function") return;
      const artifactId = button.dataset.artifactDownload;
      if (!artifactId) return;
      await window.nucleus.downloadArtifact({ id: artifactId });
    });
  });

  view.querySelectorAll("[data-artifact-open-lumi]").forEach(button => {
    button.addEventListener("click", async () => {
      const artifactId = button.dataset.artifactOpenLumi;
      if (!artifactId || !window.nucleus || typeof window.nucleus.getArtifact !== "function") return;
      const result = await window.nucleus.getArtifact({ id: artifactId });
      if (!result || !result.ok || !result.artifact) return;
      if (window.nucleusArtifacts && typeof window.nucleusArtifacts.showLumiPreview === "function") {
        await window.nucleusArtifacts.showLumiPreview(result.artifact);
      }
    });
  });

  view.querySelectorAll("[data-artifact-open-window]").forEach(button => {
    button.addEventListener("click", async () => {
      const artifactId = button.dataset.artifactOpenWindow;
      if (!artifactId || !window.nucleus || typeof window.nucleus.openArtifactExternal !== "function") return;
      await window.nucleus.openArtifactExternal({ id: artifactId });
    });
  });

  if (activeTab && activeTab.type === "artifacttab" && window.nucleusArtifactTabs) {
    window.nucleusArtifactTabs.mountArtifactTabPreview(view).catch(error => {
      console.error("Unable to mount artifact tab preview:", error);
    });
  }

  view.querySelectorAll("[data-home-workspace]").forEach(button => {
    button.addEventListener("click", () => setActiveWorkspace(button.dataset.homeWorkspace));
  });

  view.querySelectorAll("[data-home-tab]").forEach(button => {
    button.addEventListener("click", async () => {
      const tab = state.tabs.find(item => sameTabId(item.id, button.dataset.homeTab));
      if (!tab) return;
      rememberActiveCanvasYIndex();
      state.top = "workspace";
      state.activeWorkspaceId = tab.workspaceId;
      state.activeTabId = tab.id;
      state.activeTabByWorkspace[tab.workspaceId] = tab.id;
      await syncActiveTab();
      render();
    });
  });

  view.querySelectorAll("[data-back-to-home], [data-back-to-projects]").forEach(button => {
    button.addEventListener("click", () => {
      state.activeCourseId = null;
      state.activeSection = "home";
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
        refreshCanvasNativeView();
        queueTabSyncAfterRender();
      }
    });
  });

  view.querySelectorAll("[data-course-section]").forEach(button => {
    button.addEventListener("click", () => {
      const tab = getActiveTab();
      if (!tab || tab.type !== "canvastab" || tab.canvasMode === "browser") return;
      const section = button.dataset.courseSection;
      if (!["homepage", "assignments", "weekly", "modules", "files"].includes(section)) return;
      rememberActiveCanvasYIndex();
      tab.courseSection = section;
      tab.yindex = 0;
      const viewEl = document.getElementById("view");
      if (!patchCanvasCourseSection(viewEl, tab, section)) {
        refreshCanvasNativeView();
      } else {
        scheduleNativeCanvasSectionPreload(tab);
      }
      queueTabSyncAfterRender();
    });
  });

  view.querySelectorAll("[data-open-canvas-app]").forEach(card => {
    const openCanvas = () => openCanvasAppTab(getBrowserWorkspaceId());
    card.addEventListener("click", () => openCanvas());
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCanvas();
      }
    });
  });

  view.querySelectorAll("[data-canvas-course-id]").forEach(card => {
    const openCourse = () => {
      const targetCourseId = card.dataset.canvasCourseId;
      navigateCanvasNative(targetCourseId, { courseSection: "homepage" });
    };
    card.addEventListener("click", openCourse);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCourse();
      }
    });
  });

  if (window.nucleusCanvasCourseImages && typeof window.nucleusCanvasCourseImages.hydrateAll === "function") {
    window.nucleusCanvasCourseImages.hydrateAll(view).catch(error => {
      console.warn("Canvas course image hydration failed:", error);
    });
  }

  view.querySelectorAll("[data-open-mail-app]").forEach(card => {
    const openMail = () => openMailAppTab(getBrowserWorkspaceId());
    card.addEventListener("click", () => activateAppIcon(card, openMail));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateAppIcon(card, openMail);
      }
    });
  });

  // --- Synapse handlers ---
  view.querySelectorAll("[data-open-synapse-app]").forEach(card => {
    const openSynapse = () => openSynapseAppTab(getBrowserWorkspaceId());
    card.addEventListener("click", () => activateAppIcon(card, openSynapse));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateAppIcon(card, openSynapse); }
    });
  });

  view.querySelectorAll("[data-synapse-toggle-sidebar]").forEach(button => {
    button.addEventListener("click", () => {
      const activeTab = getActiveTab();
      if (activeTab && activeTab.type === "synapsetab") {
        activeTab.synapseSidebarCollapsed = !activeTab.synapseSidebarCollapsed;
        syncTabs();
        render();
      }
    });
  });

  view.querySelectorAll("[data-synapse-learn-course-open]").forEach(button => {
    const openLearn = () => openSynapseLearnTab(getBrowserWorkspaceId());
    button.addEventListener("click", openLearn);
    button.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openLearn(); }
    });
  });

  view.querySelectorAll("[data-synapse-new-conversation]").forEach(card => {
    const open = () => {
      const activeTab = getActiveTab();
      const convo = createSynapseConversation();
      if (activeTab && activeTab.type === "synapsetab") {
        activeTab.conversationId = convo.id;
        activeTab.synapseMode = "chat";
        activeTab.label = "Synapse";
        activeTab.learnSession = null;
        syncTabs();
        render();
      } else {
        openSynapseAppTab(getBrowserWorkspaceId(), convo.id);
      }
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });

  view.querySelectorAll(".synapse-conversation-card[data-synapse-conversation-id]").forEach(card => {
    const open = () => {
      const id = card.dataset.synapseConversationId;
      const activeTab = getActiveTab();
      if (activeTab && activeTab.type === "synapsetab") {
        activeTab.conversationId = id;
        activeTab.synapseMode = "chat";
        activeTab.label = "Synapse";
        activeTab.learnSession = null;
        syncTabs();
        render();
      } else {
        openSynapseAppTab(getBrowserWorkspaceId(), id);
      }
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });

  mountCanvasCourseLinkHandlers(view);

  // Mount/teardown the Synapse streaming chat controller for this view.
  mountSynapseControllerIfNeeded(view, activeTab);
  if (window.nucleusMailApp && typeof window.nucleusMailApp.mountMailControllerIfNeeded === "function") {
    window.nucleusMailApp.mountMailControllerIfNeeded(view, activeTab);
  }
  if (typeof syncMailWatchLifecycle === "function") {
    syncMailWatchLifecycle().catch(error => {
      console.warn("Unable to sync mail watch lifecycle:", error);
    });
  }
}

// renders whole page
function render(options = {}) {
  const reason = options.reason || options.via || "unspecified";
  const diag = window.__nucleusDiag;
  if (diag && diag.isEnabled("render")) {
    diag.logRender("cycle_start", { reason, ui: diag.summarizeUiState() });
  }
  renderWorkspaceSidebarCollapseState();
  renderPrimaryTabs();
  renderWorkspaceTabs();
  updateWorkspacePageTabs(options);
  renderBrowserToolbar();
  renderCanvasToolbar();

  const vt = getViewTransitionApi();
  let transition = null;
  if (vt && !options.skipTransition) {
    transition = vt.consumeActiveTransition();
    if (!transition && vt.isSmoothTabsEnabled()) {
      transition = vt.beginTransition();
    }
  }
  paintActiveView({ transition, skipTransition: options.skipTransition });

  if (typeof syncRenderContext === "function") {
    syncRenderContext();
  }
  if (diag && diag.isEnabled("render")) {
    diag.logRender("cycle_end", { reason });
  }
}
