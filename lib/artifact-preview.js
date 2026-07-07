// Artifact preview loader for renderer iframes.
// Functionality: fetches preview HTML over IPC and mounts blob: URLs in frames.
// Dependencies: preload.js artifacts:get_preview IPC.
(function initArtifactPreview(global) {
  const blobCache = new Map();

  function revoke(artifactId) {
    const url = blobCache.get(artifactId);
    if (!url) return;
    URL.revokeObjectURL(url);
    blobCache.delete(artifactId);
  }

  async function getPreviewHtml(artifactId) {
    if (!artifactId || !global.nucleus || typeof global.nucleus.getArtifactPreview !== "function") {
      throw new Error("Artifact preview IPC is unavailable.");
    }
    const result = await global.nucleus.getArtifactPreview({ id: artifactId });
    if (!result || !result.ok) {
      throw new Error(result && result.error ? result.error : "Preview unavailable.");
    }
    return {
      html: result.html || "<p>Empty preview.</p>",
      artifact: result.artifact || null
    };
  }

  function setFrameLoading(frame, loading) {
    if (!frame) return;
    const shell = frame.closest(".artifact-card-preview, .artifact-tab-frame-shell, .ai-artifact-preview-body");
    if (shell) shell.classList.toggle("is-loading", Boolean(loading));
    frame.classList.toggle("is-loading", Boolean(loading));
  }

  async function mountFrame(frame, artifactId) {
    if (!frame || !artifactId) return null;
    revoke(artifactId);
    frame.removeAttribute("src");
    frame.removeAttribute("srcdoc");
    frame.dataset.artifactPreview = artifactId;
    setFrameLoading(frame, true);
    try {
      const { html } = await getPreviewHtml(artifactId);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      blobCache.set(artifactId, url);
      frame.src = url;
      return url;
    } catch (error) {
      console.error("Artifact preview failed:", error);
      frame.srcdoc = `<!DOCTYPE html><html><body style="margin:0;padding:16px;font:13px/1.5 system-ui,sans-serif;color:#6f7aa7;background:#0c1224;"><p>Unable to load preview.</p><p style="font-size:12px;opacity:.8">${String(error.message || error)}</p></body></html>`;
      return null;
    } finally {
      setFrameLoading(frame, false);
    }
  }

  function mountAll(root) {
    if (!root) return Promise.all([]);
    const frames = Array.from(root.querySelectorAll("[data-artifact-preview]"));
    return Promise.all(frames.map(frame => mountFrame(frame, frame.dataset.artifactPreview)));
  }

  global.nucleusArtifactPreview = {
    revoke,
    getPreviewHtml,
    mountFrame,
    mountAll
  };
})(window);
