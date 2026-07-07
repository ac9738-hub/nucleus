// TEMPORARY debug panel — LUMI sidebar (no overlay / no WebContentsView hiding).
// Remove script tag from index.html when done debugging.
(function () {
  'use strict'

  const POLL_MS = 500
  let pollTimer = null
  let panel = null
  let bodyEl = null
  let hidden = false

  function shortenUrl(url, max = 72) {
    const text = String(url || '').trim()
    if (!text) return '(none)'
    if (text.length <= max) return text
    return `${text.slice(0, max - 1)}…`
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function formatSlotLine(slot) {
    const state = slot.state || 'idle'
    const role = slot.role ? ` · ${slot.role}` : ''
    const url = shortenUrl(slot.url)
    const reason = slot.loadReason ? ` · ${slot.loadReason}` : ''
    return `[${slot.index}] ${state}${role}${reason} — ${url}`
  }

  function formatMb(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    return `${n} MB`
  }

  function formatPct(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    return `${n}%`
  }

  function readRendererMemory() {
    if (typeof performance === 'undefined' || !performance.memory) return null
    return {
      heapUsedMb: Math.round(performance.memory.usedJSHeapSize / 1048576),
      heapTotalMb: Math.round(performance.memory.totalJSHeapSize / 1048576),
      heapLimitMb: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
    }
  }

  function formatTypeRollup(byType) {
    if (!byType || typeof byType !== 'object') return '(no process metrics)'
    const keys = Object.keys(byType)
    if (!keys.length) return '(no process metrics)'
    return keys.map(type => {
      const row = byType[type]
      return `${type}×${row.count} ${row.workingSetMb}MB cpu ${formatPct(row.cpuPct)}`
    })
  }

  function renderResources(resources) {
    if (!resources) return '<div class="cpd-line">(resources unavailable)</div>'

    const rendererMem = readRendererMemory()
    const counts = resources.counts || {}
    const top = Array.isArray(resources.electron && resources.electron.topConsumers)
      ? resources.electron.topConsumers
      : []
    const topLines = top.length
      ? top.map(entry => `${entry.type}#${entry.pid} ${entry.workingSetMb}MB cpu ${formatPct(entry.cpuPct)}`)
      : ['(no top consumers)']

    const mainCpu = resources.main && resources.main.cpuPct != null
      ? formatPct(resources.main.cpuPct)
      : 'warming…'

    return `
      <div class="cpd-row"><span class="cpd-label">system</span> ${formatMb(resources.system && resources.system.freeMemMb)} free / ${formatMb(resources.system && resources.system.totalMemMb)} · ${formatPct(resources.system && resources.system.usedMemPct)} used</div>
      <div class="cpd-row"><span class="cpd-label">main</span> rss ${formatMb(resources.main && resources.main.rssMb)} · heap ${formatMb(resources.main && resources.main.heapUsedMb)}/${formatMb(resources.main && resources.main.heapTotalMb)} · cpu ${mainCpu}</div>
      ${rendererMem
        ? `<div class="cpd-row"><span class="cpd-label">renderer</span> js heap ${rendererMem.heapUsedMb}/${rendererMem.heapTotalMb} MB (limit ${rendererMem.heapLimitMb})</div>`
        : ''}
      <div class="cpd-row"><span class="cpd-label">electron</span> ${resources.electron && resources.electron.processCount || 0} procs · ${formatMb(resources.electron && resources.electron.totalWorkingSetMb)} ws · cpu ${formatPct(resources.electron && resources.electron.totalCpuPct)}</div>
      <div class="cpd-line">${escapeHtml(formatTypeRollup(resources.electron && resources.electron.byType))}</div>
      <div class="cpd-row"><span class="cpd-label">tabs</span> ${counts.tabs ?? 0} (canvas ${counts.canvasTabs ?? 0} · browser ${counts.browserTabs ?? 0}) · pool web ${counts.poolWebInUse ?? 0}/${counts.poolWeb ?? 0} canvas ${counts.poolCanvasInUse ?? 0}/${counts.poolCanvas ?? 0} · preload ${counts.preloadSlotsActive ?? 0}/${counts.preloadSlots ?? 0}</div>
      <div class="cpd-section" style="margin-top:4px">Top processes</div>
      ${topLines.map(line => `<div class="cpd-line">${escapeHtml(line)}</div>`).join('')}
    `
  }

  function renderPanel(data) {
    if (!bodyEl) return

    const stats = data && data.stats ? data.stats : {}
    const metrics = data && data.metrics ? data.metrics : {}
    const slots = Array.isArray(data && data.slots) ? data.slots : []
    const plan = Array.isArray(stats.lastPlan) ? stats.lastPlan : []
    const hints = Array.isArray(data && data.pointerHints) ? data.pointerHints : []
    const diag = data && data.pointerHintDiagnostics ? data.pointerHintDiagnostics : {}

    const activeSlots = slots.filter(slot => slot && slot.url)
    const slotLines = activeSlots.length
      ? activeSlots.map(formatSlotLine)
      : ['(no predicted loads in pool)']

    const planLines = plan.length
      ? plan.map((entry, index) => {
        const label = entry.reason || entry.source || entry.kind || 'candidate'
        return `${index + 1}. ${Number(entry.priority || 0).toFixed(2)} ${label} — ${shortenUrl(entry.url, 48)}`
      })
      : ['(planner empty)']

    const hintLines = hints.length
      ? hints.map((hint, index) => {
        const score = Number(hint.combined || 0).toFixed(2)
        return `${index + 1}. ${score} — ${shortenUrl(hint.url, 48)}`
      })
      : ['(no pointer hints)']

    const hitRate = metrics.hitRate == null ? '—' : `${(metrics.hitRate * 100).toFixed(1)}%`
    const lastHit = stats.lastHit && typeof stats.lastHit === 'object' ? stats.lastHit : null
    const lastHitLine = lastHit
      ? `${escapeHtml(lastHit.display || '—')} · ${escapeHtml(shortenUrl(lastHit.url, 48))}${lastHit.source ? ` · ${escapeHtml(lastHit.source)}` : ''}`
      : '(none)'
    const hintAge = diag.lastAt ? `${Math.max(0, Date.now() - diag.lastAt)}ms ago` : 'never'
    const cachedTabs = Array.isArray(diag.cachedTabs) ? diag.cachedTabs : []

    bodyEl.innerHTML = `
      <div class="cpd-section">Resources</div>
      ${renderResources(data.resources)}
      <div class="cpd-row"><span class="cpd-label">main tab</span> ${escapeHtml(data.activeTabId || '—')}</div>
      <div class="cpd-row"><span class="cpd-label">hint tab</span> ${escapeHtml(data.hintTabId || '—')}</div>
      <div class="cpd-row"><span class="cpd-label">predictive hits</span> ${stats.hits ?? 0} · <span class="cpd-label">misses</span> ${stats.misses ?? 0} · <span class="cpd-label">rate</span> ${hitRate}</div>
      <div class="cpd-row"><span class="cpd-label">last hit</span> ${lastHitLine}</div>
      <div class="cpd-section">Pointer IPC</div>
      <div class="cpd-row"><span class="cpd-label">received</span> ${diag.received ?? 0} · <span class="cpd-label">stored</span> ${diag.stored ?? 0}</div>
      <div class="cpd-row"><span class="cpd-label">last</span> ${hintAge} · <span class="cpd-label">links</span> ${diag.lastLinkCount ?? 0} · <span class="cpd-label">src</span> ${escapeHtml(diag.lastSource || '—')}</div>
      <div class="cpd-row"><span class="cpd-label">drops</span> noTab ${diag.droppedNoTabId ?? 0} · notCanvas ${diag.droppedNotCanvasTab ?? 0} · inactive ${diag.refreshSkippedInactive ?? 0}</div>
      ${cachedTabs.length
        ? cachedTabs.map(entry => `<div class="cpd-line">${escapeHtml(entry.tabId)}: ${entry.linkCount} links (${entry.ageMs == null ? '?' : `${entry.ageMs}ms`})</div>`).join('')
        : '<div class="cpd-line">(no cached hint tabs)</div>'}
      <div class="cpd-section">Predicted loads</div>
      ${slotLines.map(line => `<div class="cpd-line">${escapeHtml(line)}</div>`).join('')}
      <div class="cpd-section">Ranked plan</div>
      ${planLines.map(line => `<div class="cpd-line">${escapeHtml(line)}</div>`).join('')}
      <div class="cpd-section">Pointer hints</div>
      ${hintLines.map(line => `<div class="cpd-line">${escapeHtml(line)}</div>`).join('')}
    `
  }

  async function refresh() {
    if (!bodyEl || hidden) return
    if (!window.nucleus) {
      bodyEl.textContent = 'IPC unavailable (window.nucleus missing)'
      return
    }
    if (typeof window.nucleus.preloadError === 'function') {
      bodyEl.textContent = `Preload error: ${window.nucleus.preloadError()}`
      return
    }
    if (typeof window.nucleus.canvasPreloadStats !== 'function') {
      bodyEl.textContent = 'IPC unavailable (preload bridge incomplete)'
      return
    }
    try {
      const data = await window.nucleus.canvasPreloadStats({})
      if (!data || data.ok === false) {
        bodyEl.textContent = 'Preload stats unavailable'
        return
      }
      renderPanel(data)
    } catch (error) {
      bodyEl.textContent = `Preload stats error: ${error && error.message ? error.message : String(error)}`
    }
  }

  function injectStyles() {
    if (document.getElementById('canvas-preload-debug-style')) return
    const style = document.createElement('style')
    style.id = 'canvas-preload-debug-style'
    style.textContent = `
      #canvas-preload-debug {
        flex: 0 0 auto;
        max-height: min(48vh, 420px);
        overflow: auto;
        margin: 0 12px 8px;
        border-radius: 10px;
        border: 1px solid rgba(120, 180, 255, 0.28);
        background: rgba(8, 12, 20, 0.72);
        color: #e8eef8;
        font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      #canvas-preload-debug .cpd-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 9px;
        border-bottom: 1px solid rgba(120, 180, 255, 0.2);
        position: sticky;
        top: 0;
        background: rgba(8, 12, 20, 0.94);
        z-index: 1;
      }
      #canvas-preload-debug .cpd-title {
        font-weight: 700;
        letter-spacing: 0.02em;
        color: #9ec5ff;
        font-size: 10px;
      }
      #canvas-preload-debug .cpd-actions button {
        border: 1px solid rgba(120, 180, 255, 0.35);
        background: rgba(30, 45, 70, 0.8);
        color: #dbe8ff;
        border-radius: 6px;
        padding: 2px 7px;
        font: inherit;
        cursor: pointer;
      }
      #canvas-preload-debug .cpd-body {
        padding: 7px 9px 9px;
      }
      #canvas-preload-debug .cpd-section {
        margin-top: 7px;
        margin-bottom: 3px;
        color: #9ec5ff;
        font-weight: 600;
        text-transform: uppercase;
        font-size: 9px;
        letter-spacing: 0.06em;
      }
      #canvas-preload-debug .cpd-row,
      #canvas-preload-debug .cpd-line {
        word-break: break-all;
      }
      #canvas-preload-debug .cpd-label {
        color: #8aa0c2;
      }
      #canvas-preload-debug.is-hidden {
        display: none;
      }
    `
    document.head.appendChild(style)
  }

  function mount() {
    if (panel) return

    const aiPanel = document.getElementById('ai-panel')
    const inputSection = aiPanel && aiPanel.querySelector('.ai-input-section')
    if (!aiPanel || !inputSection) return

    injectStyles()

    panel = document.createElement('div')
    panel.id = 'canvas-preload-debug'
    panel.innerHTML = `
      <div class="cpd-header">
        <div class="cpd-title">Canvas preload (debug)</div>
        <div class="cpd-actions">
          <button type="button" data-cpd-hide>Hide</button>
        </div>
      </div>
      <div class="cpd-body">Loading…</div>
    `
    aiPanel.insertBefore(panel, inputSection)
    bodyEl = panel.querySelector('.cpd-body')

    panel.querySelector('[data-cpd-hide]').addEventListener('click', () => {
      hidden = true
      panel.classList.add('is-hidden')
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    })

    pollTimer = setInterval(() => {
      void refresh()
    }, POLL_MS)
    void refresh()
  }

  function tryMount() {
    mount()
    if (!panel) {
      window.setTimeout(tryMount, 250)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryMount, { once: true })
  } else {
    tryMount()
  }
})()
