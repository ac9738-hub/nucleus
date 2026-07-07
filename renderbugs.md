# Render / tab / Canvas navigation bugs (observed)

Session: `edcae4` debug runs + code-path audit (2026-06-22).  
**Scope:** latency drivers, race conditions, slate/snapshot coverups. Slate must not sit on the navigation critical path.

Evidence tags: `[log]` = seen in `debug-edcae4.log`; `[code]` = confirmed in source without a fresh log line; `[infra]` = observed logging gap.

**Log status (iterations 1–3):** `.cursor/debug-edcae4.log` missing on three consecutive audit passes — main/renderer relied on HTTP ingest only. Iteration 3 adds `agentIngestLog()` in main (`main.js`) which **also appends** to that file via `fs.appendFileSync`.

---

## Latency drivers (observed)

### L1 — `capturePage()` blocks before every Canvas link load `[log]` `[code]`

`runCanvasSlateNavigation` **awaits** `captureTabSnapshotFromView` → `webContents.capturePage()` **before** `loadURL` starts (`main.js:5415–5427`).  
`activateCanvasBrowserLink` routes `needsReload` through this path (`main.js:4421`).

**Effect:** Navigation cannot start until a full-frame GPU screenshot + PNG encode finishes. This is the primary slate “coverup” cost — not `setSlateAnimation` (unused on hot path).

**Instrumentation:** `H-PERF1` log `slate nav timing` with `snapshotMs` vs `actionMs`.

---

### L2 — `ensureCanvasAuthForNavigation` on every fast load `[code]`

`loadCanvasTabURLFast` awaits `ensureCanvasAuthForNavigation` per navigation (`main.js:5170`). That path may validate auth, install cookies, or open the auth window and `waitForCanvasAuth()` (`main.js:5009–5039`).

**Effect:** Adds variable latency (tens of ms to seconds) before `loadURL` even when cookies are already warm.

---

### L3 — `tabs:push` serialized behind other tab work `[log]` `[code]`

`ipcMain.handle('tabs:push', … runSerializedTabOperation(…))` (`main.js:6327`). Same chain used by other tab mutations.

**Observed:** Link opens reported 4s+ when preload / prior `tabs:push` work was queued ahead of activation (prior session diagnosis).

---

### L4 — Predictive preload competes for canvas view pool `[log]` `[code]`

`handleCanvasPreloadPlan` loads URLs into the predictive pool (`main.js:4717`). `canvas_data` / `native_section` preloads on section switches (`renderer/app.js:scheduleNativeCanvasSectionPreload`).

**Observed:** `open link no_view` when pool exhausted — `poolInUse` high, predictive views holding slots (`H-L3` log). First link click failed until pool evicted.

---

### L5 — Post-navigation predictive refresh storm `[code]`

After every successful link open: `scheduleCanvasPredictiveRefresh(mainwindow, tab, 250)` (`main.js:4450`).  
`refreshCanvasPredictiveViews` runs `extractTopCanvasLinks` (executeJavaScript) + `preloadCanvasUrlsForTab` with `clearFirst: true` (`main.js:4797–4817`).

**Effect:** Background work starts ~250ms after each click; competes with the next interaction and pool slots.

---

### L6 — `revealCanvasView` 100ms deferred reveal `[code]`

Non-immediate reveals use `setTimeout(..., 100)` (`main.js:5247–5254`).

**Effect:** Adds fixed 100ms after navigation settle before webview becomes visible (when not `immediate: true`).

---

### L7 — `mergeRendererTabsFromPayload` on every `openCanvasLink` `[code]`

`activateCanvasBrowserLink` awaits full tab merge + possible `stashTabViewToBackup` before acquiring a view (`main.js:4309`, `3620–3634`).

**Effect:** Extra async stash/merge work before view attach on each link click.

---

### L8 — Double renderer paint on link click `[code]`

`openCourseLinkInCanvasTab` calls `paintActiveView` before **and** after IPC (`workspace-page-tabs.js:868–891`), plus `queueTabSyncAfterRender` → `syncTabs` + `syncActiveTab` (`903–908`).

