// Renderer workspace/tab controller.
// Functionality: mutates browser/task/Canvas tab state, syncs tab state to the
// Electron main process, and handles Canvas native/browser mode transitions.
// Dependencies: renderer/app.js owns state/workspaces, renderer/render.js draws
// the UI, and preload.js window.nucleus forwards tab IPC.
// ----------------WORKSPACEPAGETABS
//----navigation

// Navigates the activeBrowserTab to url in value
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

// Send signal to main, ActiveBrowserTab returns to previous page
function goBackActiveBrowserTab() {
  const activeTab = getActiveBrowserTab();
  if (!activeTab) return;
  window.nucleus.backBrowserTab(activeTab.id);
}

// Unified hybrid back stack (main process) — native + web, with preload-slot back cache.
async function finishNativeCanvasSurfaceReveal(activeTab, options = {}) {
  const vt = window.nucleusViewTransition;
  const transition = options.transition || (vt ? vt.beginTransition() : null);
  if (typeof refreshCanvasNativeView === "function") {
    refreshCanvasNativeView({
      skipTransition: false,
      useCrossfade: true,
      transition,
      tabBar: options.tabBar || "patch"
    });
  } else if (typeof render === "function") {
    render();
  }

  const crossfadeMs = vt && typeof vt.readMotionMs === "function" ? vt.readMotionMs() : 80;
  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTimeout(resolve, crossfadeMs));
    });
  });

  if (window.nucleus && typeof window.nucleus.revealCanvasNative === "function") {
    try {
      await window.nucleus.revealCanvasNative({
        tabId: activeTab && activeTab.id ? activeTab.id : state.activeTabId
      });
    } catch (error) {
      console.error("Unable to reveal native canvas surface:", error);
    }
  }
}

async function goBackActiveCanvasTab() {
  const activeTab = getActiveCanvasTab();
  if (!activeTab) return;

  const result = await window.nucleus.backCanvasTab(activeTab.id);
  if (!result || !result.ok || !result.wentBack) return;

  if (result.tab) {
    activeTab.canvasMode = result.tab.canvasMode;
    activeTab.url = result.tab.url || '';
    activeTab.canvasNativePage = result.tab.canvasNativePage;
    activeTab.courseId = result.tab.courseId;
    activeTab.courseSection = result.tab.courseSection;
    activeTab.yindex = result.tab.yindex;
    activeTab.loading = Boolean(result.tab.loading);
  } else if (result.url) {
    activeTab.url = result.url;
  }

  if (result.kind === 'native' || result.restoreNative) {
    activeTab.canvasMode = 'native';
    activeTab.url = '';
    activeTab.loading = Boolean(result.tab && result.tab.loading);
    if (result.needsNativeReveal) {
      await finishNativeCanvasSurfaceReveal(activeTab, { tabBar: 'patch' });
    } else if (typeof refreshCanvasNativeView === 'function') {
      refreshCanvasNativeView({ skipTransition: true, tabBar: 'patch' });
    } else {
      render();
    }
  } else {
    activeTab.canvasMode = 'browser';
    if (typeof renderCanvasToolbar === 'function') {
      renderCanvasToolbar();
    }
    if (typeof paintActiveView === 'function') {
      paintActiveView({ skipTransition: true, fast: true });
    }
  }

  queueTabSyncAfterRender();
}

// ------Mutation

// closes tab by tabID
function closeTab(tabId) {
  rememberActiveCanvasYIndex();
  const tab = state.tabs.find(item => sameTabId(item.id, tabId));
  if (!tab || tab.type === "center") return;

  const visibleTabs = getVisibleTabs();
  const index = visibleTabs.findIndex(item => sameTabId(item.id, tabId));

  state.tabs = state.tabs.filter(item => !sameTabId(item.id, tabId));

  //if closed tab is the active tab, set activetab to either the next tab in the list or fallback to the previous tab in the list
  if (sameTabId(state.activeTabId, tabId)) {
    const nextTab = visibleTabs[index] || visibleTabs[index - 1];
    state.activeTabId = nextTab && !sameTabId(nextTab.id, tabId)
      ? nextTab.id
      : ensureWorkspaceCenter(state.activeWorkspaceId);
  }

  state.activeTabByWorkspace[state.activeWorkspaceId] = state.activeTabId;

  render();
  queueTabSyncAfterRender();
}

