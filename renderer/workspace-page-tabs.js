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

// Send signal to main, ActiveCanvasTab returns to previous page
async function goBackActiveCanvasTab() {
  const activeTab = getActiveCanvasTab();
  if (!activeTab) return;
  const result = await window.nucleus.backBrowserTab(activeTab.id);
  if (result && result.ok && (result.wentBack === false || result.restoreNative)) {
    restoreCanvasNativePage(activeTab);
  }
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

  syncTabs();
  syncActiveTab();
  render();
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
      label: "Project Center"
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

// push tab changes in renderer to main
async function syncTabs() {
  await window.nucleus.tabschanged(state.tabs);
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

// push the activetab in renderer to main to sync
function syncActiveTab() {
  const activeTab = getActiveTab();
  if (state.top === "workspace" && isWebContentTab(activeTab)) {
    return window.nucleus.newactivetab(activeTab);
  }
  return window.nucleus.newactivetab("None");
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
  if (!url && type === "browsertab" && window.nucleus && window.nucleus.getEngineUrl) {
    url = await window.nucleus.getEngineUrl();
  }
  const prefix = type === "canvastab" ? "canvas" : "browser";
  const newtab = {
    id: `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    type,
    canvasMode: type === "canvastab" ? "browser" : undefined,
    canvasNativePage: type === "canvastab" ? "dashboard" : undefined,
    nativeHistory: type === "canvastab" ? [] : undefined,
    workspaceId,
    label: type === "canvastab" ? "Canvas" : "chrome",
    url,
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
  }
  if (setactive) {
    render();
  }
  await syncTabs();
  if (setactive) {
    await syncActiveTab();
    render();
  }
}

// return promise for first half wipe animation for canvastabs
function waitforwipe(wipeelement) {
  return new Promise (resolve => {
    let settled = false
    function handler(event) {
      if (event.target !== wipeelement) {
        return
      }
      finish()
    }

    function finish() {
      if (settled) return
      settled = true
      wipeelement.removeEventListener('animationend', handler)
      resolve()
    }

    wipeelement.addEventListener('animationend', handler)
    setTimeout(finish, 1000)
  })
}

function showCanvasBlankSlate() {
  const blankSlate = document.getElementById('canvas-blank-slate')
  if (blankSlate) {
    blankSlate.classList.add('is-visible')
  }
  if (window.nucleus && window.nucleus.canvasBlankShown) {
    window.nucleus.canvasBlankShown()
  }
}

function hideCanvasBlankSlate() {
  const blankSlate = document.getElementById('canvas-blank-slate')
  if (blankSlate) {
    blankSlate.classList.remove('is-visible')
  }
}

// run the canvas wipe on its own timeline; loading reveals the view separately.
async function handlecanvaspagechange() {
  const wipe = document.getElementById('tab-wipe')

  wipe.classList.remove('hide')
  wipe.classList.add('show')

  const waittrans = waitforwipe(wipe)
  await waittrans
  showCanvasBlankSlate()

  window.nucleus.canvasWipeCovered()

  wipe.classList.remove('show')
  wipe.classList.add('hide')

  await waitforwipe(wipe)
  wipe.classList.remove('hide')
  window.nucleus.canvasWipeHidden()
} 

// open new browser tab
function newbrowsertab(url = null, workspaceId, setactive = false, injection = null) {
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
  const hasAuth = await ensureCanvasAuthBeforeOpening();
  if (!hasAuth) {
    return null;
  }
  return newWebContentTab(url, workspaceId, setactive, injection || getCanvasInjectionConfig(), "canvastab");
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

function openUrlInWorkspaceTab(url, workspaceId, setactive = false, injection = null) {
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

function pushCanvasNativeHistory(tab) {
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
}

async function restoreCanvasNativePage(tab) {
  const history = Array.isArray(tab.nativeHistory) ? tab.nativeHistory : [];
  const nativeState = history.pop() || { page: "dashboard", courseId: null };
  tab.canvasMode = "native";
  tab.url = "";
  tab.loading = false;
  setCanvasNativeState(tab, nativeState);
  await syncTabs();
  await syncActiveTab();
  render();
}

async function openCanvasAppTab(workspaceId = getBrowserWorkspaceId(), courseId = null) {
  const existing = state.tabs.find(tab => tab.type === "canvastab" && tab.workspaceId === workspaceId);
  const tab = existing || {
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

  tab.canvasMode = "native";
  tab.loading = false;
  tab.url = "";
  if (courseId) {
    if (tab.canvasNativePage !== "course" || String(tab.courseId || "") !== String(courseId)) {
      pushCanvasNativeHistory(tab);
    }
    tab.canvasNativePage = "course";
    tab.courseId = courseId;
    tab.courseSection = "homepage";
    tab.yindex = 0;
  } else {
    tab.canvasNativePage = "dashboard";
    tab.courseId = null;
    tab.courseSection = "homepage";
    tab.yindex = 0;
  }

  if (!existing) {
    state.tabs.push(tab);
  }

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[workspaceId] = tab.id;
  await syncTabs();
  await syncActiveTab();
  render();

  if (window.nucleus && window.nucleus.openCanvasApp) {
    window.nucleus.openCanvasApp();
  }
}

async function openCanvasAppInExistingTab(tabId) {
  const tab = state.tabs.find(item => sameTabId(item.id, tabId));
  if (!tab) return;

  tab.type = "canvastab";
  tab.canvasMode = "native";
  tab.canvasNativePage = "dashboard";
  tab.nativeHistory = [];
  tab.label = "Canvas";
  tab.url = "";
  tab.injection = null;
  tab.loading = false;
  tab.courseId = null;
  tab.courseSection = "homepage";
  tab.yindex = 0;

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = tab.workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[tab.workspaceId] = tab.id;
  await syncTabs();
  await syncActiveTab();
  render();

  if (window.nucleus && window.nucleus.openCanvasApp) {
    window.nucleus.openCanvasApp();
  }
}

// open link in a canvastab
async function openCourseLinkInCanvasTab(link) {
  const href = link.getAttribute("href");
  if (!href || href === "#" || href.startsWith("#")) return;

  const activeTab = getActiveTab();
  if (activeTab && activeTab.type === "canvastab") {
    pushCanvasNativeHistory(activeTab);
    activeTab.canvasMode = "browser";
    activeTab.url = href;
    activeTab.injection = getCanvasInjectionConfig();
    activeTab.loading = true;
    state.activeTabId = activeTab.id;
    state.activeTabByWorkspace[state.activeWorkspaceId] = activeTab.id;
    render();
    await syncTabs();
    await syncActiveTab();
    render();
    return;
  }

  const workspaceId = getBrowserWorkspaceId();
  newCanvasTab(href, workspaceId, true, getCanvasInjectionConfig());
}

// returns the tabs in current activeworkspace
function getVisibleTabs() {
  return state.tabs.filter(tab => tab.workspaceId === state.activeWorkspaceId);
}