**Effect:** Redundant DOM work during the click handler; `tabs:push` may run twice (IPC payload + queueTabSync).

---

### L9 — `applyTabViewState` triggers full tab-bar rebuild per view_state IPC `[log]` `[code]`

On every active `tabs:view_state`, renderer calls `scheduleRenderWorkspacePageTabs("full")` (`render.js:117–118`).

**Observed:** Bursts of `tab bar updated` with `needsFullRebuild: true` during a single link open / back sequence.

---

### L10 — `waitForCanvasNavigation` 12s timeout; `fast: true` skips paint settle `[code]`

`loadCanvasTabURLFast` uses 12s nav wait then `waitForCanvasNavigationAndSettle(..., { fast: true })` which returns immediately after first navigate event (`main.js:5183–5188`, `5139–5142`).

**Effect:** May reveal before Canvas SPA paint completes (contributes to flash; pairs with coverup path).

---

## Slate / snapshot coverups (visual masking — must not gate speed)

### S1 — Snapshot capture is on the critical path `[log]` `[code]`

See **L1**. Coverup is implemented as: hide webview → show renderer `<img class="tab-restore-snapshot">` (`renderer/app.js:287–294`) fed by IPC snapshot.  
The animated `slate.html` / `setSlateAnimation` is **not** called on link-open path (`setSlateAnimation` has no call sites).

**Bug:** Coverup quality depends on a blocking `capturePage()` that delays the actual navigation.

---

### S2 — Stale page flashed before coverup applied `[log]`

**Observed (pre anti-flash patch):** `restoreStashedTabView` log showed `loadedUrl` = course homepage while `requestedUrl` = file preview; `revealCanvasView({ immediate: true })` ran before reload (`H-L1`).

**Post-patch:** `needsReload` uses slate path, but snapshot still captured first → user may see old snapshot, then blank, then new page.

---

### S3 — `coverCurrentCanvasNavigationWithSlate` on in-page navigations `[code]`

Attached on `did-start-navigation` / `did-navigate` handlers (`main.js:4244`, `6667`) — second snapshot + hide per navigation event.

**Risk:** Duplicate snapshot work when Canvas fires multiple navigation events per click.

---

## Race conditions (observed)

### R1 — Renderer clears `tab.loading` on every active `tabs:view_state` `[code]`

`applyTabViewState`: `if (payload.tier === "active") { tab.loading = false }` (`render.js:102–104`).  
`broadcastTabViewState` does **not** send a `loading` field (`main.js:3693–3698`).

**Effect:** Main sets `tab.loading = true` during slate nav and broadcasts; renderer immediately clears it → loading overlay / snapshot path in `composeActiveViewHtml` may not run; races with main-process hide.

---

### R2 — Renderer clears `tab.loading` before IPC completes `[code]`

`openCourseLinkInCanvasTab` sets `tab.loading = true` then `await openCanvasLink` then **`tab.loading = false`** unconditionally (`workspace-page-tabs.js:860–882`) while main may still be in `runCanvasSlateNavigation`.

---

### R3 — `canvasLinkOpening` drops rapid clicks `[code]`

Second link click while first in flight returns early (`workspace-page-tabs.js:835`). User perceives “link didn’t work” not “queued”.

---

### R4 — Tab surface sync generation races `[log]`

`deferActiveTabSync` logs `staleGen` / `tabMismatch` (`H1`/`H5`) when user switches tabs faster than `syncTabs` + `syncActiveTab` complete.

---

### R5 — Stale active `tabs:view_state` after tab switch `[log]`

`applyTabViewState` ignores `tier: "active"` for non-active tab id (`render.js:75–82`, `H4`) — correct guard, but indicates main still broadcasts active tier for background tabs during transitions.

---

### R6 — Native restore vs stashed view_state `[log]`

During `restoreCanvasNativePage`, `ignore stashed view_state during native canvas restore` (`H6`) fires while webview stash IPC is in flight — renderer and main briefly disagree on active surface.

---

### R7 — `open link cancelled` when user backs during load `[log]`

`canvasLinkCancelGen` invalidates in-flight `activateCanvasBrowserLink` (`H-L2`). Correct behavior but leaves `canvasLinkOpening` / view visibility dependent on which side wins.