//----helpers

// Ensure workspace with workspaceId has a centertab, if not make one
function ensureWorkspaceCenter(workspaceId) {
  const tabId = `center:${workspaceId}`;
  if (!state.tabs.some(tab => sameTabId(tab.id, tabId))) {
    state.tabs.push({
      id: tabId,
      type: "center",
      workspaceId,
      label: "Control Center"
    });
  }
  return tabId;
}

//ensure that each workspace has a center, if not add
function ensureWorkspaceCenters() {
  workspaces.forEach(workspace => ensureWorkspaceCenter(workspace.id));
}

// compare tab ids
function sameTabId(left, right) {
  return String(left) === String(right);
}

function hasNucleusBridge() {
  return Boolean(window.nucleus);
}

let lastTabPushFingerprint = "";
let tabSyncCoalesceScheduled = false;
let tabSyncCoalescePending = false;

function buildTabPushFingerprint() {
  return JSON.stringify({
    activeTabId: state.activeTabId || "",
    top: state.top || "",
    activeWorkspaceId: state.activeWorkspaceId || "",
    tabs: state.tabs.map(tab => ({
      id: String(tab.id || ""),
      type: tab.type || "",
      url: tab.url || "",
      canvasMode: tab.canvasMode || "",
      workspaceId: tab.workspaceId || "",
      discarded: Boolean(tab.discarded),
      courseId: tab.courseId || "",
      canvasNativePage: tab.canvasNativePage || "",
      courseSection: tab.courseSection || ""
    }))
  });
}

// push tab changes in renderer to main
async function syncTabs(options = {}) {
  if (!hasNucleusBridge() || typeof window.nucleus.tabschanged !== "function") {
    return { ok: false, skipped: true, reason: "missing_bridge" };
  }

  const fingerprint = buildTabPushFingerprint();
  if (fingerprint === lastTabPushFingerprint && !options.force) {
    return { ok: true, skipped: true, reason: "unchanged" };
  }

  const diag = window.__nucleusDiag;
  const started = performance.now();
  if (diag && diag.isEnabled("ipc")) {
    diag.logIpc("renderer", "tabs:push", {
      phase: "start",
      tabCount: state.tabs.length,
      activeTabId: state.activeTabId || "",
      deferWebViewEnsure: Boolean(options.deferWebViewEnsure)
    });
  }
  await window.nucleus.tabschanged(state.tabs, state.activeTabId, options);
  lastTabPushFingerprint = fingerprint;
  if (diag && diag.isEnabled("ipc")) {
    diag.logIpc("renderer", "tabs:push", {
      phase: "done",
      durationMs: Math.round(performance.now() - started)
    });
  }
  return { ok: true, skipped: false };
}

function syncActiveTab() {
  if (!hasNucleusBridge() || typeof window.nucleus.newactivetab !== "function") {
    return Promise.resolve({ ok: false, skipped: true, reason: "missing_bridge" });
  }

  const diag = window.__nucleusDiag;
  const activeTab = getActiveTab();
  const payload = state.top === "workspace" && activeTab && (isWebContentTab(activeTab) || isNativeAppTab(activeTab))
    ? activeTab
    : "None";
  if (diag && diag.isEnabled("ipc")) {
    diag.logIpc("renderer", "tabs:new_active", {
      tabId: payload === "None" ? "None" : String(payload.id || ""),
      tabType: payload === "None" ? "None" : String(payload.type || "")
    });
  }
  if (payload === "None") {
    return window.nucleus.newactivetab("None");
  }
  return window.nucleus.newactivetab(buildMainTabSyncPayload(payload));
}

async function syncActiveTabSwitch() {
  return revealActiveTabSurface();
}

