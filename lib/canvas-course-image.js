// Canvas course card image loader.
// Functionality: fetches authenticated course images over IPC and mounts data URLs.
// Dependencies: preload.js canvas:fetch_image IPC.
(function initCanvasCourseImages(global) {
  function isCanvasImageUrl(url) {
    const text = String(url || "").trim();
    if (!text || text.startsWith("data:")) return false;
    try {
      const parsed = new URL(text, window.location.origin);
      return parsed.hostname.includes("instructure.com")
        || (parsed.pathname.includes("/courses/") && parsed.pathname.includes("/files/"));
    } catch (_error) {
      return /instructure\.com/i.test(text);
    }
  }

  async function applyCanvasImageDataUrl(img, url) {
    if (!url || !global.nucleus || typeof global.nucleus.fetchCanvasImage !== "function") {
      return;
    }
    try {
      const result = await global.nucleus.fetchCanvasImage({ url });
      if (!result || !result.ok || !result.dataUrl) return;
      img.src = result.dataUrl;
      img.classList.remove("is-hidden");
      const media = img.closest(".canvas-course-card-media");
      const fallback = media && media.querySelector(".canvas-course-card-fallback");
      if (fallback) fallback.classList.add("is-hidden");
    } catch (error) {
      console.warn("Canvas course image failed:", error);
    }
  }

  async function hydrateImage(img) {
    const url = String(img && img.dataset.src || "").trim();
    await applyCanvasImageDataUrl(img, url);
  }

  async function hydrateHomepageImage(img) {
    if (!img || img.dataset.nucleusCanvasHydrated === "1") return;
    const url = String(img.getAttribute("src") || "").trim();
    if (!isCanvasImageUrl(url)) return;
    img.dataset.nucleusCanvasHydrated = "1";
    await applyCanvasImageDataUrl(img, url);
  }

  function hydrateAll(root) {
    if (!root) return Promise.resolve([]);
    const cardImages = Array.from(root.querySelectorAll("[data-canvas-course-image][data-src]"));
    const homepageImages = Array.from(root.querySelectorAll(".course-homepage-content img[src]"))
      .filter(img => isCanvasImageUrl(img.getAttribute("src")));
    return Promise.all([
      ...cardImages.map(hydrateImage),
      ...homepageImages.map(hydrateHomepageImage)
    ]);
  }

  global.nucleusCanvasCourseImages = {
    hydrateImage,
    hydrateAll
  };
})(window);