---

### R8 — Backup stash matched wrong URL `[log]`

`findBackupEntry` previously restored by tab id only. **Observed:** wrong page after native→web→link (`loadedUrl` ≠ `requestedUrl`). URL-aware matching added; mismatch still logged when stash reused with `needsReload: true`.

---

## Functional bugs (observed)

### F1 — First link `no_view` (pool exhausted) `[log]`

`activateCanvasBrowserLink` → `reason: "no_view"` when `acquireForTab` fails after predictive preloads consumed pool.

---

### F2 — Back hung in web `goBack` + slate path `[log]`

`canvas back clicked` without matching `canvas back result` — `backBrowserTab` blocked in `runCanvasSlateNavigation` with hidden webview → blank screen. Mitigation: skip web back when `nativeHistory.length > 0`.

---

### F3 — Native Canvas not visible after back (webview overlay) `[log]`

Web `WebContentsView` stayed visible over native DOM when main did not stash/hide on native restore (`H8` / `restoreCanvasNative`).

---

### F4 — Tab bar disappeared after Home / section nav `[log]`

`updateWorkspacePageTabs` cleared DOM when `state.top !== "workspace"` (`H-T1`). `patchWorkspacePageTabs` alone left bar hidden (`is-hidden`, 0 buttons) until full rebuild.

---

### F5 — Workspace page tab clicks did not switch content `[log]`

`deferActiveTabSync` microtask-only path dropped `syncTabs()` — fixed to call `syncTabs` then `syncActiveTab` (`H2`/`H3`).

---

### F6 — Native restore paints empty view briefly `[log]`

`restoreCanvasNativePage` logged `htmlLen: 0` before native HTML painted (`H7`) — flash of empty `#view` under webview hide.

---

### F7 — `browsertab` not promoted for Canvas link IPC `[log]`

`activateCanvasBrowserLink` required `canvastab`; tabs still typed `browsertab` after conversion → `invalid_tab` / no-op until promotion added.

---

## What is NOT a latency driver

| Item | Status |
|------|--------|
| `setSlateAnimation` / `slate.html` CSS animations | Not called on link-open / back hot paths |
| `addslate` / `revealCanvasOverSlate` | Not on `activateCanvasBrowserLink` path |
| Renderer crossfade (`view-is-switching`) | Separate from main-process snapshot slate |

---

## Recommended measurement (next run)

Clear `.cursor/debug-edcae4.log`, restart app, perform: native → link → back → link.  
Compare `H-PERF1` lines: if `snapshotMs` ≫ `actionMs`, snapshot is the bottleneck; if `actionMs` dominates, Canvas/network/auth is the bottleneck.

```
grep -E "slate nav timing|open canvas link done|preload plan done|open link merge|open link acquire|tabs push" .cursor/debug-edcae4.log
```

---

## Iteration 2 — new bugs (code audit, 2026-06-22)

No fresh `debug-edcae4.log` this pass; items below are from deeper code-path review. Instrumentation added: `H-PERF2` merge, `H-PERF3` acquire, `H-PERF4` tabs:push, `H-PERF5` cover-nav.

### L11 — Double predictive eviction on failed acquire `[code]`

`activateCanvasBrowserLink` calls `evictPredictiveViewsExcept` twice when first `acquireForTab` fails — second call passes `keepUrl: ""` and evicts **all** predictive views for the tab (`main.js:4372–4387`).

**Effect:** Extra `releaseView` work right when a view is needed; makes `no_view` more likely under load.

---

### L16 — Forced full `tabs:push` after every successful link `[code]`

`openCourseLinkInCanvasTab` sets `lastTabPushFingerprint = ""` on success (`workspace-page-tabs.js:907`), bypassing renderer fingerprint skip.

**Effect:** Full main-process `tabs:push` (merge all tabs, possible `restoreStashedTabView`, injection wiring) runs **after** `activateCanvasBrowserLink` already attached the view and called `syncActiveSurfaceFromMainTab`.

---

### L17 — Duplicate predictive refresh scheduling `[code]`