function revealActiveTabSurface() {
  if (!hasNucleusBridge() || typeof window.nucleus.switchActiveTab !== "function") {
    return Promise.resolve({ ok: false, skipped: true, reason: "missing_bridge" });
  }

  const activeTab = getActiveTab();
  const tabPayload = state.top === "workspace" && activeTab && (isWebContentTab(activeTab) || isNativeAppTab(activeTab))
    ? buildMainTabSyncPayload(activeTab)
    : "None";

  const diag = window.__nucleusDiag;
  const started = performance.now();
  if (diag && diag.isEnabled("ipc")) {
    diag.logIpc("renderer", "tabs:switch_active", {
      phase: "start",
      tabId: tabPayload === "None" ? "None" : String(tabPayload.id || "")
    });
  }

  return window.nucleus.switchActiveTab({
    tab: tabPayload,
    activeTabId: state.activeTabId || ""
  }).then(result => {
    if (diag && diag.isEnabled("ipc")) {
      diag.logIpc("renderer", "tabs:switch_active", {
        phase: "done",
        durationMs: Math.round(performance.now() - started),
        needsFullPush: Boolean(result && result.needsFullPush)
      });
    }
    if (result && result.needsFullPush) {
      return syncTabs().then(() => syncActiveTab());
    }
    return result || { ok: true };
  }).catch(error => {
    console.error("tabs:switch_active failed, falling back to tabs:push:", error);
    return syncTabs().then(() => syncActiveTab());
  });
}

function deferBackgroundTabSync(switchGen, options = {}) {
  const expectedTabId = state.activeTabId;
  Promise.resolve(syncTabs(options.surfaceSynced ? { deferWebViewEnsure: true } : {})).then(() => {
    if (!isTabSurfaceSyncCurrent(switchGen)) return;
    if (!sameTabId(state.activeTabId, expectedTabId)) return;
    return syncActiveTab();
  }).catch(error => {
    console.error("Unable to sync tabs after switch:", error);
  });
}

function queueTabSyncAfterRender(options = {}) {
  tabSyncCoalescePending = true;
  if (tabSyncCoalesceScheduled) return;
  tabSyncCoalesceScheduled = true;
  Promise.resolve().then(async () => {
    tabSyncCoalesceScheduled = false;
    if (!tabSyncCoalescePending) return;
    tabSyncCoalescePending = false;
    try {
      await syncTabs();
      if (options.activeOnly) return;
      await syncActiveTab();
    } catch (error) {
      console.error("Unable to sync tabs after render:", error);
    }
  });
}

let tabSurfaceSyncGeneration = 0;

function bumpTabSurfaceSyncGeneration() {
  tabSurfaceSyncGeneration += 1;
  return tabSurfaceSyncGeneration;
}

function isTabSurfaceSyncCurrent(gen) {
  return gen === tabSurfaceSyncGeneration;
}

function finishTabSurfaceSwitch(gen) {
  if (!isTabSurfaceSyncCurrent(gen)) return;
  if (typeof setViewSwitching === "function") {
    setViewSwitching(false);
  }
}

function deferActiveTabSync(switchGen, options = {}) {
  if (!hasNucleusBridge()) {
    finishTabSurfaceSwitch(switchGen);
    return;
  }
  if (!isTabSurfaceSyncCurrent(switchGen)) return;
  const expectedTabId = state.activeTabId;

  deferBackgroundTabSync(switchGen, options);

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      if (!isTabSurfaceSyncCurrent(switchGen)) return;
      if (!sameTabId(state.activeTabId, expectedTabId)) return;
      finishTabSurfaceSwitch(switchGen);
    });
  } else {
    finishTabSurfaceSwitch(switchGen);
  }
}

function deferWorkspaceSurfaceSync(switchGen) {
  if (!hasNucleusBridge()) {
    finishTabSurfaceSwitch(switchGen);
    return;
  }
  if (!isTabSurfaceSyncCurrent(switchGen)) return;
  const expectedTabId = state.activeTabId;
  const expectedWorkspaceId = state.activeWorkspaceId;

  Promise.resolve(syncTabs()).then(() => {
    if (!isTabSurfaceSyncCurrent(switchGen)) return;
    if (!sameTabId(state.activeTabId, expectedTabId)) return;
    if (state.activeWorkspaceId !== expectedWorkspaceId) return;
    return syncActiveTab();
  }).then(() => {
    if (!isTabSurfaceSyncCurrent(switchGen)) return;
    if (!sameTabId(state.activeTabId, expectedTabId)) return;
    if (state.activeWorkspaceId !== expectedWorkspaceId) return;
    finishTabSurfaceSwitch(switchGen);
  }).catch(error => {
    console.error("Unable to sync workspace surface after switch:", error);
    if (isTabSurfaceSyncCurrent(switchGen)) finishTabSurfaceSwitch(switchGen);
  });

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      if (!isTabSurfaceSyncCurrent(switchGen)) return;
      if (!sameTabId(state.activeTabId, expectedTabId)) return;
      if (state.activeWorkspaceId !== expectedWorkspaceId) return;
      finishTabSurfaceSwitch(switchGen);
    });
  }
}

