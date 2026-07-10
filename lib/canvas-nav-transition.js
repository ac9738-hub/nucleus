// Unified Canvas browser navigation transition (slate cover + reveal).
// One coordinator per WebContentsView; strict phase machine; no competing reveal paths.

const path = require('path')
const { buildCanvasSlateThemeCss, getThemePalette } = require('../theme-manager')

const CANVAS_SLATE_FADE_MS = 300
const PAINT_SAFETY_MS = CANVAS_SLATE_FADE_MS * 2 + 3000

function createCanvasNavTransition(deps) {
  const {
    rootDir,
    injectAuthorThemeCss,
    normalizeCanvasNavigationUrl,
    urlsLikelyMatchCanvas,
    canvasBlankWarmUrl,
    logSlateCover,
    setTabLoadingState,
    attachWebContentView,
    sendCanvasViewReady,
    getActiveTab,
    getRendererOverlayDepth,
    isCanvasBrowserTab,
    getBrowserBounds,
    getSlate,
    setSlateBounds,
    clearCanvasWebNavigationClaim
  } = deps
  const recordSpan = typeof deps.recordSpan === 'function' ? deps.recordSpan : null

  let slate = null
  let globalSeq = 0
  const byView = new WeakMap()

  function log(event, payload = {}) {
    if (typeof logSlateCover === 'function') {
      logSlateCover(event, payload)
    }
  }

  function urlsMatch(left, right) {
    if (!left || !right) return false
    return urlsLikelyMatchCanvas(
      normalizeCanvasNavigationUrl(left),
      normalizeCanvasNavigationUrl(right)
    )
  }

  function viewUrl(view) {
    if (!view || !view.webContents || view.webContents.isDestroyed()) return ''
    return String(view.webContents.getURL() || '').trim()
  }

  function urlReady(view) {
    const url = viewUrl(view)
    if (!url || url === 'about:blank') return false
    if (url === canvasBlankWarmUrl) return false
    return true
  }

  function ensureSlate(window) {
    if (!slate) {
      slate = getSlate(window)
    }
    return slate
  }

  function syncSlateTransparent() {
    if (!slate || slate.webContents.isDestroyed()) return
    try {
      slate.webContents.setBackgroundColor('#00000000')
    } catch (_error) {
      // Best-effort.
    }
  }

  async function ensureSlateDocumentReady(gotslate) {
    if (!gotslate || gotslate.webContents.isDestroyed()) return false
    if (gotslate._nucleusSlateLoaded) return true
    await new Promise(resolve => {
      gotslate.webContents.once('did-finish-load', resolve)
    })
    gotslate._nucleusSlateLoaded = true
    await applySlateTheme()
    return true
  }

  async function applySlateTheme() {
    if (!slate || slate.webContents.isDestroyed()) return
    const css = buildCanvasSlateThemeCss(rootDir)
    await injectAuthorThemeCss(slate.webContents, 'nucleus-slate-theme', css)
  }

  async function applySlateVisual(gotslate) {
    if (!gotslate || gotslate.webContents.isDestroyed()) return
    await ensureSlateDocumentReady(gotslate)
    syncSlateTransparent()
    await applySlateTheme()
    try {
      await gotslate.webContents.executeJavaScript(`
        (() => {
          const slate = document.querySelector('.slate');
          if (!slate) return;
          slate.classList.remove('has-page-snapshot');
          slate.style.removeProperty('background-image');
          slate.style.removeProperty('background-size');
          slate.style.removeProperty('background-position');
          slate.style.removeProperty('background-repeat');
        })()
      `, true)
    } catch (_error) {
      // Themed gradient fallback remains on .slate.
    }
  }

  async function runFade(gotslate, phase, transitionId) {
    if (!gotslate || gotslate.webContents.isDestroyed()) return false
    const cls = phase === 'out' ? 'fade-out' : 'fade-in'
    const ms = CANVAS_SLATE_FADE_MS
    try {
      const ok = await gotslate.webContents.executeJavaScript(`
        new Promise(resolve => {
          const slate = document.querySelector('.slate');
          if (!slate) { resolve(false); return; }
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            slate.removeEventListener('animationend', onEnd);
            resolve(value !== false);
          };
          const onEnd = (event) => {
            if (event.target === slate) finish(true);
          };
          slate.classList.remove('fade-in', 'fade-out', 'show-right', 'hide-right', 'show-left', 'hide-left');
          slate.style.removeProperty('transform');
          if (${JSON.stringify(cls)} === 'fade-in') {
            slate.style.opacity = '0';
          } else {
            slate.style.opacity = '1';
          }
          void slate.offsetWidth;
          slate.style.setProperty('--slate-fade-duration', ${ms} + 'ms');
          slate.classList.add(${JSON.stringify(cls)});
          slate.addEventListener('animationend', onEnd);
          setTimeout(() => finish(true), ${ms + 120});
        })
      `, true)
      return Boolean(ok)
    } catch (_error) {
      return false
    }
  }

  function attachSlate(window, tab) {
    const gotslate = ensureSlate(window)
    if (gotslate._nucleusCoverUrl !== 'slate.html') {
      gotslate._nucleusCoverUrl = 'slate.html'
      if (!gotslate._nucleusSlateLoaded) {
        gotslate.webContents.loadFile(path.join(rootDir, 'slate.html'))
        gotslate.webContents.once('did-finish-load', () => {
          gotslate._nucleusSlateLoaded = true
          applySlateTheme()
        })
      }
    }
    try {
      window.contentView.removeChildView(gotslate)
    } catch (_error) {
      // Not attached yet.
    }
    setSlateBounds(window, tab)
    window.contentView.addChildView(gotslate)
    return gotslate
  }

  function keepSlateAbove(window) {
    if (!window || window.isDestroyed() || !slate || slate.webContents.isDestroyed()) return
    if (!slate._nucleusCanvasCoverActive) return
    try {
      window.contentView.removeChildView(slate)
      window.contentView.addChildView(slate)
    } catch (_error) {
      // Best-effort.
    }
  }

  function setPaintOccluded(view, window, occluded) {
    if (!view || view.webContents.isDestroyed()) return
    view._nucleusPaintOccluded = Boolean(occluded)
    if (!occluded) return
    keepSlateAbove(window)
  }

  function clearViewFlags(view) {
    if (!view) return
    view._nucleusCanvasSlateCoverActive = false
    view._nucleusSlateRevealPending = false
    view._nucleusPaintOccluded = false
    view._nucleusNavTransitionId = 0
    view._nucleusTransitionPaintHandler = null
  }

  function hideSlateInstant(reason) {
    if (!slate || slate.webContents.isDestroyed()) return
    slate._nucleusCanvasCoverActive = false
    slate._nucleusFadeInFlight = false
    slate.setVisible(false)
    log('hide', { reason })
  }

  function clearSafety(t) {
    if (!t || !t.safetyTimer) return
    clearTimeout(t.safetyTimer)
    t.safetyTimer = null
  }

  function detachListeners(t) {
    if (!t || !t.view || t.view.webContents.isDestroyed()) return
    const wc = t.view.webContents
    if (t.onNavigate) wc.removeListener('did-navigate', t.onNavigate)
    if (t.onNavigateInPage) wc.removeListener('did-navigate-in-page', t.onNavigateInPage)
    t.onNavigate = null
    t.onNavigateInPage = null
    t.view._nucleusTransitionPaintHandler = null
  }

  function nudgePaint(view, reason) {
    if (!view || view.webContents.isDestroyed()) return
    const safeReason = JSON.stringify(String(reason || 'unspecified'))
    view.webContents.executeJavaScript(
      `typeof window.__nucleusScheduleCanvasFirstPaint === 'function' && window.__nucleusScheduleCanvasFirstPaint(${safeReason})`,
      true
    ).catch(() => {})
  }

  function isActive(view) {
    if (!view) return false
    const t = byView.get(view)
    if (t && !t.done && !t.aborted) return true
    if (view._nucleusCanvasSlateCoverActive) return true
    if (slate && slate._nucleusCanvasCoverActive) return true
    if (slate && slate._nucleusFadeInFlight) return true
    return false
  }

  function revealView(view, tab, window, reason) {
    if (!view || view.webContents.isDestroyed()) {
      hideSlateInstant(reason)
      return false
    }
    const activeTab = getActiveTab()
    const isActiveTab = activeTab && tab && deps.sameTabId(activeTab.id, tab.id)
    clearViewFlags(view)
    hideSlateInstant(reason)
    if (tab) {
      setTabLoadingState(tab, false, 'active')
      tab._nucleusConcealWebSource = false
    }
    if (typeof clearCanvasWebNavigationClaim === 'function') {
      clearCanvasWebNavigationClaim(view)
    }
    if (!isActiveTab || !window || window.isDestroyed()) {
      view.setVisible(false)
      return false
    }
    if (getRendererOverlayDepth() > 0 || view._nucleusBlankedForCanvasWipe) {
      view.setVisible(false)
      return false
    }
    attachWebContentView(window, view, tab)
    view.setVisible(true)
    sendCanvasViewReady(window, tab)
    log('ensure_revealed', {
      reason,
      tabId: tab && tab.id ? tab.id : '',
      url: viewUrl(view)
    })
    return true
  }

  async function commitReveal(t, reason) {
    if (!t || t.aborted || t.done || t.revealing) return false
    if (t.phase !== 'paint_wait') return false
    if (!urlReady(t.view)) return false
    const liveUrl = viewUrl(t.view)
    if (
      t.destUrl &&
      !urlsMatch(liveUrl, t.destUrl) &&
      reason !== 'safety_timeout' &&
      reason !== 'force_reveal'
    ) {
      return false
    }

    t.revealing = true
    t.phase = 'revealing'
    clearSafety(t)
    detachListeners(t)

    const { view, tab, window, id } = t
    if (view._nucleusNavTransitionId !== id) {
      t.revealing = false
      return false
    }

    const gotslate = slate
    if (gotslate && gotslate._nucleusCanvasCoverActive) {
      await applySlateVisual(gotslate)
      attachWebContentView(window, view, tab)
      view.setVisible(true)
      keepSlateAbove(window)
      try {
        await view.webContents.executeJavaScript(
          `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
          true
        )
      } catch (_error) {
        // Best-effort.
      }
      await runFade(gotslate, 'out', id)
    }

    if (t.aborted || view._nucleusNavTransitionId !== id) {
      t.revealing = false
      return false
    }

    t.done = true
    settleRevealWaiter(t, true)
    byView.delete(view)
    revealView(view, tab, window, reason)
    log('dismiss', {
      reason,
      tabId: tab && tab.id ? tab.id : '',
      url: viewUrl(view),
      destUrl: t.destUrl || ''
    })
    return true
  }

  function syncDestUrlFromLive(t) {
    if (!t || !t.view || !t.view.webContents || t.view.webContents.isDestroyed()) return
    const live = viewUrl(t.view)
    if (!urlReady(t.view)) return
    if (!t.destUrl || !urlsMatch(live, t.destUrl)) {
      t.destUrl = live
    }
  }

  function armPaintWait(t) {
    if (!t || t.aborted) return
    const { view } = t
    if (!view || !view.webContents || view.webContents.isDestroyed()) return

    detachListeners(t)

    t.phase = 'paint_wait'
    t.paintGateOpen = false

    const tryReveal = (reason) => {
      if (!t.paintGateOpen) return
      void commitReveal(t, reason)
    }

    t.view._nucleusTransitionPaintHandler = (payload = {}) => {
      if (t.aborted || t.done || t.revealing) return
      const activeView = t.view
      if (!activeView || activeView._nucleusNavTransitionId !== t.id) return
      if (!t.paintGateOpen) return
      syncDestUrlFromLive(t)
      if (t.destUrl && !urlsMatch(viewUrl(activeView), t.destUrl)) return
      if (payload.generation != null && t.minPaintGeneration != null) {
        if (Number(payload.generation) <= Number(t.minPaintGeneration)) return
      }
      tryReveal('paint_ready')
    }

    const openPaintGate = (reason) => {
      if (t.aborted || t.done) return
      const activeView = t.view
      if (!activeView || !activeView.webContents || activeView.webContents.isDestroyed()) return
      t.paintGateOpen = true
      if (t.window) {
        attachWebContentView(t.window, activeView, t.tab)
        activeView.setVisible(true)
        keepSlateAbove(t.window)
      }
      nudgePaint(activeView, reason)
      syncDestUrlFromLive(t)
      if (urlReady(activeView) && (!t.destUrl || urlsMatch(viewUrl(activeView), t.destUrl))) {
        tryReveal('paint_gate_open')
      }
    }

    const onNavigate = () => {
      syncDestUrlFromLive(t)
      openPaintGate('did_navigate')
    }
    const onNavigateInPage = () => {
      syncDestUrlFromLive(t)
      openPaintGate('did_navigate_in_page')
    }
    t.onNavigate = onNavigate
    t.onNavigateInPage = onNavigateInPage
    view.webContents.on('did-navigate', onNavigate)
    view.webContents.on('did-navigate-in-page', onNavigateInPage)

    clearSafety(t)
    t.safetyTimer = setTimeout(() => {
      if (t.aborted || t.done || t.revealing) return
      if (!t.paintGateOpen) {
        openPaintGate('safety_open_gate')
      }
      syncDestUrlFromLive(t)
      if (urlReady(t.view)) {
        void commitReveal(t, 'safety_timeout')
      }
    }, PAINT_SAFETY_MS)

    openPaintGate('paint_wait_armed')
  }

  function settleRevealWaiter(t, ok) {
    if (!t || !t._revealDoneResolve) return
    const resolve = t._revealDoneResolve
    t._revealDoneResolve = null
    t._revealDonePromise = null
    resolve(Boolean(ok))
  }

  function ensureRevealWaiter(t) {
    if (!t._revealDonePromise) {
      t._revealDonePromise = new Promise(resolve => {
        t._revealDoneResolve = resolve
      })
    }
    return t._revealDonePromise
  }

  async function cancel(view, reason = 'cancelled') {
    if (!view) return
    const t = byView.get(view)
    if (t) {
      t.aborted = true
      settleRevealWaiter(t, false)
      clearSafety(t)
      detachListeners(t)
      byView.delete(view)
    }
    clearViewFlags(view)
    hideSlateInstant(reason)
    if (typeof clearCanvasWebNavigationClaim === 'function') {
      clearCanvasWebNavigationClaim(view)
    }
    log('cancel', { reason, url: viewUrl(view) })
  }

  async function cover(window, tab, view, options = {}) {
    const runCover = async () => {
    if (!window || window.isDestroyed() || !view || view.webContents.isDestroyed()) {
      return null
    }
    if (tab && !isCanvasBrowserTab(tab)) return null

    await cancel(view, 'superseded')

    const id = ++globalSeq
    const sourceUrl = options.sourceUrl != null
      ? String(options.sourceUrl)
      : viewUrl(view)
    const t = {
      id,
      view,
      tab,
      window,
      sourceUrl,
      destUrl: options.destUrl != null ? String(options.destUrl) : null,
      reason: String(options.reason || 'cover'),
      phase: 'covering',
      aborted: false,
      done: false,
      revealing: false,
      paintGateOpen: false,
      minPaintGeneration: options.minPaintGeneration != null ? Number(options.minPaintGeneration) : null,
      safetyTimer: null,
      onNavigate: null,
      onNavigateInPage: null
    }
    byView.set(view, t)

    if (tab) setTabLoadingState(tab, true, 'active')
    const concealSource = Boolean(
      options.concealSource ||
      (tab && tab._nucleusConcealWebSource)
    )
    view._nucleusNavTransitionId = id
    view._nucleusCanvasSlateCoverActive = true
    attachWebContentView(window, view, tab)
    if (!concealSource) {
      view.setVisible(true)
    }

    const gotslate = attachSlate(window, tab)
    gotslate._nucleusCanvasCoverActive = true
    gotslate.setVisible(true)
    gotslate._nucleusFadeInFlight = true
    await applySlateVisual(gotslate)
    if (t.aborted || view._nucleusNavTransitionId !== id) {
      gotslate._nucleusFadeInFlight = false
      return null
    }
    await runFade(gotslate, 'in', id)
    gotslate._nucleusFadeInFlight = false
    if (t.aborted || view._nucleusNavTransitionId !== id) return null

    setPaintOccluded(view, window, true)
    view.setVisible(false)

    t.phase = 'navigating'
    if (tab && concealSource) {
      tab._nucleusConcealWebSource = false
    }
    log('cover_ready', {
      reason: t.reason,
      tabId: tab && tab.id ? tab.id : '',
      sourceUrl,
      concealSource
    })
    return t
    }
    if (typeof recordSpan === 'function') {
      return recordSpan('nav.cover', runCover, { reason: options.reason || 'cover' })
    }
    return runCover()
  }

  function transfer(fromView, toView, tab, window, options = {}) {
    const t = byView.get(fromView)
    if (!t || t.aborted || t.done) return null
    byView.delete(fromView)
    clearViewFlags(fromView)

    t.view = toView
    t.tab = tab
    t.window = window
    if (options.destUrl != null) t.destUrl = String(options.destUrl)
    byView.set(toView, t)

    toView._nucleusNavTransitionId = t.id
    toView._nucleusCanvasSlateCoverActive = true
    toView.setVisible(false)
    setPaintOccluded(toView, window, true)

    t.phase = 'navigating'
    log('transfer', {
      tabId: tab && tab.id ? tab.id : '',
      destUrl: t.destUrl || '',
      fromUrl: viewUrl(fromView),
      toUrl: viewUrl(toView)
    })
    return t
  }

  function waitForReveal(window, tab, view, destUrl, options = {}) {
    const runWait = () => {
    const t = byView.get(view)
    if (!t || t.aborted || t.done) {
      if (destUrl && urlReady(view)) {
        revealView(view, tab, window, 'direct_reveal')
      }
      return Promise.resolve(true)
    }
    if (destUrl != null) t.destUrl = String(destUrl)
    if (options.minPaintGeneration != null) {
      t.minPaintGeneration = Number(options.minPaintGeneration)
    }
    const waiter = ensureRevealWaiter(t)
    armPaintWait(t)
    const maxWaitMs = options.maxWaitMs != null
      ? Number(options.maxWaitMs)
      : PAINT_SAFETY_MS + 500
    return Promise.race([
      waiter,
      new Promise(resolve => {
        setTimeout(() => {
          const active = byView.get(view)
          if (!active || active.done || active.aborted) {
            resolve(true)
            return
          }
          void forceReveal(view, tab, window, 'wait_reveal_timeout').then(() => {
            resolve(true)
          })
        }, maxWaitMs)
      })
    ])
    }
    if (typeof recordSpan === 'function') {
      return recordSpan('nav.wait_reveal', runWait, { destUrl: destUrl ? String(destUrl).slice(0, 120) : '' })
    }
    return runWait()
  }

  async function forceReveal(view, tab, window, reason = 'force_reveal') {
    const t = byView.get(view)
    if (!t || t.aborted || t.done) {
      revealView(view, tab, window, reason)
      return
    }
    t.paintGateOpen = true
    await commitReveal(t, reason)
  }

  async function revealSlateOnly(window, tab, reason = 'slate_only_reveal') {
    const gotslate = slate
    const view = tab && tab.view
    const t = view ? byView.get(view) : null

    if (gotslate && !gotslate.webContents.isDestroyed() && gotslate._nucleusCanvasCoverActive) {
      await applySlateVisual(gotslate)
      await runFade(gotslate, 'out', t ? t.id : ++globalSeq)
    }

    if (t) {
      t.done = true
      settleRevealWaiter(t, true)
      clearSafety(t)
      detachListeners(t)
      byView.delete(t.view)
      clearViewFlags(t.view)
    } else if (view) {
      clearViewFlags(view)
    }

    hideSlateInstant(reason)
    if (tab) {
      setTabLoadingState(tab, false, 'active')
      tab._nucleusConcealWebSource = false
    }
    if (typeof clearCanvasWebNavigationClaim === 'function' && view) {
      clearCanvasWebNavigationClaim(view)
    }
    log('dismiss', {
      reason,
      tabId: tab && tab.id ? tab.id : '',
      slateOnly: true
    })
    return true
  }

  function handleFirstPaint(view, payload = {}) {
    if (!view) return
    const handler = view._nucleusTransitionPaintHandler
    if (typeof handler === 'function') handler(payload)
  }

  function renderWhileTransition(view, tab, window) {
    if (!isActive(view)) return false
    const t = byView.get(view)
    if (t && t.phase === 'paint_wait' && view && !view.webContents.isDestroyed()) {
      attachWebContentView(window, view, tab)
      view.setVisible(true)
    }
    setPaintOccluded(view, window, true)
    keepSlateAbove(window)
    return true
  }

  return {
    CANVAS_SLATE_FADE_MS,
    PAINT_SAFETY_MS,
    cover,
    transfer,
    waitForReveal,
    cancel,
    forceReveal,
    revealSlateOnly,
    handleFirstPaint,
    isActive,
    renderWhileTransition,
    revealView,
    hideSlateInstant,
    nudgePaint
  }
}

module.exports = {
  CANVAS_SLATE_FADE_MS,
  createCanvasNavTransition
}
