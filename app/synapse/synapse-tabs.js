// Renderer Synapse tab controller.
// Functionality: owns the renderer-side Synapse conversation store, opens/reuses
// the per-workspace Synapse tab, converts engine tabs into Synapse tabs, and
// mounts the streaming chat controller after renderView() draws the surface.
// Mirrors the Canvas helpers in workspace-page-tabs.js, but Synapse needs no
// WebContentsView -- it renders entirely into #view like Canvas native mode.
// Dependencies: shares renderer global scope with app.js (state, workspaces,
// getBrowserWorkspaceId), workspace-page-tabs.js (syncTabs, syncActiveTab,
// getActiveTab, rememberActiveWorkspaceTab), render.js (render), and the
// window.nucleusSynapseApp / window.nucleusSynapseTemplates browser globals.

// In-memory conversation store. Swap this for data-store.js persistence later;
// the shape matches what renderSynapseApp() expects.
var synapseState = { conversations: [] };
var synapseController = null;
var synapseControllerMountKey = "";
var learnCoursesInflight = null;
var learnCoursesCache = { state: "", courses: [], error: "" };

function getSynapseDefaultModel() {
  return (window.nucleusSynapseTemplates && window.nucleusSynapseTemplates.DEFAULT_MODEL) || "claude-sonnet-4-6";
}