async function syncWorkspaceSurface() {
  await syncTabs();
  await syncActiveTab();
}

// get the activeTab
function getActiveTab() {
  return state.tabs.find(tab => sameTabId(tab.id, state.activeTabId)) || null;
}

function hasActiveWorkspace() {
  return state.top === "workspace"
    && !!state.activeWorkspaceId
    && workspaces.some(workspace => workspace.id === state.activeWorkspaceId);
}

// is this tab webcontent type (browsertab, canvastab)
function isWebContentTab(tab) {
  return tab && (tab.type === "browsertab" || (tab.type === "canvastab" && tab.canvasMode === "browser"));
}

// does this tab need to have a browsertoolbar (browsertab)
function isBrowserToolbarTab(tab) {
  return tab && tab.type === "browsertab";
}

// return the activetab if workspace is on top and activetab in opened workspace is a webcontenttab (browsertab, canvastab)
function getActiveWebContentTab() {
  const activeTab = getActiveTab();
  if (state.top === "workspace" && isWebContentTab(activeTab)) {
    return activeTab;
  }
  return null;
}

// return the activetab if workspace is on top and activetab needs a browsertoolbar (browsertab)
function getActiveBrowserTab() {
  const activeTab = getActiveTab();
  if (state.top === "workspace" && isBrowserToolbarTab(activeTab)) {
    return activeTab;
  }
  return null;
}

// return the activetab if workspace is on top and activetab is a canvastab
function getActiveCanvasTab() {
  const activeTab = getActiveTab();
  if (state.top === "workspace" && activeTab && activeTab.type === "canvastab" && activeTab.canvasMode === "browser") {
    return activeTab;
  }
  return null;
}

function isNativeAppTab(tab) {
  return tab && (
    tab.type === "mailtab" ||
    tab.type === "synapsetab" ||
    tab.type === "artifacttab" ||
    (tab.type === "canvastab" && tab.canvasMode !== "browser")
  );
}

function getMainScrollContainer() {
  return document.querySelector(".content");
}

function rememberActiveCanvasYIndex() {
  const activeTab = getActiveTab();
  if (!activeTab || activeTab.type !== "canvastab" || activeTab.canvasMode === "browser") return;

  const container = getMainScrollContainer();
  activeTab.yindex = container ? container.scrollTop : 0;
}

function restoreActiveCanvasYIndex() {
  const activeTab = getActiveTab();
  if (!activeTab || activeTab.type !== "canvastab" || activeTab.canvasMode === "browser") return;

  const container = getMainScrollContainer();
  if (!container) return;

  const yindex = Number(activeTab.yindex || 0);
  requestAnimationFrame(() => {
    container.scrollTop = Number.isFinite(yindex) ? yindex : 0;
  });
}

// remember current active tab for this workspace
function rememberActiveWorkspaceTab() {
  rememberActiveCanvasYIndex();
  if (state.top !== "workspace" || !state.activeWorkspaceId || !state.activeTabId) return;
  state.activeTabByWorkspace[state.activeWorkspaceId] = state.activeTabId;
}

// get the last active tab for a workspace by workspace id
function getRememberedWorkspaceTabId(workspaceId) {
  const rememberedTabId = state.activeTabByWorkspace[workspaceId];
  if (rememberedTabId && state.tabs.some(tab => tab.workspaceId === workspaceId && sameTabId(tab.id, rememberedTabId))) {
    return rememberedTabId;
  }
  return ensureWorkspaceCenter(workspaceId);
}

