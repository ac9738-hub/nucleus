// Shared artifact UI actions for LUMI and Synapse.
// Functionality: artifact cards, inline preview toggle, workspace/window open, download.
// Dependencies: window.nucleusArtifactPreview, window.nucleusArtifactTabs, window.nucleus.
(function initArtifactActions(global) {
  const TYPE_LABELS = {
    docx: "Word",
    pptx: "Slides",
    latex: "LaTeX",
    chart: "Chart",
    graph: "Graph",
    table: "Table",
    html: "Document",
    flashcards: "Flashcards",
  };

  function artifactTypeLabel(type) {
    return TYPE_LABELS[type] || type || "Artifact";
  }

  function findCard(container, artifactId) {
    if (!container || !artifactId) return null;
    return container.querySelector(`.artifact-card[data-artifact-id="${artifactId}"]`);
  }

  async function openWorkspaceTab(artifact, options) {
    if (!artifact || !artifact.id) return null;
    if (!global.nucleusArtifactTabs || typeof global.nucleusArtifactTabs.openArtifactInWorkspace !== "function") {
      return null;
    }
    return global.nucleusArtifactTabs.openArtifactInWorkspace(artifact, options || {});
  }

  async function openExternalWindow(artifact) {
    if (!artifact || !artifact.id) return null;
    if (!global.nucleus || typeof global.nucleus.openArtifactExternal !== "function") return null;
    return global.nucleus.openArtifactExternal({ id: artifact.id });
  }

  async function downloadArtifact(artifact) {
    if (!artifact || !artifact.id) return;
    if (!global.nucleus || typeof global.nucleus.downloadArtifact !== "function") return;
    await global.nucleus.downloadArtifact({ id: artifact.id });
  }

  async function toggleInlinePreview(card, artifact) {
    if (!card || !artifact || !artifact.id) return;
    const panel = card.querySelector("[data-artifact-inline-preview]");
    const toggle = card.querySelector("[data-artifact-preview-toggle]");
    if (!panel) return;

    const expanded = panel.classList.toggle("is-expanded");
    if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");

    if (!expanded) return;

    const frame = panel.querySelector("iframe[data-artifact-preview]");
    if (!frame || !global.nucleusArtifactPreview) return;
    panel.classList.add("is-loading");
    try {
      await global.nucleusArtifactPreview.mountFrame(frame, artifact.id);
    } finally {
      panel.classList.remove("is-loading");
    }
  }

  function buildCard(artifact, handlers) {
    const hooks = handlers || {};
    const type = artifact.artifactType || artifact.type || "artifact";
    const typeLabel = artifactTypeLabel(type);

    const card = document.createElement("article");
    card.className = "artifact-card";
    card.dataset.artifactId = artifact.id || "";

    const head = document.createElement("div");
    head.className = "artifact-card-head";

    const title = document.createElement("span");
    title.className = "artifact-card-title";
    title.textContent = artifact.title || "Artifact";

    const badge = document.createElement("span");
    badge.className = "artifact-card-type";
    badge.textContent = typeLabel;

    head.appendChild(title);
    head.appendChild(badge);

    const actions = document.createElement("div");
    actions.className = "artifact-card-actions nui-btn-row";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "nui-btn nui-btn-secondary nui-btn-compact";
    previewBtn.textContent = hooks.previewLabel || "Preview";
    previewBtn.setAttribute("data-artifact-preview-toggle", "true");
    previewBtn.setAttribute("aria-expanded", "false");
    previewBtn.addEventListener("click", () => {
      if (typeof hooks.onPreview === "function") {
        hooks.onPreview(artifact, card);
        return;
      }
      toggleInlinePreview(card, artifact);
    });

    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.className = "nui-btn nui-btn-primary nui-btn-compact";
    tabBtn.textContent = "Open tab";
    tabBtn.addEventListener("click", () => {
      if (typeof hooks.onOpenTab === "function") hooks.onOpenTab(artifact);
    });

    actions.appendChild(previewBtn);
    actions.appendChild(tabBtn);

    if (hooks.showExternal !== false) {
      const externalBtn = document.createElement("button");
      externalBtn.type = "button";
      externalBtn.className = "nui-btn nui-btn-ghost nui-btn-compact";
      externalBtn.textContent = "New window";
      externalBtn.addEventListener("click", () => {
        if (typeof hooks.onOpenExternal === "function") {
          hooks.onOpenExternal(artifact);
        } else {
          openExternalWindow(artifact);
        }
      });
      actions.appendChild(externalBtn);
    }

    if (typeof hooks.onDownload === "function") {
      const downloadBtn = document.createElement("button");
      downloadBtn.type = "button";
      downloadBtn.className = "nui-btn nui-btn-ghost nui-btn-compact";
      downloadBtn.textContent = "Download";
      downloadBtn.addEventListener("click", () => hooks.onDownload(artifact));
      actions.appendChild(downloadBtn);
    }

    const panel = document.createElement("div");
    panel.className = "artifact-card-preview";
    panel.setAttribute("data-artifact-inline-preview", "true");

    const previewFrame = document.createElement("iframe");
    previewFrame.className = "artifact-card-frame";
    previewFrame.title = `${artifact.title || "Artifact"} preview`;
    previewFrame.dataset.artifactPreview = artifact.id || "";
    panel.appendChild(previewFrame);

    card.appendChild(head);
    card.appendChild(actions);
    if (hooks.inlinePreview !== false) {
      card.appendChild(panel);
    }

    return card;
  }

  function upsertCard(container, artifact, handlers) {
    if (!container || !artifact || !artifact.id) return null;
    const existing = findCard(container, artifact.id);
    const card = buildCard(artifact, handlers);
    if (existing) {
      existing.replaceWith(card);
    } else {
      container.appendChild(card);
    }
    if (typeof container.scrollTop === "number") {
      container.scrollTop = container.scrollHeight;
    }
    return card;
  }

  function appendChipRow(container, artifact, handlers) {
    return upsertCard(container, artifact, handlers);
  }

  global.nucleusArtifactActions = {
    artifactTypeLabel,
    findCard,
    openWorkspaceTab,
    openExternalWindow,
    downloadArtifact,
    toggleInlinePreview,
    upsertCard,
    appendChipRow
  };
})(window);