function createSynapseConversation() {
  const conversation = {
    id: `conv:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    title: "New conversation",
    titleSet: false,
    model: getSynapseDefaultModel(),
    messages: []
  };
  synapseState.conversations.unshift(conversation);
  return conversation;
}

function getSynapseConversation(conversationId) {
  return synapseState.conversations.find(c => String(c.id) === String(conversationId)) || null;
}

function getOrCreateSynapseConversation(conversationId = null) {
  if (conversationId) {
    const existing = getSynapseConversation(conversationId);
    if (existing) return existing;
  }
  return synapseState.conversations[0] || createSynapseConversation();
}

function getSynapseBridge() {
  if (!window.nucleus || typeof window.nucleus.synapseSend !== "function") return null;
  return { send: window.nucleus.synapseSend, on: window.nucleus.on };
}

// Open (or reuse) the Synapse tab for a workspace, optionally on a conversation.
async function openSynapseAppTab(workspaceId = getBrowserWorkspaceId(), conversationId = null) {
  const existing = state.tabs.find(tab => tab.type === "synapsetab" && tab.workspaceId === workspaceId);
  const conversation = getOrCreateSynapseConversation(conversationId || (existing && existing.conversationId));
  const tab = existing || {
    id: `synapse:${workspaceId}`,
    type: "synapsetab",
    workspaceId,
    label: "Synapse",
    conversationId: null,
    synapseSidebarCollapsed: false,
    synapseMode: "chat"
  };

  tab.conversationId = conversation.id;
  tab.synapseMode = "chat";
  tab.learnSession = null;
  tab.synapseSidebarCollapsed = Boolean(tab.synapseSidebarCollapsed);
  if (!existing) state.tabs.push(tab);

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[workspaceId] = tab.id;
  render();
  queueTabSyncAfterRender();
}

async function openSynapseLearnTab(workspaceId = getBrowserWorkspaceId()) {
  const existing = state.tabs.find(tab => tab.type === "synapsetab" && tab.workspaceId === workspaceId);
  const tab = existing || {
    id: `synapse:${workspaceId}`,
    type: "synapsetab",
    workspaceId,
    label: "Synapse",
    conversationId: null,
    synapseSidebarCollapsed: false,
    synapseMode: "learn"
  };

  tab.synapseMode = "learn";
  tab.label = "Textbooks";
  tab.learnSession = tab.learnSession || { courses: [], courseId: "", lessons: null };
  if (learnCoursesCache.state === "done") {
    tab.learnSession.courses = learnCoursesCache.courses;
    tab.learnSession.coursesLoadState = "done";
    tab.learnSession.coursesLoadError = learnCoursesCache.error || "";
  }
  if (!existing) state.tabs.push(tab);

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[workspaceId] = tab.id;
  render();
  queueTabSyncAfterRender();
  if (learnCoursesCache.state !== "done") {
    ensureLearnCourses(tab).then(() => {
      const active = getActiveTab();
      if (active && sameTabId(active.id, tab.id) && active.synapseMode === "learn") {
        render();
        queueTabSyncAfterRender();
      }
    });
  }
}

// Convert an existing tab (e.g. the engine new-tab the launcher opened from)
// into a Synapse tab. Called by the engine:open-app-in-tab handler in app.js.
async function openSynapseAppInExistingTab(tabId) {
  const tab = state.tabs.find(item => sameTabId(item.id, tabId));
  if (!tab) return;
  const conversation = getOrCreateSynapseConversation(tab.conversationId);

  tab.type = "synapsetab";
  tab.label = "Synapse";
  tab.url = "";
  tab.injection = null;
  tab.loading = false;
  tab.conversationId = conversation.id;
  tab.synapseMode = "chat";
  tab.learnSession = null;
  tab.synapseSidebarCollapsed = false;

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = tab.workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[tab.workspaceId] = tab.id;
  render();
  queueTabSyncAfterRender();
}

function destroySynapseController() {
  if (synapseController && typeof synapseController.destroy === "function") {
    synapseController.destroy();
  }
  synapseController = null;
  synapseControllerMountKey = "";
}

function getSynapseMountKey(activeTab) {
  if (!activeTab || activeTab.type !== "synapsetab") return "";
  return `${activeTab.id}:${activeTab.synapseMode || "chat"}:${activeTab.conversationId || ""}`;
}

async function ensureLearnCourses(tab) {
  if (!tab || !window.nucleus || typeof window.nucleus.synapseListCourses !== "function") return [];
  tab.learnSession = tab.learnSession || {};

  if (learnCoursesCache.state === "done") {
    tab.learnSession.courses = learnCoursesCache.courses;
    tab.learnSession.coursesLoadState = "done";
    tab.learnSession.coursesLoadError = learnCoursesCache.error;
    return learnCoursesCache.courses;
  }

  if (tab.learnSession.coursesLoadState === "done") {
    return tab.learnSession.courses || [];
  }

  if (learnCoursesInflight) {
    await learnCoursesInflight;
    tab.learnSession.courses = learnCoursesCache.courses;
    tab.learnSession.coursesLoadState = learnCoursesCache.state || "done";
    tab.learnSession.coursesLoadError = learnCoursesCache.error || "";
    return tab.learnSession.courses || [];
  }

  tab.learnSession.coursesLoadState = "loading";
  tab.learnSession.coursesLoadError = "";
  learnCoursesInflight = window.nucleus.synapseListCourses()
    .then((result) => {
      const courses = result && result.ok && Array.isArray(result.courses) ? result.courses : [];
      const error = result && result.ok === false ? (result.error || "Failed to load courses") : "";
      learnCoursesCache = { state: "done", courses, error };
      tab.learnSession.courses = courses;
      tab.learnSession.coursesLoadError = error;
      tab.learnSession.coursesLoadState = "done";
      return courses;
    })
    .catch((error) => {
      const message = (error && error.message) || "Failed to load courses";
      learnCoursesCache = { state: "done", courses: [], error: message };
      tab.learnSession.courses = [];
      tab.learnSession.coursesLoadError = message;
      tab.learnSession.coursesLoadState = "done";
      return [];
    })
    .finally(() => {
      learnCoursesInflight = null;
    });

  return learnCoursesInflight;
}

function resolveLearnTab(tab) {
  if (!tab || !tab.id) return getActiveTab();
  return state.tabs.find((item) => sameTabId(item.id, tab.id)) || getActiveTab() || tab;
}

async function startLearnCourse(tab, courseId, courseLabel) {
  if (!window.nucleus || typeof window.nucleus.synapseGetCurriculum !== "function") return;
  const learnTab = resolveLearnTab(tab);
  if (!learnTab) return;

  learnTab.learnSession = learnTab.learnSession || {};
  learnTab.learnSession.curriculumLoadState = "loading";
  learnTab.learnSession.curriculumLoadError = "";
  render();
  queueTabSyncAfterRender();

  const result = await window.nucleus.synapseGetCurriculum(courseId);
  const learnTabAfter = resolveLearnTab(learnTab);
  if (!learnTabAfter) return;
  if (!result || !result.ok) {
    learnTabAfter.learnSession.curriculumLoadState = "error";
    learnTabAfter.learnSession.curriculumLoadError = (result && result.error) || "Failed to load curriculum";
    render();
    queueTabSyncAfterRender();
    return;
  }

  learnTabAfter.learnSession = {
    courses: learnTabAfter.learnSession.courses || learnCoursesCache.courses || [],
    coursesLoadState: learnTabAfter.learnSession.coursesLoadState || learnCoursesCache.state || "done",
    coursesLoadError: learnTabAfter.learnSession.coursesLoadError || learnCoursesCache.error || "",
    courseId: String(result.courseId || courseId || ""),
    courseLabel: courseLabel || String(result.courseId || courseId || ""),
    lessons: Array.isArray(result.lessons) ? result.lessons : [],
    lessonIndex: learnTabAfter.learnSession.lessonIndex || 0,
    courseThread: learnTabAfter.learnSession.courseThread || [],
    completedLessonIds: learnTabAfter.learnSession.completedLessonIds || {},
    lessonState: learnTabAfter.learnSession.lessonState || {},
    curriculumLoadState: "done",
    curriculumLoadError: ""
  };
  render();
  queueTabSyncAfterRender();
}

function mountSynapseLearnController(viewEl, activeTab) {
  const session = activeTab.learnSession || {};
  const textbook = window.nucleusSynapseTextbook;
  const bridge = getSynapseBridge();
  if (!textbook || !bridge) return;

  if (!session.courseId || !Array.isArray(session.lessons)) {
    if (session.curriculumLoadState === "loading") {
      synapseController = { destroy: function () {} };
      return;
    }
    synapseController = textbook.mountTextbookPicker(viewEl, {
      courses: session.courses || [],
      pending: session.coursesLoadState !== "done",
      loading: session.coursesLoadState === "loading" || session.curriculumLoadState === "loading",
      error: session.coursesLoadError || session.curriculumLoadError || "",
      onStart: ({ courseId, courseLabel }) => {
        startLearnCourse(activeTab, courseId, courseLabel);
      }
    });
    return;
  }

  synapseController = textbook.mountTextbook(viewEl, {
    courseId: session.courseId,
    courseLabel: session.courseLabel,
    lessons: session.lessons,
    lessonIndex: session.lessonIndex || 0,
    courseThread: session.courseThread || [],
    completedLessonIds: session.completedLessonIds || {},
    lessonState: session.lessonState || {},
    model: getSynapseDefaultModel(),
    bridge,
    onSessionChange: (patch) => {
      activeTab.learnSession = Object.assign({}, activeTab.learnSession, patch);
    },
    onExit: () => {
      activeTab.learnSession = {
        courses: session.courses || [],
        coursesLoadState: session.coursesLoadState || "done",
        coursesLoadError: session.coursesLoadError || "",
        courseId: "",
        lessons: null,
        courseThread: [],
        completedLessonIds: {},
        lessonState: {},
        curriculumLoadState: "",
        curriculumLoadError: ""
      };
      render();
      queueTabSyncAfterRender();
    }
  });
}

// Called at the end of renderView(). Preserves an active stream when the mount
// key is unchanged; tears down when leaving Synapse or switching conversations.
function mountSynapseControllerIfNeeded(viewEl, activeTab) {
  const mountKey = getSynapseMountKey(activeTab);
  if (mountKey && mountKey === synapseControllerMountKey && synapseController) {
    return;
  }

  destroySynapseController();

  if (!activeTab || activeTab.type !== "synapsetab") return;
  if (!window.nucleusSynapseApp || !getSynapseBridge()) return;

  if (activeTab.synapseMode === "learn") {
    mountSynapseLearnController(viewEl, activeTab);
    synapseControllerMountKey = mountKey;
    return;
  }

  if (!activeTab.conversationId) return;

  const conversation = getSynapseConversation(activeTab.conversationId);
  if (!conversation) return;

  // Persist the chosen model when the picker changes.
  const modelSelect = viewEl.querySelector("[data-synapse-model]");
  if (modelSelect) {
    modelSelect.addEventListener("change", () => { conversation.model = modelSelect.value; });
  }

  synapseController = window.nucleusSynapseApp.mountSynapseChat(viewEl, {
    conversationId: activeTab.conversationId,
    initialMessages: conversation.messages,
    bridge: getSynapseBridge(),
    onUserMessage: (msg) => {
      conversation.messages.push({ role: "user", content: msg.content, createdAt: msg.createdAt });
      if (!conversation.titleSet && msg.content) {
        conversation.title = msg.content.slice(0, 40);
        conversation.titleSet = true;
      }
    },
    onAssistantMessage: (msg) => {
      conversation.messages.push({ role: "assistant", content: msg.content, createdAt: msg.createdAt });
    }
  });
  synapseControllerMountKey = mountKey;
}