`activateCanvasBrowserLink` schedules `scheduleCanvasPredictiveRefresh(250ms)`; post-link `tabs:new_active` schedules again at default **500ms** (`main.js:4450`, `6105`).

**Effect:** Two `refreshCanvasPredictiveViews` passes (DOM scrape + `preloadCanvasUrlsForTab` with `clearFirst: true`) per link.

---

### L18 — `canvas:preload_plan` runs unserialized vs `canvas:open_link` `[code]`

`handleCanvasPreloadPlan` is fire-and-forget (`void`, `main.js:5621–5625`); `canvas:open_link` is not behind `runSerializedTabOperation`.

**Effect:** Mousedown/section preload can load URLs and occupy pool **during** an in-flight link open.

---

### L20 — Stash restore uses slow load path `[code]`

`restoreStashedTabView` with `needsReload` uses `loadCanvasTabURL` + `canvaspageload`, not `loadCanvasTabURLFast` (`main.js:3819–3822`).

**Effect:** When `tabs:push` restores a stashed canvas tab, navigation is slower than the open-link fast path.

---

### L21 — Triple `broadcastTabViewState` per slate navigation `[code]`

`runCanvasSlateNavigation` broadcasts: (1) after snapshot, (2) loading=true, (3) loading=false at end (`main.js:5419–5435`). Each active-tier broadcast triggers renderer full tab-bar schedule + `paintActiveView` (`render.js:117–130`).

**Effect:** IPC + renderer repaint storm layered on top of snapshot cost.

---

### S4 — Nested/double slate on redirect navigations `[code]`

`loadCanvasTabURLFast` sets `_nucleusSuppressNextCanvasSlate` for **one** `did-start-navigation` only (`main.js:4232–4234`, `5178`). Canvas redirects fire a second navigation → `coverCurrentCanvasNavigationWithSlate` runs (`4229–4246`) **in addition to** outer `runCanvasSlateNavigation`.

**Effect:** Second `capturePage()` mid-load; instrument via `H-PERF5` `cover nav timing`.

---

### S5 — Slate reentrant bypass skips hide `[code]`

If `view._nucleusSlateNavigationInProgress` is already true, `runCanvasSlateNavigation` calls `action()` directly with no hide/snapshot (`main.js:5408–5410`).

**Effect:** Nested navigations can show stale webview content during inner load.

---

### R9 — `applyTabViewState` clears `loading` on active tier `[code]`

Still present (`render.js:102–104`); `broadcastTabViewState` omits `loading` (`main.js:3693–3698`). Combines with **L21** to defeat renderer snapshot overlay during slate.

---

### R10 — `mergeIncomingTab` on `tabs:new_active` after open link `[code]`

`tabs:new_active` merges renderer tab payload (with `loading: false` from `openCourseLinkInCanvasTab`) over main tab (`main.js:6085`) **after** main finished navigation.

**Effect:** Main/renderer tab metadata can disagree on loading/url until next sync.

---

### R11 — `deferActiveTabSync` clears `view-is-switching` before IPC settles `[code]`

`requestAnimationFrame` calls `finishTabSurfaceSwitch` without awaiting `syncTabs` (`workspace-page-tabs.js:258–264`).

**Effect:** UI shows switch complete while main process still processing `tabs:push` / `tabs:new_active`.

---

### R12 — `claimPredictiveViewForTab` URL fallback `[code]`

When exact URL missing, claims **any** predictive view for the tab (`main.js:4103–4106`) → `predictive_repurpose` → `needsReload` + full slate path.

**Effect:** Preload “hit” that still pays full navigation cost.

---

### F8 — `openCanvasLink` sends raw `state.tabs` `[code]`

IPC passes full renderer tab objects, not `buildMainTabSyncPayload` (`workspace-page-tabs.js:874–878`). Larger merge payload; may include stale fields main overwrites inconsistently.

---

### F9 — Post-link `tabs:new_active` may re-trigger preload on same tab `[code]`

Even when `ensureActiveWebContentTabView` is no-op (view exists), `tabs:new_active` still calls `scheduleCanvasPredictiveRefresh` (`main.js:6099–6105`).

