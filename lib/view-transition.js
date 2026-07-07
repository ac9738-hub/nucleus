// View transition coordinator for smooth tab / section switches.
// Functionality: generation-guarded crossfades on #view; feature-flag rollback.
// Dependencies: theme motion tokens (--motion-fast); loaded before renderer/app.js.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.nucleusViewTransition = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createViewTransitionApi() {
  const STORAGE_KEY = "nucleus.smoothTabs";
  const TAB_CROSSFADE_MS = 80;
  const raf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : callback => setTimeout(callback, 0);

  let generation = 0;
  let paintGeneration = 0;
  let settleTimer = null;
  let activeTransition = null;

  function isSmoothTabsEnabled() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value === "0") return false;
      if (value === "1") return true;
    } catch (_error) {
      // ignore
    }
    return true;
  }

  function setSmoothTabsEnabled(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch (_error) {
      // ignore
    }
    applyDocumentFlag();
  }

  function applyDocumentFlag() {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.smoothTabs = isSmoothTabsEnabled() ? "1" : "0";
  }

  function readMotionMs() {
    return TAB_CROSSFADE_MS;
  }

  function isTransitionCurrent(gen) {
    return !gen || gen === generation;
  }

  function setViewPhase(view, phase) {
    if (!view) return;
    view.classList.toggle("view-is-switching", phase === "switching");
    view.classList.toggle("view-is-ready", phase === "ready");
  }

  function clearLayers(view) {
    if (!view) return;
    view.querySelectorAll(".view-transition-layer").forEach(node => node.remove());
  }

  function beginTransition() {
    generation += 1;
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    const view = typeof document !== "undefined" ? document.getElementById("view") : null;
    const enabled = isSmoothTabsEnabled();
    activeTransition = { generation, enabled };
    if (view && enabled) {
      setViewPhase(view, "switching");
    }
    return activeTransition;
  }

  function consumeActiveTransition() {
    const transition = activeTransition;
    activeTransition = null;
    return transition;
  }

  function completeTransition(gen) {
    const view = typeof document !== "undefined" ? document.getElementById("view") : null;
    if (view) {
      clearLayers(view);
      setViewPhase(view, "ready");
    }
    if (gen && gen !== generation) return;
  }

  function cancelTransition(gen) {
    if (gen && gen !== generation) return;
    completeTransition(generation);
  }

  function applyPaint(view, html, options, paintGen) {
    view.innerHTML = html;
    if (typeof options.mount === "function") {
      options.mount(view);
    }
    if (paintGen === paintGeneration) {
      completeTransition(options.generation || generation);
    }
  }

  function paintView(view, html, options = {}) {
    if (!view) return;

    const paintGen = ++paintGeneration;
    const gen = options.generation || generation;
    const htmlText = html == null ? "" : String(html);
    const skipCrossfade = options.skipCrossfade === true;
    const smooth = !skipCrossfade
      && options.enabled !== false
      && isSmoothTabsEnabled()
      && gen > 0;
    const hasOutgoing = view.firstElementChild
      && !view.querySelector(".tab-restore-snapshot")
      && !view.querySelector(".view-transition-layer");

    if (!smooth || !hasOutgoing || !htmlText) {
      applyPaint(view, htmlText, options, paintGen);
      return;
    }

    clearLayers(view);
    setViewPhase(view, "switching");

    const outgoing = document.createElement("div");
    outgoing.className = "view-transition-layer view-transition-outgoing is-visible";
    while (view.firstChild) {
      outgoing.appendChild(view.firstChild);
    }
    view.appendChild(outgoing);

    const incoming = document.createElement("div");
    incoming.className = "view-transition-layer view-transition-incoming";
    incoming.innerHTML = htmlText;
    view.appendChild(incoming);

    const duration = readMotionMs();
    raf(() => {
      if (paintGen !== paintGeneration) {
        return;
      }
      incoming.classList.add("is-visible");
      outgoing.classList.add("is-fading");
    });

    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (paintGen !== paintGeneration) return;
      applyPaint(view, htmlText, options, paintGen);
    }, duration);
  }

  function paintViewSection(container, html, options = {}) {
    if (!container) return;
    const gen = options.generation || generation;
    const smooth = options.enabled !== false && isSmoothTabsEnabled() && gen > 0;
    const outgoing = container.querySelector("[data-course-section-page]");
    if (!smooth || !outgoing) {
      const host = container.querySelector(".course-page") || container;
      const existing = host.querySelector("[data-course-section-page]");
      if (existing) {
        existing.outerHTML = html;
      } else {
        const nav = host.querySelector(".course-tabs");
        if (nav) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = html;
          const section = wrapper.firstElementChild;
          if (section) nav.insertAdjacentElement("afterend", section);
        }
      }
      if (typeof options.mount === "function") options.mount(container);
      return;
    }

    const incomingWrap = document.createElement("div");
    incomingWrap.innerHTML = html;
    const incoming = incomingWrap.firstElementChild;
    if (!incoming || !outgoing.parentNode) return;

    outgoing.classList.add("view-transition-outgoing", "is-visible");
    incoming.classList.add("view-transition-incoming");
    outgoing.parentNode.insertBefore(incoming, outgoing.nextSibling);

    const duration = readMotionMs();
    raf(() => {
      if (!isTransitionCurrent(gen)) {
        incoming.remove();
        outgoing.classList.remove("view-transition-outgoing", "is-visible", "is-fading");
        return;
      }
      incoming.classList.add("is-visible");
      outgoing.classList.add("is-fading");
    });

    setTimeout(() => {
      if (!isTransitionCurrent(gen)) {
        incoming.remove();
        outgoing.classList.remove("view-transition-outgoing", "is-visible", "is-fading");
        return;
      }
      outgoing.replaceWith(incoming);
      incoming.classList.remove("view-transition-incoming", "is-visible");
      if (typeof options.mount === "function") options.mount(container);
    }, duration);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyDocumentFlag, { once: true });
    } else {
      applyDocumentFlag();
    }
  }

  return {
    STORAGE_KEY,
    TAB_CROSSFADE_MS,
    isSmoothTabsEnabled,
    setSmoothTabsEnabled,
    applyDocumentFlag,
    beginTransition,
    consumeActiveTransition,
    completeTransition,
    cancelTransition,
    isTransitionCurrent,
    paintView,
    paintViewSection,
    readMotionMs
  };
});
