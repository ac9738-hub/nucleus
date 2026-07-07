// Synapse artifact cards in the chat thread.
// Functionality: inline expandable preview, workspace tab, external window, download.
// Dependencies: lib/artifact-actions.js, lib/artifact-preview.js.
(function initSynapseArtifacts(global) {
  const actions = () => global.nucleusArtifactActions || {};

  function appendSynapseArtifactChips(thread, artifacts, options) {
    if (!thread || !Array.isArray(artifacts) || !artifacts.length) return;
    const opts = options || {};
    const wrap = document.createElement("div");
    wrap.className = "synapse-artifact-chips";

    artifacts.forEach((artifact, index) => {
      if (!artifact || !artifact.id) return;
      const chipActions = actions();
      if (typeof chipActions.upsertCard !== "function") return;

      const card = chipActions.upsertCard(wrap, artifact, {
        inlinePreview: true,
        previewLabel: "Preview",
        onPreview: (item, cardEl) => {
          if (typeof opts.onPreview === "function") {
            opts.onPreview(item, cardEl);
            return;
          }
          if (typeof chipActions.toggleInlinePreview === "function") {
            chipActions.toggleInlinePreview(cardEl, item);
          }
        },
        onOpenTab: item => {
          if (typeof opts.onOpenTab === "function") {
            opts.onOpenTab(item);
          } else if (typeof chipActions.openWorkspaceTab === "function") {
            chipActions.openWorkspaceTab(item);
          }
        },
        onOpenExternal: item => {
          if (typeof opts.onOpenExternal === "function") {
            opts.onOpenExternal(item);
          } else if (typeof chipActions.openExternalWindow === "function") {
            chipActions.openExternalWindow(item);
          }
        },
        onDownload: item => {
          if (typeof opts.onDownload === "function") {
            opts.onDownload(item);
          } else if (typeof chipActions.downloadArtifact === "function") {
            chipActions.downloadArtifact(item);
          }
        }
      });

      if (opts.autoPreviewFirst && index === 0 && card && typeof chipActions.toggleInlinePreview === "function") {
        chipActions.toggleInlinePreview(card, artifact);
      }
    });

    if (!wrap.childElementCount) return;
    thread.appendChild(wrap);
    thread.scrollTop = thread.scrollHeight;
  }

  global.nucleusSynapseArtifacts = {
    appendSynapseArtifactChips
  };
})(window);