**Effect:** Redundant background work after link path already refreshed predictions.

---

### F10 — `canvas:open_link` not serialized; `tabs:push` is `[code]`

Link open and tab list sync can interleave on main thread. `tabs:push` holds `runSerializedTabOperation` lock while link handler runs outside it — race on `currtabs` / `activetab` / pool during concurrent preload + push + open.

---

## Iteration 2 — measurement checklist

After repro, compare phases for one slow link click:

| Log message | Hypothesis | What high value means |
|-------------|------------|------------------------|
| `open link merge done` (`mergeMs`) | H-PERF2 | Tab merge/stash dominates |
| `open link acquire done` (`acquireMs`) | H-PERF3 | Pool eviction/acquire dominates |
| `slate nav timing` (`snapshotMs` vs `actionMs`) | H-PERF1 | Snapshot is bottleneck |
| `cover nav timing` | H-PERF5 | Double-slate on redirect |
| `tabs push done` (`ms`) after link | H-PERF4 | Duplicate push is bottleneck |
| `open canvas link done` (`ms`) | H-V1 | End-to-end renderer wait |
| `predictive refresh fired` / `url-change preload fired` | H-PERF6 | Triple refresh timer overlap |

---

## Iteration 3 — new bugs (code audit + logging gap, 2026-06-22)

No runtime NDJSON this pass (`debug-edcae4.log` absent). Items below from deeper code review + confirmed logging infrastructure gap.

### INF1 — Main-process debug logs not persisted when ingest is down `[infra]`

Instrumentation used `fetch('http://127.0.0.1:7283/ingest/...')` only. If the debug ingest server is not running, **no log file is created** despite active Electron sessions (observed iterations 1–3).

**Mitigation added:** `agentIngestLog()` dual-writes to `.cursor/debug-edcae4.log` from main process.

---

### L22 — Uncached `readCanvasDataForTool()` on every preload plan `[code]`

`handleCanvasPreloadPlan` calls `readCanvasDataForTool()` → `canvasApi.readCanvasData()` synchronously (`main.js:4745–4754`). Unlike `readCanvasGraphForPreload`, there is **no mtime cache**.

**Effect:** Disk parse on every `native_section`, `link_mousedown`, and `canvas_data` preload trigger.

---

### L23 — Three competing predictive-refresh timers `[code]`

| Timer | Delay | Source |
|-------|-------|--------|
| Post-link open | 250ms | `activateCanvasBrowserLink` → `scheduleCanvasPredictiveRefresh` |
| Tab activation | 500ms (default) | `tabs:new_active` → `scheduleCanvasPredictiveRefresh` |
| URL change debounce | 350ms → 100ms | `did-navigate` → `scheduleCanvasPreloadAfterUrlChange` → refresh |

`scheduleCanvasPredictiveRefresh` **cancels** the previous timer (`cancelCanvasPredictiveRefreshSchedule`), but link-open + `tabs:new_active` + navigate handlers **race to schedule** — last writer wins; still multiple `refreshCanvasPredictiveViews` attempts per click sequence.

**Instrumentation:** `H-PERF6` `predictive refresh fired` / `url-change preload fired`.

---

### L24 — Serial full page loads in preload loop `[code]`

`preloadCanvasUrlsForTab` awaits `loadCanvasTabURLQuiet` per URL (`main.js:4703–4707`), each with `waitForCanvasNavigationAndSettle`. URLs processed **sequentially** in a `for` loop.

**Effect:** Mousedown preload of 1 URL blocks; section preload with multiple candidates blocks pool longer.

---

### L25 — Stash path triggers debounced `capturePage` `[code]`

`stashTabViewToBackup` fires `captureTabSnapshotDebounced(tab, view, 300ms)` (`main.js:4033–4035`) on every stash (tab switch, native restore, deactivate).

**Effect:** Extra screenshot work during navigation churn; competes with slate snapshot on next open.

---

### L26 — Link click “partial” render still repaints chrome `[code]`

`openCourseLinkInCanvasTab` calls `renderWorkspaceViewPartial({ shell: "minimal" })` which still runs `updateWorkspacePageTabs` + `renderBrowserToolbar` + `renderCanvasToolbar` (`app.js:434–442`, `865–866`).