// make a new webcontenttab specifying url, workspace, whether it should be active, injection css, and type(browsertab, canvastab)
async function newWebContentTab(url, workspaceId, setactive = false, injection = null, type = "browsertab") {
  const needsEngineUrl = !url && type === "browsertab" && window.nucleus && window.nucleus.getEngineUrl;
  const prefix = type === "canvastab" ? "canvas" : "browser";
  const newtab = {
    id: `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    type,
    canvasMode: type === "canvastab" ? "browser" : undefined,
    canvasNativePage: type === "canvastab" ? "dashboard" : undefined,
    nativeHistory: type === "canvastab" ? [] : undefined,
    workspaceId,
    label: "New Tab",
    pageTitle: "",
    url: url || "",
    injection,
    yindex: type === "canvastab" ? 0 : undefined,
    loading: type === "canvastab"
  }
  state.tabs.push(newtab);
  if (setactive) {
    rememberActiveWorkspaceTab();
    state.top = 'workspace';
    state.activeWorkspaceId = workspaceId;
    state.activeTabId = newtab.id;
    state.activeTabByWorkspace[workspaceId] = newtab.id;
    render();
  }

  const finishTabSync = async () => {
    if (needsEngineUrl) {
      newtab.url = await window.nucleus.getEngineUrl();
    }
    await syncTabs();
    if (setactive) {
      await syncActiveTab();
      render();
    }
  };

  if (setactive) {
    finishTabSync().catch(error => {
      console.error("Unable to finish opening web content tab:", error);
    });
  } else {
    await finishTabSync();
  }
  return { ok: true, tabId: newtab.id };
}

function isCanvasNativeTab(tab) {
  return tab && tab.type === "canvastab" && tab.canvasMode !== "browser";
}

function isCanvasBrowserTab(tab) {
  return tab && tab.type === "canvastab" && tab.canvasMode === "browser";
}

// open new browser tab
async function newbrowsertab(url = null, workspaceId, setactive = false, injection = null) {
  return newWebContentTab(url, workspaceId, setactive, injection, "browsertab");
}

function handleWorkspaceTabShortcut(event) {
  if (!event.ctrlKey || event.metaKey || event.altKey || !hasActiveWorkspace()) return;

  const key = event.key.toLowerCase();
  if (key === "t") {
    event.preventDefault();
    newbrowsertab(null, state.activeWorkspaceId, true);
    return;
  }

  if (key === "w") {
    event.preventDefault();
    closeTab(state.activeTabId);
  }
}

document.addEventListener("keydown", handleWorkspaceTabShortcut);

async function ensureCanvasAuthBeforeOpening() {
  if (!window.nucleus || !window.nucleus.ensureCanvasAuth) {
    return true;
  }

  const result = await window.nucleus.ensureCanvasAuth();
  if (result && result.ok) {
    return true;
  }

  console.error("Unable to open Canvas tab: Canvas auth is not ready.", result && result.error ? result.error : result);
  return false;
}

// open new canvastab
async function newCanvasTab(url, workspaceId, setactive = false, injection = null) {
  const result = await newWebContentTab(
    url,
    workspaceId,
    setactive,
    injection || getCanvasInjectionConfig(),
    "canvastab"
  );
  void ensureCanvasAuthBeforeOpening().catch(error => {
    console.error("Canvas auth check failed after opening tab:", error);
  });
  return result;
}

function isCanvasUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value, window.location.href);
    const host = url.hostname.toLowerCase();
    return host.includes("instructure.com") || host.includes("canvas");
  } catch (_error) {
    return false;
  }
}

async function openUrlInWorkspaceTab(url, workspaceId, setactive = false, injection = null) {
  if (isCanvasUrl(url)) {
    return newCanvasTab(url, workspaceId, setactive, injection || getCanvasInjectionConfig());
  }
  return newbrowsertab(url, workspaceId, setactive, injection);
}

function getCanvasInjectionConfig() {
  return {
    iframeTargets: ["preview_frame", "tool_content"]
  };
}

function buildMainTabSyncPayload(tab) {
  if (!tab) return null;
  return {
    id: tab.id,
    type: tab.type,
    workspaceId: tab.workspaceId,
    label: tab.label,
    url: tab.url || "",
    canvasMode: tab.canvasMode,
    canvasNativePage: tab.canvasNativePage,
    nativeHistory: tab.nativeHistory,
    courseId: tab.courseId,
    courseSection: tab.courseSection,
    injection: tab.injection,
    loading: tab.loading,
    yindex: tab.yindex,
    discarded: Boolean(tab.discarded),
    pendingSwitchSlate: Boolean(tab.pendingSwitchSlate)
  };
}

function getCanvasNativeState(tab) {
  return {
    page: tab.canvasNativePage || "dashboard",
    courseId: tab.courseId || null,
    courseSection: tab.courseSection || "homepage",
    yindex: Number(tab.yindex || 0)
  };
}

function setCanvasNativeState(tab, nativeState) {
  tab.canvasNativePage = nativeState && nativeState.page ? nativeState.page : "dashboard";
  tab.courseId = nativeState ? nativeState.courseId || null : null;
  tab.courseSection = nativeState ? nativeState.courseSection || "homepage" : "homepage";
  tab.yindex = nativeState ? Number(nativeState.yindex || 0) : 0;
}

function pushCanvasNativeHistory(tab, options = {}) {
  rememberActiveCanvasYIndex();
  tab.nativeHistory = Array.isArray(tab.nativeHistory) ? tab.nativeHistory : [];
  const currentState = getCanvasNativeState(tab);
  const lastState = tab.nativeHistory[tab.nativeHistory.length - 1];
  if (
    !lastState ||
    lastState.page !== currentState.page ||
    String(lastState.courseId || "") !== String(currentState.courseId || "") ||
    String(lastState.courseSection || "") !== String(currentState.courseSection || "")
  ) {
    tab.nativeHistory.push(currentState);
  }
  if (
    !options.skipMainStack &&
    window.nucleus &&
    typeof window.nucleus.noteCanvasNavForward === "function"
  ) {
    void window.nucleus.noteCanvasNavForward(tab.id);
  }
}

async function restoreCanvasNativePage(tab) {
  canvasLinkOpening = false;
  ensureCanvasTabRecord(tab);
  const history = Array.isArray(tab.nativeHistory) ? tab.nativeHistory : [];
  const nativeState = history.pop() || { page: "dashboard", courseId: null };
  tab.canvasMode = "native";
  tab.url = "";
  tab.loading = false;
  tab.viewTier = "active";
  tab.discarded = false;
  tab.pendingSwitchSlate = false;
  setCanvasNativeState(tab, nativeState);

  if (typeof setViewSwitching === "function") {
    setViewSwitching(false);
  }
  const vt = window.nucleusViewTransition;
  if (vt && typeof vt.completeTransition === "function") {
    vt.completeTransition();
  }
  if (window.__nucleusTabSnapshot && typeof window.__nucleusTabSnapshot.clear === "function") {
    window.__nucleusTabSnapshot.clear();
  }

  let hideResult = { ok: false, reason: "missing_bridge" };
  try {
    if (window.nucleus && typeof window.nucleus.restoreCanvasNative === "function") {
      hideResult = await window.nucleus.restoreCanvasNative({
        tabId: tab.id,
        tab: buildMainTabSyncPayload(tab),
        tabs: state.tabs.map(buildMainTabSyncPayload).filter(Boolean),
        activeTabId: state.activeTabId
      });
    }
  } catch (error) {
    console.error("Unable to hide canvas browser surface:", error);
  }

  if (hideResult && hideResult.needsNativeReveal) {
    await finishNativeCanvasSurfaceReveal(tab, { tabBar: "patch" });
  } else if (typeof refreshCanvasNativeView === "function") {
    refreshCanvasNativeView({ skipTransition: true, tabBar: "patch" });
  } else {
    render();
  }

  queueTabSyncAfterRender();
}

let canvasAppBootstrapPromise = null;

function resetCanvasAppBootstrap() {
  canvasAppBootstrapPromise = null;
}

function ensureCanvasTabRecord(tab) {
  if (!tab) return null;
  if (tab.type !== "canvastab") {
    initializeCanvasNativeTab(tab);
  }
  if (!Array.isArray(tab.nativeHistory)) {
    tab.nativeHistory = [];
  }
  return tab;
}

function resolveCanvasTabForLink(workspaceId) {
  const active = typeof getActiveTab === "function" ? getActiveTab() : null;
  if (active && active.workspaceId === workspaceId) {
    if (active.type === "canvastab" || canConvertTabToCanvasNative(active, workspaceId)) {
      return active;
    }
  }
  const canonicalId = `canvas:${workspaceId}`;
  return state.tabs.find(item => sameTabId(item.id, canonicalId))
    || state.tabs.find(item =>
      item.type === "canvastab"
      && item.workspaceId === workspaceId
    )
    || state.tabs.find(item =>
      item.workspaceId === workspaceId
      && canConvertTabToCanvasNative(item, workspaceId)
    );
}

function getNativeCanvasTabForWorkspace(workspaceId) {
  const canonicalId = `canvas:${workspaceId}`;
  return state.tabs.find(item => sameTabId(item.id, canonicalId))
    || state.tabs.find(item =>
      item.type === "canvastab"
      && item.workspaceId === workspaceId
      && item.canvasMode !== "browser"
    );
}

function canConvertTabToCanvasNative(tab, workspaceId) {
  if (!tab || tab.workspaceId !== workspaceId) return false;
  if (tab.type === "center") return true;
  if (tab.type === "browsertab") return true;
  if (tab.type === "task") return true;
  if (isCanvasBrowserTab(tab)) return true;
  return false;
}

function initializeCanvasNativeTab(tab) {
  tab.type = "canvastab";
  tab.canvasMode = "native";
  tab.canvasNativePage = tab.canvasNativePage || "dashboard";
  tab.nativeHistory = Array.isArray(tab.nativeHistory) ? tab.nativeHistory : [];
  tab.label = "Canvas";
  tab.url = "";
  tab.injection = null;
  tab.loading = false;
}

function applyCanvasNativeTarget(tab, courseId, options = {}) {
  const courseSection = options.courseSection || "homepage";
  tab.loading = false;
  tab.url = "";
  tab.injection = null;
  if (courseId) {
    if (tab.canvasNativePage !== "course" || String(tab.courseId || "") !== String(courseId)) {
      pushCanvasNativeHistory(tab);
    }
    tab.canvasNativePage = "course";
    tab.courseId = courseId;
    tab.courseSection = courseSection;
    tab.yindex = 0;
  } else {
    tab.canvasNativePage = options.page === "course" ? "course" : "dashboard";
    if (tab.canvasNativePage === "dashboard") {
      tab.courseId = null;
      tab.courseSection = "homepage";
      tab.yindex = 0;
    }
  }
}

function ensureCanvasAppBootstrapped() {
  if (!window.nucleus || typeof window.nucleus.openCanvasApp !== "function") {
    return Promise.resolve({ ok: true });
  }
  if (!canvasAppBootstrapPromise) {
    canvasAppBootstrapPromise = window.nucleus.openCanvasApp().catch(error => {
      canvasAppBootstrapPromise = null;
      throw error;
    });
  }
  return canvasAppBootstrapPromise;
}

async function navigateCanvasNative(courseId = null, options = {}) {
  const workspaceId = options.workspaceId || getBrowserWorkspaceId();
  return openCanvasAppTab(workspaceId, courseId, options);
}

async function openCanvasAppTab(workspaceId = getBrowserWorkspaceId(), courseId = null, options = {}) {
  let tab = getNativeCanvasTabForWorkspace(workspaceId);

  if (!tab && state.top === "workspace" && state.activeWorkspaceId === workspaceId) {
    const activeTab = getActiveTab();
    if (activeTab && canConvertTabToCanvasNative(activeTab, workspaceId)) {
      tab = activeTab;
    }
  }

  if (!tab) {
    tab = {
      id: `canvas:${workspaceId}`,
      type: "canvastab",
      canvasMode: "native",
      canvasNativePage: "dashboard",
      nativeHistory: [],
      workspaceId,
      label: "Canvas",
      courseId: null,
      courseSection: "homepage",
      yindex: 0
    };
    state.tabs.push(tab);
  }

  initializeCanvasNativeTab(tab);
  applyCanvasNativeTarget(tab, courseId, options);

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[workspaceId] = tab.id;

  if (typeof refreshCanvasNativeView === "function") {
    refreshCanvasNativeView();
  } else {
    render();
  }
  try {
    await syncTabs();
    await syncActiveTab();
  } catch (error) {
    console.error("Unable to sync canvas tab after open:", error);
  }

  void ensureCanvasAuthBeforeOpening()
    .then(hasAuth => {
      if (!hasAuth) return;
      return ensureCanvasAppBootstrapped();
    })
    .catch(error => {
      console.error("Canvas bootstrap failed:", error);
    });

  return { ok: true, tabId: tab.id };
}

async function openCanvasAppInExistingTab(tabId) {
  const tab = state.tabs.find(item => sameTabId(item.id, tabId));
  if (!tab) return;

  initializeCanvasNativeTab(tab);
  applyCanvasNativeTarget(tab, null, { page: "dashboard" });

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = tab.workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[tab.workspaceId] = tab.id;

  if (typeof refreshCanvasNativeView === "function") {
    refreshCanvasNativeView();
  } else {
    render();
  }
  queueTabSyncAfterRender();

  ensureCanvasAppBootstrapped().catch(error => {
    console.error("Canvas bootstrap failed:", error);
  });
}

let canvasLinkOpening = false;

function isValidCanvasBrowserHref(value) {
  const href = String(value || "").trim();
  if (!href || href === "#" || href.startsWith("#")) return false;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

async function openCanvasBrowserUrl(url, workspaceId, options = {}) {
  const href = String(url || "").trim();
  const setActive = options.setActive !== false;
  const courseId = options.courseId || null;

  if (!isValidCanvasBrowserHref(href)) {
    if (courseId) return openCanvasAppTab(workspaceId, courseId);
    return openCanvasAppTab(workspaceId);
  }

  if (canvasLinkOpening) {
    return { ok: false, reason: "busy" };
  }

  let tab = resolveCanvasTabForLink(workspaceId);
  if (!tab && state.top === "workspace" && state.activeWorkspaceId === workspaceId) {
    const activeTab = getActiveTab();
    if (activeTab && canConvertTabToCanvasNative(activeTab, workspaceId)) {
      tab = activeTab;
    }
  }

  if (!tab) {
    await newWebContentTab(href, workspaceId, setActive, getCanvasInjectionConfig(), "canvastab");
    tab = resolveCanvasTabForLink(workspaceId)
      || state.tabs.find(item =>
        item.type === "canvastab"
        && item.workspaceId === workspaceId
        && isCanvasBrowserTab(item)
      );
  }

  if (!tab) {
    return { ok: false, reason: "no_tab" };
  }

  ensureCanvasTabRecord(tab);
  canvasLinkOpening = true;

  try {
    let navForwardFrom = null;
    if (isCanvasBrowserTab(tab) && tab.url) {
      navForwardFrom = { kind: "web", url: tab.url };
    } else if (isCanvasNativeTab(tab)) {
      rememberActiveCanvasYIndex();
      navForwardFrom = { kind: "native", ...getCanvasNativeState(tab) };
    }

    if (setActive) {
      rememberActiveWorkspaceTab();
      state.top = "workspace";
      state.activeWorkspaceId = workspaceId;
      state.activeTabId = tab.id;
      state.activeTabByWorkspace[workspaceId] = tab.id;
    }

    tab.type = "canvastab";
    tab.url = href;
    tab.injection = getCanvasInjectionConfig();
    tab.loading = true;
    tab.viewTier = "active";
    tab.canvasMode = "browser";

    if (typeof paintActiveView === "function") {
      paintActiveView({ skipTransition: true, fast: true });
    }

    let openResult = { ok: false };
    if (window.nucleus && typeof window.nucleus.openCanvasLink === "function") {
      openResult = await window.nucleus.openCanvasLink({
        tabId: tab.id,
        url: href,
        navForwardFrom,
        tabs: state.tabs.map(buildMainTabSyncPayload).filter(Boolean),
        activeTabId: state.activeTabId
      });
    }

    tab.canvasMode = "browser";

    if (openResult && openResult.url) {
      tab.url = openResult.url;
    }

    if (typeof renderCanvasToolbar === "function") {
      renderCanvasToolbar();
    }
    if (setActive && typeof patchWorkspacePageTabs === "function") {
      patchWorkspacePageTabs();
    }

    if (!openResult || !openResult.ok) {
      tab.loading = false;
      if (openResult && openResult.reason !== "cancelled") {
        console.error("Canvas URL open failed:", openResult);
      }
      queueTabSyncAfterRender();
      return openResult || { ok: false };
    }

    queueTabSyncAfterRender();
    return openResult;
  } catch (error) {
    console.error("Unable to open canvas browser URL:", error);
    tab.loading = false;
    queueTabSyncAfterRender();
    return { ok: false, error: String(error && error.message ? error.message : error) };
  } finally {
    canvasLinkOpening = false;
  }
}

// open link in a canvastab (reuse active canvas tab — no extra tab)
async function openCourseLinkInCanvasTab(link) {
  const href = link.getAttribute("href");
  if (!href || href === "#" || href.startsWith("#")) return;
  return openCanvasBrowserUrl(href, getBrowserWorkspaceId(), { setActive: true });
}

// returns the tabs in current activeworkspace
function getVisibleTabs() {
  return state.tabs.filter(tab => tab.workspaceId === state.activeWorkspaceId);
}

