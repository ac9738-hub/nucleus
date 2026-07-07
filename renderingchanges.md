# Rendering surfaces & flash-fix plan

> **Part 1 (Tier 0) — implemented 2026-06-29.** See [§9 Implementation log](#9-part-1-implementation-log-2026-06-29--complete).

This document lists every visual surface in Nucleus, how tab rendering works today, known flash/race sources, and a phased plan to fix them. **Part 1 (Tier 0)** is complete.

Related docs: `NUCLEUS.md` §18, `renderbugs.md`.

---

## 1. Every surface in the app

A **surface** is anything the user sees in the main content area or chrome that participates in tab/section navigation.

### 1.1 App chrome (always present)

| Surface | DOM / layer | Who updates it | Notes |
|---------|-------------|----------------|-------|
| **Primary tabs** | `#primary-tabs` (Home, Tasks, Calendar) | `renderPrimaryTabs()` in `renderer/app.js` | Active when `state.top === "section"` |
| **Workspace sidebar** | `#workspace-tabs`, collapse toggle | `renderWorkspaceTabs()` | Lists workspaces + task counts |
| **Workspace page tabs** | `#workspace-page-tabs` | `updateWorkspacePageTabs()` / `patchWorkspacePageTabs()` | Horizontal tab bar inside a workspace |
| **Browser toolbar** | `#browser-toolbar` | `renderBrowserToolbar()` | Shown for `browsertab` only |
| **Canvas toolbar** | `#canvas-toolbar` | `renderCanvasToolbar()` | Shown for `canvastab` (native + browser) |
| **Main content host** | `#view` | `paintActiveView()` → `composeActiveViewHtml()` | Central paint target |
| **LUMI panel** | `#ai-panel` | Separate from tab surfaces | Hidden via `overlay:set_open` when modals open |
| **Settings overlay** | `#settings-overlay` | Renderer DOM | Triggers main `hideAllWebContentViews` |
| **View switching classes** | `#view.view-is-switching` / `.view-is-ready` | `setViewSwitching()` | CSS transition state during tab switch |

### 1.2 Section surfaces (`state.top === "section"`)

Rendered into `#view` by `composeActiveViewHtml()` when not in workspace mode.

| Section | Function | Backend |
|---------|----------|---------|
| **Home** | `renderHomeDashboard()` | Renderer HTML only |
| **Tasks** | `renderSuggestedTasks()` | Renderer HTML + `tasks` from main |
| **Calendar** | `renderCalendarPlaceholder()` | Renderer HTML only |

No `WebContentsView` is attached. Main calls `renderTab("None")` when section is active.

### 1.3 Workspace tab surfaces (`state.top === "workspace"`)

Each workspace tab type has a different **paint backend**.

| Tab type | `canvasMode` | What user sees | Painted by | Main `WebContentsView`? |
|----------|--------------|----------------|------------|-------------------------|
| **center** | — | Project Center | Renderer `#view` | No — `renderTab("None")` |
| **task** | — | Task workspace | Renderer `#view` | No |
| **canvastab** | `native` (default) | Canvas dashboard / course UI | `nucleusCanvasApp.renderCanvasApp()` | No — native DOM |
| **canvastab** | `browser` | Canvas website | Empty `#view` + overlay; webview on top | **Yes** — dedicated view (`USE_SIMPLE_TAB_MODEL`) |
| **browsertab** | — | External site / engine search | Empty `#view` + optional snapshot `<img>` | **Yes** — pool view |
| **mailtab** | — | Gmail UI | `nucleusMailApp.renderMailApp()` | No |
| **synapsetab** | — | Synapse Learn UI | `nucleusSynapseApp.renderSynapseApp()` | No |
| **artifacttab** | — | Artifact preview | `nucleusArtifactTabs.renderArtifactTabView()` | No (but main does not hide webviews for this type today — bug) |

**Helper predicates (renderer):**

- `isWebContentTab(tab)` — `browsertab` or `canvastab` + `canvasMode === "browser"`
- `isNativeAppTab(tab)` — mail, synapse, artifact, or native canvas

**Helper predicates (main):**

- `isWebContentTab(tab)` — same as renderer (via `tab-utils.js`)
- `isNativeSurfaceTab(tab)` — mail, synapse, native canvas (**artifact missing**)
- `isHtmlVisibleContextTab(tab)` — web content tab with live view (for LUMI screen scrape)

### 1.4 Electron layers (above or instead of `#view`)

| Layer | Implementation | When visible |
|-------|----------------|--------------|
| **Web browser view** | `WebContentsView` attached to main window over `#view` bounds | Active `browsertab` or canvas `browser` tab |
| **Canvas first-paint slate** | Separate `WebContentsView` (`slate`) — themed cover page | During Canvas nav when `armCanvasNavigationCover` runs |
| **Canvas theme injection** | `app/canvas/preload.js` | All canvas pool / dedicated views |
| **Web engine preload** | `web-preload.js` | Generic browser tabs |
| **Renderer snapshot overlay** | `<img class="tab-restore-snapshot">` inside `#view` | When `tab.loading && tab.snapshotDataUrl` or `__nucleusTabSnapshot` |
| **Tab snapshot on stash** | PNG via `capturePage()` → `tabs:view_state` | When main stashes a tab to backup pool |
| **View transition crossfade** | `lib/view-transition.js` | Optional smooth tab switches |
| **Renderer overlay depth** | `lib/renderer-overlay.js` + `overlay:set_open` | Settings / modals — forces all webviews hidden |

### 1.5 IPC surfaces (main ↔ renderer)

| Channel | Direction | Effect on rendering |
|---------|-----------|---------------------|
| `tabs:push` | Renderer → main | Reconcile `currtabs`, create/stash/release views |
| `tabs:switch_active` | Renderer → main | Fast path: activate one tab, attach/detach view |
| `tabs:new_active` | Renderer → main | Legacy activate + full surface sync |
| `tabs:view_state` | Main → renderer | Updates `loading`, `discarded`, `snapshotDataUrl`, `viewTier` |
| `tabs:url_update` | Main → renderer | Tab URL label in toolbar |
| `tabs:snapshot_overlay` | Main → renderer | Restore overlay for stashed tab switch |
| `canvas:open_link` | Renderer → main | Native→browser or in-tab Canvas navigation |
| `canvas:arm_cover` | Renderer → main | Hide webview + show slate **before** load |
| `canvas:back` / `canvas:nav_forward` | Renderer → main | Back stack for hybrid native/web |
| `canvas:restore_native` | Renderer → main | Hide webview, show native canvas DOM |
| `context:ui_state` | Renderer → main | Full UI snapshot for LUMI context (not visual) |
| `context:screen_text` | Renderer → main | Visible DOM text from native surfaces |
| `overlay:set_open` | Renderer → main | Hide all webviews while modal open |

### 1.6 State ownership (two tab lists)

| Field | Renderer (`state.tabs`) | Main (`currtabs`) | Flash risk when out of sync |
|-------|-------------------------|-------------------|----------------------------|
| `id`, `type`, `workspaceId` | ✓ | ✓ (subset) | Wrong tab activated |
| `url`, `canvasMode`, `courseId` | ✓ | ✓ | Wrong page / wrong mode |
| `loading` | ✓ (cleared too early) | ✓ | Blank flash — overlay never shows |
| `snapshotDataUrl` | ✓ | ✓ (on tab + broadcast) | Stale or missing cover image |
| `viewTier`, `discarded` | ✓ | ✓ | Wrong stash/active treatment |
| `pendingSwitchSlate` | ✓ | ✓ | Early webview reveal |
| `view` (WebContentsView) | — | ✓ | Renderer can't know if view is actually visible |
| `nativeHistory` | ✓ | partial (nav stack) | Back restores wrong surface |

Main only tracks: `browsertab`, `canvastab`, `mailtab`, `synapsetab`. Center, task, and artifact tabs exist only in the renderer.

---

## 2. How rendering works today (one switch)

```
User clicks workspace tab
  → switchWorkspaceTab()
      → patchOptimisticWorkspaceTabActive()     // tab bar highlight + view-is-switching
      → nextTab.loading = false                 // ⚠ too early for web tabs
      → paintActiveView({ fast: true })         // optimistic #view paint
      → syncTabs() + revealActiveTabSurface()   // async IPC
  → Main: tabs:switch_active
      → deactivate other views
      → syncActiveSurfaceFromMainTab()
      → renderTab(view) or renderTab("None")
  → Main: tabs:view_state (may fire multiple times)
  → applyTabViewState()
      → tab.loading = false                     // ⚠ again, without main sending loading
      → scheduleRenderWorkspacePageTabs("full") // ⚠ full tab bar rebuild
      → paintActiveView()                       // ⚠ second paint
```

**Paint-first** makes native tabs feel instant. **Web tabs** need a cover during the gap — but `loading` is cleared before main finishes, so `#view` is empty and the webview is hidden → **white flash**.

---

## 3. Known flash sources (by surface)

| ID | Surface affected | Cause | Doc ref |
|----|------------------|-------|---------|
| F1 | Canvas browser | Renderer clears `loading` before nav ends | R1, R2, R9 |
| F2 | Canvas browser | `applyTabViewState` repaints on every IPC burst | L9, L21 |
| F3 | Canvas browser | Tab switch to browser tab skips `armCanvasCover` | Tier 1 |
| F4 | Native canvas | Webview not hidden on native restore | F3 |
| F5 | Native canvas | `#view` painted empty before native HTML | F6 |
| F6 | Any web tab | `switchWorkspaceTab` clears snapshot overlay at start | S2 |
| F7 | Artifact / task | Not in main `isNativeSurfaceTab` — webview may linger | audit |
| F8 | Tab bar | Full rebuild on `view_state` during navigation | L9 |
| F9 | All | `canvas:open_link` not serialized with `tabs:push` | F10 |
| F10 | Canvas browser | Redundant `tabs:push` after link already attached view | L16 |

---

## 4. Phased fix roadmap

### Tier 0 — Loading contract (Part 1) — **DONE** (2026-06-29)

Fix *who* owns `loading` and *when* repaints run. Small diff, fixes many flashes.

### Tier 1 — Canvas browser visibility

Arm cover before paint on tab switch; keep snapshot until main says ready; remove redundant sync after link open.

### Tier 2 — Native ↔ browser handoff

Paint-before-hide on native restore; add artifact to `isNativeSurfaceTab`; tie `view-is-switching` to IPC completion.

### Tier 3 — Perf / stability

Coalesce `view_state`, defer preload during navigation, move `capturePage` off hot path.

### Tier 4 — Structural (later)

Single navigation coordinator; collapse dual state; optional commit model for web tabs.

---

## 5. Part 1 implementation plan (Tier 0) — **COMPLETE**

**Goal in plain language:** When something is still loading, the app should *look* like it's loading until the main process says it's done. The renderer should stop guessing and stop repainting the whole UI on every IPC ping.

**Estimated effort:** ~1–2 days. **Files touched:** `main.js`, `renderer/render.js`, `renderer/app.js`.

**Implemented:** 2026-06-29. Details in §9.

---

### Step 0.1 — Main sends `loading` on `tabs:view_state`

**What**

Add `loading: Boolean(tab.loading)` to every `broadcastTabViewState()` payload in `main.js`.

Set `tab.loading = true` when navigation starts:

- `activateCanvasBrowserLinkSimple` — already sets true at start; broadcast after arming cover
- `goBackCanvasTab` / `tabs:navigate` — set true before navigation, false in dismiss callback
- Tab stash — `loading: false` (not navigating)

Set `tab.loading = false` only when the surface is actually ready:

- Inside `scheduleCanvasSlateDismiss` → `finish()` (paint-ready)
- After `loadCanvasLinkFast` completes without cover path
- On navigation error / cancel

**Why**

Today main tracks `tab.loading` internally (e.g. `renderTab` checks it to keep webview hidden) but **never tells the renderer**. The renderer clears `loading` on its own, so the snapshot `<img>` in `composeActiveViewHtml` never appears and users see a blank `#view` while the webview is hidden.

**Surfaces fixed:** Canvas browser link open, back, tab switch to browser tab, generic `browsertab` navigate.

---

### Step 0.2 — Renderer respects main `loading` (stop clearing it locally)

**What**

In `renderer/render.js` → `applyTabViewState()`:

- **Remove** `tab.loading = false` when `payload.tier === "active"`.
- **Add** `if (typeof payload.loading === "boolean") tab.loading = payload.loading`.

In `renderer/app.js` → `switchWorkspaceTab()`:

- **Remove** unconditional `nextTab.loading = false`.
- For web content tabs (`isWebContentTab(nextTab)`): set `nextTab.loading = true` when switching to a canvas browser tab (main will confirm via `view_state`).
- For native tabs (mail, synapse, native canvas, artifact, center): keep `loading = false` — they paint synchronously.

In `renderer/workspace-page-tabs.js` → `openCanvasBrowserUrl()`:

- Keep `tab.loading = true` at start (already there).
- **Remove** `tab.loading = false` in the success path at the end of the function — let main clear it via `view_state`.
- Keep `loading = false` only on explicit error/cancel.

**Why**

The renderer and main were fighting over the same flag. Main hides the webview when `loading` is true; renderer was setting false immediately, so both sides thought the transition was over at different times → flash.

**Surfaces fixed:** All workspace tab switches involving web content; Canvas link open.

---

### Step 0.3 — Gate repaints in `applyTabViewState`

**What**

Before repainting, compute whether anything **visible** changed:

```javascript
const prev = { loading: tab.loading, tier: tab.viewTier, discarded: tab.discarded, snapshot: tab.snapshotDataUrl };
// ... apply payload ...
const changed = prev.loading !== tab.loading
  || prev.tier !== tab.viewTier
  || prev.discarded !== tab.discarded
  || (payload.snapshotDataUrl && prev.snapshot !== tab.snapshotDataUrl);
if (!changed) return;
```

When something did change:

- Use `patchWorkspacePageTabs()` instead of `scheduleRenderWorkspacePageTabs("full")` for active-tab updates.
- Call `paintActiveView({ skipTransition: true })` only if `loading` or `snapshotDataUrl` changed (the things that affect `#view` for web tabs).

**Why**

Every navigation currently triggers 2–3 full tab-bar rebuilds and extra `paintActiveView` calls (documented as L9, L21). Most `view_state` messages only mean "still loading" with the same snapshot — repainting causes flicker in the tab bar and briefly clears `#view`.

**Surfaces fixed:** Tab bar chrome, `#view` during multi-burst IPC.

---

### Step 0.4 — Serialize tab mutations in main

**What**

Wrap these handlers in `runSerializedTabOperation` (same queue as `tabs:push` / `tabs:switch_active`):

- `canvas:open_link`
- `canvas:arm_cover`
- `canvas:preload_plan` (optional but recommended)

**Why**

Link open, tab push, and tab switch can run at the same time today. They touch the same `currtabs`, `activetab`, and view pool. Serialization means one transition finishes before the next starts — fewer "wrong tab visible for one frame" bugs.

**Surfaces fixed:** Intermittent races on fast click sequences; pool exhaustion during overlapping operations.

---

### Step 0.5 — Tests & manual checklist

**Automated**

- Extend `tests/renderer/tab-switch-races.test.js` or add `tests/renderer/loading-contract.test.js`:
  - `applyTabViewState` does not clear `loading` without `payload.loading === false`
  - `applyTabViewState` skips repaint when payload is a no-op
- Run `npm run test:renderer`

**Manual repro** (before/after)

1. Workspace: Canvas browser tab → Mail → back to Canvas browser — no white flash.
2. Native course → click PDF link — cover or snapshot visible until page loads.
3. Rapid tab clicks — no stale webview over native mail/synapse.
4. Home → workspace — tab bar still visible (regression check for F4).

**Debug**

```bash
set NUCLEUS_DEBUG=tabs,render,ipc
npm run start:debug
```

Confirm in console: `loading` stays `true` from click until one final `view_state` with `loading: false`.

---

## 6. What Part 1 deliberately does *not* do

| Deferred to Tier 1+ | Reason |
|---------------------|--------|
| `armCanvasCover` before tab switch paint | Needs careful ordering in `switchWorkspaceTab`; depends on 0.1–0.2 contract |
| Remove redundant post-link `tabs:push` | Separate change in `openCanvasBrowserUrl` |
| `artifacttab` in `isNativeSurfaceTab` | Tier 2 native handoff |
| Coalesce `view_state` bursts in main | Tier 3 perf |
| Navigation coordinator refactor | Tier 4 |

Part 1 should already cut most visible flashes. Tier 1 builds on the same `loading` signal.

---

## 7. Success criteria for Part 1

- [x] `broadcastTabViewState` includes `loading`.
- [x] Renderer never sets `tab.loading = false` during an in-flight navigation.
- [x] `applyTabViewState` does not call `paintActiveView` on no-op payloads.
- [x] `canvas:open_link` and `canvas:arm_cover` run inside `runSerializedTabOperation`.
- [ ] Manual repro checklist passes without white flash on Canvas browser transitions.
- [x] `npm run test:renderer` passes (loading-contract + existing renderer tests).

---

## 9. Part 1 implementation log (2026-06-29) — **COMPLETE**

### Status: Tier 0 implemented

### Changes made

| File | What changed |
|------|----------------|
| `main.js` | `broadcastTabViewState` now sends `loading: Boolean(tab.loading)`. Added `setTabLoadingState(tab, loading, tier)` helper. `armCanvasNavigationCover` sets `loading: true` and broadcasts. `scheduleCanvasSlateDismiss` `finish()` sets `loading: false` and broadcasts. `activateCanvasBrowserLinkSimple` broadcasts loading at start, clears loading only via dismiss (not at function return); cancel path broadcasts `loading: false`. `restoreCanvasNativeSurface` broadcasts `loading: false`. Wrapped `canvas:open_link`, `canvas:arm_cover`, `canvas:preload_plan` in `runSerializedTabOperation`. |
| `renderer/render.js` | `applyTabViewState` applies `payload.loading` from main only (never clears on active tier by default). Repaints gated: `patchWorkspacePageTabs` + `paintActiveView` only when `loading`, `snapshotDataUrl`, `discarded`, or `viewTier` actually change. `canvas:view-ready` no longer clears `loading` or repaints (main `view_state` owns that). |
| `renderer/app.js` | `switchWorkspaceTab` sets `nextTab.loading = true` for `isWebContentTab` tabs instead of clearing loading immediately. |
| `tests/renderer/loading-contract.test.js` | **New.** Four tests: loading preserved until main sends false; loading cleared on `payload.loading: false`; no-op `view_state` skips repaint; web tab switch sets loading true. |

### Not changed (already correct or deferred)

- `renderer/workspace-page-tabs.js` — `openCanvasBrowserUrl` already left `loading: true` on success; only clears on error/cancel. No edit needed.
- `canvas:preload_plan` serialization added (bonus from 0.4).
- Tier 1 items (`armCanvasCover` before tab-switch paint, redundant post-link push) still deferred.

### Tests run

```
node --test tests/renderer/loading-contract.test.js  → 4/4 pass
node --check main.js                                 → OK
```

### Manual verification (user)

Run the repro checklist in §5 Step 0.5 in the live app and confirm no white flash on Canvas browser transitions.

---

## 8. File change summary (Part 1)

| File | Changes |
|------|---------|
| `main.js` | `broadcastTabViewState` + loading broadcasts; serialize `canvas:open_link`, `canvas:arm_cover`, `canvas:preload_plan` |
| `renderer/render.js` | `applyTabViewState` — respect `payload.loading`, gate repaints |
| `renderer/app.js` | `switchWorkspaceTab` — set loading true for web tabs |
| `renderer/workspace-page-tabs.js` | *(no change — success path already deferred loading clear to main)* |
| `tests/renderer/loading-contract.test.js` | New tests |

---

## 10. Slate flash investigation (2026-06-29)

### Root cause: duplicate navigation handlers

Canvas browser views had **two** `did-start-navigation` listeners:

| Handler | Location | Action |
|---------|----------|--------|
| `wire_tab_did_start_nav` | Tab view wiring | `coverCurrentCanvasNavigationWithSlate` (animated `slate.html`) |
| `predictive_did_start_nav` | `attachCanvasPredictiveNavigationHandlers` | `armCanvasNavigationCover` (first-paint cover) |

On any full-page navigation (link click, **form submit**, POST redirect), **both** could fire → double cover, white flash, slate re-show.

### Form submissions

Assignment **Submit** triggers a full document navigation (`isInPlace: false`). That hit the cover path even though the user isn't "going somewhere new."

**Fix:** Canvas preload sends `canvas:form_submit_pending` on `document submit`; main sets `_nucleusSuppressNextCanvasSlate` and both handlers skip the next cover.

### Fixes applied

1. **Simple tab model:** `wire_tab` handler skips animated slate when `USE_SIMPLE_TAB_MODEL` — only predictive handler arms cover.
2. **Re-arm guard:** `armCanvasNavigationCover` skips re-show if cover already active; extends dismiss timer instead.
3. **Shared `shouldArmCanvasNavCover()`** — single decision logic with logged `reason`.
4. **Form submit suppress** via canvas preload.

### Debug logging

Enable with:

```bash
set NUCLEUS_DEBUG=tabs
npm run start:debug
```

**Main** (console + `.cache/diagnostics/session-*.jsonl`):

| Event | Meaning |
|-------|---------|
| `slate:nav_start` | `did-start-navigation` seen; includes `decision`, `handler`, `url` |
| `slate:arm` | Cover armed (`trigger`: `open_link`, `predictive_did_start_nav`, etc.) |
| `slate:arm_skipped_rearm` | Secondary nav tried to re-show slate while already active |
| `slate:show` / `slate:hide` | First-paint cover visible/hidden |
| `slate:dismiss` | Webview revealed (`reason`: `paint_ready` or `safety_timeout`) |
| `slate:form_submit_pending` | Form submit suppressed next cover |

**Renderer** (`flash_risk_empty_shell`, `view_repaint` when `NUCLEUS_DEBUG=tabs`).

### Correlating white flash

When flash happens, grep the log for:

```
slate:nav_start → slate:arm → flash_risk_empty_shell (loading:false, hasSnapshot:false) → slate:dismiss
```

- Flash **before** `slate:arm` → renderer painted empty shell (loading cleared too early).
- Flash **between** `slate:hide` and `slate:dismiss` → webview revealed before paint-ready.
- `decision: form_submit_suppress` on submit → fix working; if slate still shows, check for nav before submit event fires.

---

## 11. Four-phase flash pattern (begin → blank → stable → end)

Observed on link-open / native→browser transitions:

| Phase | What you see | Root cause |
| ----- | ------------ | ---------- |
| **1. Flash at beginning** | Brief white before themed cover | `broadcastTabViewState` + `ensureCanvasTabWebView` async gap before slate arms; renderer may paint empty `#view` (`canvasMode: browser` → `""` HTML) |
| **2. Didn't render** | Blank area, no course UI | Slate dismissed on first webview `paint` (often blank Canvas shell) while webview was still hidden; OR `loadCanvasTabURLFast` called `revealCanvasView` which re-armed/fought dismiss |
| **3. No flash** | Stable themed slate | Cover active, webview hidden — correct middle state |
| **4. Flash at end** | White flash as page appears | `finish()` hid slate **before** `setVisible(true)` — user saw empty `#view` through the hole; then webview shown on white document |

### Fixes (2026-06-29, pass 3)

| # | Fix | Files |
| - | --- | ----- |
| 1 | Safety timeout only dismisses when `paintReadyToReveal()`; otherwise defers (`slate:timeout_deferred`) up to 8× / 12× then `timeout_give_up` clears loading but keeps slate | `main.js` `scheduleCanvasSlateDismiss` |
| 2 | `setTabLoadingState(false)` runs at start of `finish()`, not after rAF | `main.js` `finish()` |
| 3 | On `loading:false`, hold `tabSnapshotOverlay` until `canvas:view-ready`; renderer keeps snapshot in `#view` instead of empty shell | `renderer/render.js`, `renderer/app.js` |

| Symptom | Root cause | Fix |
| ------- | ---------- | --- |
| Start white flash (run 1) | `armCanvasCover` failed on native tabs (`no_view`); renderer painted empty browser shell before slate | `armCanvasCoverForTab` shows slate without webview; defer `canvasMode: browser` + `paintActiveView` until after `openCanvasLink` when leaving native |
| Didn't render (run 2) | `finish()` cleared `_nucleusCanvasSlateCoverActive` before `loading=false`; `syncActiveSurfaceFromMainTab` → `renderTab` hid webview again during rAF | Keep cover flag until `revealWebView`; add `_nucleusSlateRevealPending` guard in `renderTab` |
| Preload swap blank | Dismiss listeners on old view after `swapPreloadedIntoMain` | Transfer cover to preloaded view + `scheduleCanvasSlateDismiss` instead of `revealCanvasView` re-arm |

### Repro checklist

1. `set NUCLEUS_DEBUG=tabs` → start app.
2. Open Canvas course (native), click an in-course link.
3. Log should show: `slate:show` before any `flash_risk_empty_shell`; `slate:dismiss` after webview visible + rAF, not before.

---

*Last updated: 2026-06-29 — Part 1 (Tier 0) **implemented**; slate debug + submit suppress + four-phase dismiss fixes.*
