// Workspace artifact tabs and workspace picker.
// Functionality: opens artifacts in the active workspace tab bar or prompts for a workspace.
// Dependencies: lib/artifact-preview.js, renderer state/workspaces.
const ARTIFACT_TAB_ICON_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5 6h6M5 8.5h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

function artifactTabId(artifactId, workspaceId) {
  return `artifact:${workspaceId}:${artifactId}`;
}

function findArtifactTab(artifactId, workspaceId) {
  return state.tabs.find(tab =>
    tab.type === "artifacttab"
    && tab.workspaceId === workspaceId
    && tab.artifactId === artifactId
  ) || null;
}

async function resolveArtifactWorkspace(preferredWorkspaceId = "") {
  if (preferredWorkspaceId && workspaces.some(workspace => workspace.id === preferredWorkspaceId)) {
    return preferredWorkspaceId;
  }
  if (typeof hasActiveWorkspace === "function" && hasActiveWorkspace()) {
    return state.activeWorkspaceId;
  }
  return promptArtifactWorkspacePicker();
}

function promptArtifactWorkspacePicker() {
  return new Promise(resolve => {
    const existing = document.getElementById("artifact-workspace-picker-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "artifact-workspace-picker-overlay";
    overlay.className = "artifact-workspace-picker-overlay settings-overlay";
    overlay.innerHTML = `
      <div class="artifact-workspace-picker settings-modal" role="dialog" aria-modal="true" aria-label="Choose workspace">
        <div class="artifact-workspace-picker-header settings-modal-header">
          <h3>Open artifact</h3>
        </div>
        <div class="artifact-workspace-picker-body settings-modal-body">
          <p>Choose a workspace for this artifact tab.</p>
          <div class="artifact-workspace-options" id="artifact-workspace-options"></div>
          <button type="button" class="nui-btn nui-btn-ghost nui-btn-block" id="artifact-workspace-cancel">Cancel</button>
        </div>
      </div>
    `;

    const options = overlay.querySelector("#artifact-workspace-options");
    workspaces.forEach(workspace => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nui-btn nui-btn-list";
      button.innerHTML = `
        <span class="nui-btn-list-title">${escapeHtml(workspace.name)}</span>
        <span class="nui-btn-list-meta">${escapeHtml(workspace.description || workspace.id)}</span>
      `;
      button.addEventListener("click", () => {
        overlay.remove();
        resolve(workspace.id);
      });
      options.appendChild(button);
    });

    function closeWithoutChoice() {
      overlay.remove();
      resolve(null);
    }

    overlay.querySelector("#artifact-workspace-cancel").addEventListener("click", closeWithoutChoice);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeWithoutChoice();
    });

    document.body.appendChild(overlay);
  });
}

async function openArtifactInWorkspace(artifact, options = {}) {
  if (!artifact || !artifact.id) {
    return { ok: false, error: "Missing artifact." };
  }

  const workspaceId = await resolveArtifactWorkspace(
    options.workspaceId || artifact.workspaceId || ""
  );
  if (!workspaceId) {
    return { ok: false, canceled: true, error: "Workspace selection canceled." };
  }

  ensureWorkspaceCenter(workspaceId);

  let tab = findArtifactTab(artifact.id, workspaceId);
  if (!tab) {
    tab = {
      id: artifactTabId(artifact.id, workspaceId),
      type: "artifacttab",
      workspaceId,
      artifactId: artifact.id,
      label: artifact.title || "Artifact",
      artifactType: artifact.type || "html"
    };
    state.tabs.push(tab);
  } else {
    tab.label = artifact.title || tab.label || "Artifact";
    tab.artifactType = artifact.type || tab.artifactType || "html";
  }

  rememberActiveWorkspaceTab();
  state.top = "workspace";
  state.activeWorkspaceId = workspaceId;
  state.activeTabId = tab.id;
  state.activeTabByWorkspace[workspaceId] = tab.id;

  render();
  await syncTabs();
  await syncActiveTab();
  render();

  return { ok: true, tabId: tab.id, workspaceId, artifactId: artifact.id };
}

function renderArtifactTabIcon() {
  return `<span class="workspace-page-tab-icon workspace-page-tab-icon-artifact">${ARTIFACT_TAB_ICON_SVG}</span>`;
}

function renderArtifactTabView(tab) {
  const title = escapeHtml(tab.label || "Artifact");
  const typeLabel = escapeHtml(tab.artifactType || "artifact");
  return `
    <section class="artifact-tab-view">
      <header class="artifact-tab-header">
        <div>
          <h1>${title}</h1>
          <p class="artifact-tab-meta">${typeLabel}</p>
        </div>
        <div class="artifact-tab-actions nui-btn-row">
          <button type="button" class="nui-btn nui-btn-secondary nui-btn-compact" data-artifact-open-lumi="${escapeHtml(tab.artifactId)}">Show in LUMI</button>
          <button type="button" class="nui-btn nui-btn-secondary nui-btn-compact" data-artifact-open-window="${escapeHtml(tab.artifactId)}">New window</button>
          <button type="button" class="nui-btn nui-btn-primary nui-btn-compact" data-artifact-download="${escapeHtml(tab.artifactId)}">Download</button>
        </div>
      </header>
      <div class="artifact-tab-frame-shell">
        <iframe
          class="artifact-tab-frame"
          title="${title}"
          data-artifact-preview="${escapeHtml(tab.artifactId)}"
          loading="lazy"
        ></iframe>
      </div>
    </section>
  `;
}

async function mountArtifactTabPreview(root) {
  if (!root || !window.nucleusArtifactPreview) return;
  await window.nucleusArtifactPreview.mountAll(root);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    artifactTabId,
    findArtifactTab,
    renderArtifactTabIcon,
    renderArtifactTabView
  };
}

if (typeof window !== "undefined") {
  window.nucleusArtifactTabs = {
    artifactTabId,
    findArtifactTab,
    resolveArtifactWorkspace,
    openArtifactInWorkspace,
    renderArtifactTabIcon,
    renderArtifactTabView,
    mountArtifactTabPreview
  };
}
