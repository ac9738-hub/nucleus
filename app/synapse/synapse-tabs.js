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
let synapseState = { conversations: [] };
let synapseController = null;

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
    synapseSidebarCollapsed: false
  };

  tab.conversationId = conversation.id;
  tab.synapseSidebarCollapsed = Boolean(tab.synapseSidebarCollapsed);
  if (!existing) state.tabs.push(tab);

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[workspaceId] = tab.id;
  await syncTabs();
  await syncActiveTab();
  render();
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
  tab.synapseSidebarCollapsed = false;

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = tab.workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[tab.workspaceId] = tab.id;
  await syncTabs();
  await syncActiveTab();
  render();
}

function destroySynapseController() {
  if (synapseController && typeof synapseController.destroy === "function") {
    synapseController.destroy();
  }
  synapseController = null;
}

// Called at the end of renderView(). Always tears down the previous controller
// (so leaving Synapse removes its stream listener), then mounts a fresh one only
// when a conversation page is showing.
function mountSynapseControllerIfNeeded(viewEl, activeTab) {
  destroySynapseController();

  if (!activeTab || activeTab.type !== "synapsetab" || !activeTab.conversationId) return;
  if (!window.nucleusSynapseApp || !window.nucleus || typeof window.nucleus.synapseSend !== "function") return;

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
    bridge: { send: window.nucleus.synapseSend, on: window.nucleus.on },
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
}