**Effect:** Not DOM-only; toolbar + tab bar work on every link mousedown/click path.

---

### L27 — `syncRenderContext` after native paint `[code]`

`refreshCanvasNativeView` calls `syncRenderContext()` → `pushUiState` IPC (`app.js:489–491`, `render.js:349–350`). Main `applyRendererUiState` → `recomputeIndexSlice` + context store updates (`main.js:2844–2873`).

**Effect:** Full context/index recompute on native section switches and course navigation.

---

### L28 — Deferred tab deactivate runs second serialized op `[code]`

`tabs:new_active` ends with `setImmediate(() => runSerializedTabOperation(... onTabDeactivated ...))` (`main.js:6125–6134`) **after** activation completes.

**Effect:** Stashing previous tab (snapshot + pool) queues **behind** the next user action's `tabs:push` / `open_link`.

---

### R15 — Optimistic `loading: false` on workspace tab switch `[code]`

`switchWorkspaceTab` sets `nextTab.loading = false` before IPC (`app.js:512`).

**Effect:** Same class as R2 — renderer shows non-loading while main may still be in slate navigation for that tab's webview.

---

### R17 — `canvaspageload` reveals view independently of slate wrapper `[code]`

`canvaspageload` → `settle()` always calls `revealCanvasView(view)` (`main.js:5067–5068`). Used by `loadCanvasTabURL` in `restoreStashedTabView` (`3819–3822`), not wrapped in outer hide when slate already running.

**Effect:** Stash-restore reload can reveal stale frame before navigation completes.

---

### R18 — `pendingSwitchSlate` + `restoreStashedTabView` crossfade branch `[code]`

Tab switch sets `pendingSwitchSlate` for browser canvas tabs (`app.js:513–515`). `restoreStashedTabView` may capture **another** snapshot and call `revealCanvasView({ immediate: false })` (`3819–3844`).

**Effect:** Tab switch to stashed canvas tab pays snapshot + 100ms reveal even when URL already matches.

---

### S6 — `canvaspageload` + `coverCurrentCanvasNavigationWithSlate` both reveal `[code]`

`did-start-navigation` starts `canvaspageload` (which reveals on settle) **and** `coverCurrentCanvasNavigationWithSlate` (`4229–4246`). Two parallel cover paths on same navigation.

**Effect:** Duplicate snapshot/reveal logic; timing-dependent flash.

---

### F11 — `buildTabPushFingerprint` omits `loading` `[code]`

Fingerprint includes url/canvasMode but not `loading` (`workspace-page-tabs.js:117–133`). A state change that **only** toggles loading may skip `syncTabs` on renderer while main still broadcasting view_state.

---

### F12 — `tabs:push` closed-tab cleanup is O(n) parallel async `[code]`

Closing many tabs fires `Promise.all(closedTabCleanup)` with per-tab `clearCanvasPredictiveViews` + `releaseTabView` (`main.js:6363–6375`).

**Effect:** Large workspaces stall the serialized `tabs:push` chain.

---

### F13 — `openCourseLinkInCanvasTab` does not call `syncActiveTab` directly; only `queueTabSyncAfterRender` `[code]`

After IPC, `queueTabSyncAfterRender` microtasks `syncTabs` then `syncActiveTab` (`907–908`). `activateCanvasBrowserLink` already set `activetab` and `syncActiveSurfaceFromMainTab` — **dual activation paths** with coalesced delay.

**Effect:** Brief window where main active surface ≠ renderer `tabs:new_active` state.

---

## Iteration 3 — measurement checklist

After repro with **restarted app**, main-process logs should appear in `.cursor/debug-edcae4.log` even without ingest server.

```bash
# Count refresh timer fires per link click (expect ≤1 ideal; observed risk: 2–3)
grep -E "predictive refresh fired|url-change preload fired" .cursor/debug-edcae4.log

# Phase breakdown for one slow link
grep -E "open link merge done|open link acquire done|slate nav timing|tabs push done|open link path" .cursor/debug-edcae4.log
```
