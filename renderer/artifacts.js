// LUMI artifact preview dropdown and workspace open flow.
// Functionality: collapsible iframe preview in LUMI; artifacts open as workspace tabs.
// Dependencies: lib/artifact-actions.js, lib/artifact-preview.js, renderer/artifact-tabs.js.
(function initArtifactUi() {
  const previewRoot = document.getElementById("ai-artifact-preview");
  const previewToggle = document.getElementById("ai-artifact-preview-toggle");
  const previewTitle = document.getElementById("ai-artifact-preview-title");
  const previewMeta = document.getElementById("ai-artifact-preview-meta");
  const previewFrame = document.getElementById("ai-artifact-preview-frame");
  const previewOpenTab = document.getElementById("ai-artifact-preview-open-tab");
  const previewOpenWindow = document.getElementById("ai-artifact-preview-open-window");
  const previewDownload = document.getElementById("ai-artifact-preview-download");
  if (!previewRoot || !previewFrame || !window.nucleus) return;

  const actions = window.nucleusArtifactActions || {};
  let activeArtifact = null;

  function shouldHandlePayload(payload) {
    return !payload || payload.source !== "synapse";
  }

  function setExpanded(expanded) {
    previewRoot.classList.toggle("is-expanded", expanded);
    if (previewToggle) previewToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function setPreviewVisible(visible) {
    previewRoot.classList.toggle("is-hidden", !visible);
    if (!visible) {
      previewFrame.removeAttribute("src");
      previewFrame.removeAttribute("srcdoc");
      activeArtifact = null;
      setExpanded(false);
    }
  }

  async function mountLumiPreview(artifact) {
    if (!artifact || !artifact.id) return;
    if (!window.nucleusArtifactPreview || typeof window.nucleusArtifactPreview.mountFrame !== "function") {
      console.error("Artifact preview helper is unavailable.");
      return;
    }
    activeArtifact = artifact;
    if (previewTitle) previewTitle.textContent = artifact.title || "Artifact";
    if (previewMeta) {
      const label = typeof actions.artifactTypeLabel === "function"
        ? actions.artifactTypeLabel(artifact.artifactType || artifact.type)
        : (artifact.type || "Artifact");
      previewMeta.textContent = label;
    }
    setPreviewVisible(true);
    setExpanded(true);
    await window.nucleusArtifactPreview.mountFrame(previewFrame, artifact.id);
  }

  async function openArtifactTab(artifact, options) {
    if (!artifact || !artifact.id) return null;
    if (typeof actions.openWorkspaceTab === "function") {
      return actions.openWorkspaceTab(artifact, options);
    }
    if (window.nucleusArtifactTabs && typeof window.nucleusArtifactTabs.openArtifactInWorkspace === "function") {
      return window.nucleusArtifactTabs.openArtifactInWorkspace(artifact, options);
    }
    return null;
  }

  function cardHandlers() {
    return {
      inlinePreview: false,
      previewLabel: "Show in LUMI",
      onPreview: mountLumiPreview,
      onOpenTab: openArtifactTab,
      onOpenExternal: artifactItem => {
        if (typeof actions.openExternalWindow === "function") {
          actions.openExternalWindow(artifactItem);
        }
      },
      onDownload: artifactItem => {
        if (typeof actions.downloadArtifact === "function") {
          actions.downloadArtifact(artifactItem);
        }
      }
    };
  }

  function upsertArtifactCard(messages, artifact) {
    if (!messages || !artifact) return;
    if (typeof actions.upsertCard === "function") {
      actions.upsertCard(messages, artifact, cardHandlers());
    }
  }

  if (previewToggle) {
    previewToggle.addEventListener("click", () => {
      setExpanded(!previewRoot.classList.contains("is-expanded"));
    });
  }

  if (previewOpenTab) {
    previewOpenTab.addEventListener("click", async () => {
      if (!activeArtifact) return;
      await openArtifactTab(activeArtifact);
    });
  }

  if (previewOpenWindow) {
    previewOpenWindow.addEventListener("click", async () => {
      if (!activeArtifact) return;
      if (typeof actions.openExternalWindow === "function") {
        await actions.openExternalWindow(activeArtifact);
      }
    });
  }

  if (previewDownload) {
    previewDownload.addEventListener("click", async () => {
      if (!activeArtifact) return;
      if (typeof actions.downloadArtifact === "function") {
        await actions.downloadArtifact(activeArtifact);
      }
    });
  }

  window.nucleus.on("artifacts:created", payload => {
    if (!shouldHandlePayload(payload)) return;
    const artifact = payload && payload.artifact;
    const messages = document.getElementById("ai-messages");
    upsertArtifactCard(messages, artifact);
    if (artifact) mountLumiPreview(artifact);
  });

  window.nucleus.on("artifacts:updated", payload => {
    if (!shouldHandlePayload(payload)) return;
    const artifact = payload && payload.artifact;
    const messages = document.getElementById("ai-messages");
    upsertArtifactCard(messages, artifact);
    if (artifact && (!activeArtifact || activeArtifact.id === artifact.id)) {
      mountLumiPreview(artifact);
    }
  });

  window.nucleus.on("artifacts:open", async payload => {
    if (!shouldHandlePayload(payload)) return;
    const artifactId = payload && (payload.artifactId || (payload.artifact && payload.artifact.id));
    if (!artifactId) return;
    const result = await window.nucleus.getArtifact({ id: artifactId });
    if (!result || !result.ok || !result.artifact) return;
    await openArtifactTab(result.artifact, {
      workspaceId: payload && payload.workspaceId
    });
    await mountLumiPreview(result.artifact);
  });

  window.nucleusArtifacts = {
    showLumiPreview: mountLumiPreview,
    openArtifactTab,
    closePreview: () => setPreviewVisible(false)
  };
})();
