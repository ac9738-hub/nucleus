# Canvas predictive preload system

Plan and implementation log for metadata-driven Canvas preloading (weekly buckets, tabs, DOM links, due dates).

## Architecture overview

```
context signals → lib/canvas-preload-planner.js (score + rank)
                → lib/canvas-preload-native.js (native section URLs)
                → renderer requestCanvasPreload → canvas:preload_plan IPC
                → main.js preloadCanvasUrlsForTab (executor)
                → browserpool + canvasPreloadPool + swapCanvasPredictiveView
```

| Artifact | Role |
| -------- | ---- |
| `lib/canvas-preload-planner.js` | Pure planner: candidates, scoring, URL ranking |
| `lib/canvas-preload-graph.js` | Graph events/files/syllabus → preload URL candidates |
| `lib/canvas-preload-pool.js` | Shared URL-keyed view pool with per-tab ref counts |
| `lib/canvas-preload-native.js` | Native section → URL lists for preload IPC |
| `main.js` | View pool, quiet load, predictive swap, IPC handler |
| `renderer/app.js` | Section switch + link mousedown → `canvasPreloadPlan` |
| `context-index.js` | Shared weekly/due-soon helpers |
| `scripts/eval_canvas_preload.js` | Offline eval + report |
| `lib/canvas-preload-metrics.js` | Hit/miss counters + events JSONL |
| `scripts/eval_canvas_preload_hitrate.js` | Hit-rate report from session logs |
| `lib/canvas-preload-merge.js` | Merge explicit/section/planner URL lists |
| `lib/canvas-preload-modules.js` | Module-order successors for active URL |

---

## Parts

### Part 1 — Planner + weekly/DOM merge + main wiring + eval ✅

**Scope**
- `lib/canvas-preload-planner.js` with `collectCandidates`, `scoreCandidates`, `planPreloadUrls`
- Weekly current/next week items from `canvasData.weekly_schedule`
- Due-soon assignments from `canvasData.assignments` (14-day horizon)
- DOM link boost from `extractTopCanvasLinks`
- Focus courses from active tab + open tabs
- Replace DOM-only top-2 in `refreshCanvasPredictiveViews`
- Basic preload stats + diag logging in main
- Unit tests + `scripts/eval_canvas_preload.js`

**Out of scope:** cross-tab pool sharing, native hover preload, graph/task weights, IPC.

---

### Part 2 — Cross-tab pool + URL dedupe ✅

- Shared prediction pool keyed by normalized URL (ref-count per tab)
- Sibling-tab course boost in scorer
- Reuse stashed backup before new `loadURL`
- `canvasPreloadGeneration` guard on quiet loads

---

### Part 3 — Native Canvas integration ✅

- Section switch triggers replan (`courseSection`, `canvasNativePage`)
- mousedown preload on `.course-page a[href]` (2s debounce)
- Renderer → main `canvas:preload_plan` IPC

---

### Part 4 — Graph + tasks scoring ✅

- `canvas_graph.json` dated events → candidates
- `tasks[]` URL/title match boost
- Align focus with `vectorRetrieval.prefetch` (same course, different asset)

---

### Part 5 — Production metrics + hit-rate eval ✅

- `preload_hit` / `preload_miss` on navigation
- `scripts/eval_canvas_preload_hitrate.js` from diag logs + events JSONL
- CI: planner tests on every PR; full eval nightly

---

### Part 6 — Context replan + unified native planner + CI scripts ✅

- Replan when `weekly_schedule` / canvas data / tasks refresh
- Native `canvas:preload_plan` merges section URLs + full planner (weekly/graph/tasks)
- `npm run test:canvas-preload` / `eval:canvas-preload` package scripts

---

### Part 7 — Module sequence + URL-change replan ✅

- Next module items after active Canvas URL become preload candidates
- In-course navigation (`tabs:url_update`) triggers debounced replan

---

## Scoring model (Part 1 weights)

| Component | Weight | Source |
| --------- | ------ | ------ |
| Current week bucket | 0.30 | `weekly_schedule` + `pickWeeklyWeeks` |
| Next week bucket | 0.12 | first items only |
| Due urgency | 0.28 | `due_at` / `duedate` exponential decay |
| DOM link rank (1st on page) | 0.42 | `extractTopCanvasLinks` order |
| Due-soon list | 0.08 | overlaps `compactDueSoon` |
| Sibling canvas tabs (same course) | 0.10 | `collectOpenCanvasTabCourseCounts` |
| Graph event / syllabus | 0.14 | `canvas_graph.json` dated events + linked files |
| Task URL match | 0.16 | `dataStore` tasks, scaled by `priority_weight` |
| Module sequence (next item) | 0.11 | `module_items` order after active URL |

Candidates dedupe by normalized URL; cap per course (8) and global (`limit` arg, default 3).

---

## Part 1 assessment (pre–Part 2)

**What worked**
- Planner + main wiring is sound; unit tests and eval script run clean.
- Paint-first tab switching (separate track) pairs well with deferred `scheduleCanvasPredictiveRefresh`.
- DOM-first-link boost (0.42) correctly prioritizes visible navigation targets.

**Gaps found**
- `canvasPredictiveByTab` duplicated views when two tabs needed the same assignment URL.
- Clearing predictions on refresh always `loadURL` — ignored stashed backups from recent tab switches.
- Rapid tab switches could finish stale quiet loads (no generation guard).
- No scoring boost when multiple Canvas tabs share a course (common during exam weeks).

**Live data note:** `canvas_data.json` still lacks `weekly_schedule` until Canvas sync builds it; due-soon + DOM paths remain the live fallback.

---

## Implementation log

### Part 1 — 2026-06-22

**Status:** Done

**Files added**
- `lib/canvas-preload-planner.js` — planner API
- `tests/renderer/canvas-preload-planner.test.js` — unit tests
- `scripts/eval_canvas_preload.js` — fixture/live eval runner
- `preload.md` — this file

**Files changed**
- `main.js` — `refreshCanvasPredictiveViews` uses planner; `canvasPreloadStats`; `CANVAS_PREDICTIVE_LINK_COUNT` → 3
- `context-index.js` — export `pickWeeklyWeeks` for planner/tests

**Behavior**
- On canvas browser tab activate (500ms debounce), main reads `canvas_data.json`, builds ranked URL list from weekly + due + DOM, loads up to 3 quiet predictive views.
- Falls back to DOM-only links if planner returns nothing.
- Stats: `planned`, `loaded`, `hits` (on predictive swap).

**Verify**
```bash
node --test tests/renderer/canvas-preload-planner.test.js
node scripts/eval_canvas_preload.js
```

**Test results (2026-06-22)**
- Unit tests: 5/5 pass
- Eval script: pass (unit tests embedded)
- Live `canvas_data.json`: 8 courses scanned; `weekly_schedule` empty in file → 0 ranked candidates until schedule is built (planner still works when `weekly_schedule` is populated via `app/canvas/api.js` sync)

**Notes**
- Predictive slot count raised from 2 → 3 (`CANVAS_PREDICTIVE_LINK_COUNT`)
- `canvasPreloadStats` in main tracks `planned`, `loaded`, `hits`, `lastPlan`
- Planner requires `readCanvasDataForTool()` to include `weekly_schedule` for weekly path; due-soon path uses `assignments` buckets

### Part 2 — 2026-06-22

**Status:** Done

**Files added**
- `lib/canvas-preload-pool.js` — URL-keyed pool, per-tab ref counts, `findEntry` / `register` / `releaseTab`
- `tests/renderer/canvas-preload-pool.test.js` — 3 ref-count / sharing tests

**Files changed**
- `lib/canvas-preload-planner.js` — `siblingTabScore`, `WEIGHTS.siblingTab`
- `main.js` — `canvasPreloadPool` replaces `canvasPredictiveByTab`; `canvasPreloadGeneration`; stashed backup reuse via `takeStashedBackupByUrl`; stats `reusedPool`, `reusedStashed`, `staleLoads`, `misses`
- `main.js` `BrowserPool` — `findStashedEntryByUrl`, `takeStashedBackupByUrl`
- `tests/renderer/canvas-preload-planner.test.js` — sibling boost test
- `scripts/eval_canvas_preload.js` — runs pool tests

**Behavior**
1. **Shared pool:** Preloaded views keyed by URL; multiple tabs ref-count the same view instead of reloading.
2. **Stashed reuse:** Before `loadCanvasTabURLQuiet`, tries `browserpool.takeStashedBackupByUrl` when backup URL matches.
3. **Generation guard:** `refreshCanvasPredictiveViews` bumps `canvasPreloadGeneration`; stale quiet loads abort and increment `staleLoads`.
4. **Sibling boost:** Two+ open `canvastab` for same course adds +0.10 priority to that course’s candidates.
5. **Miss tracking:** `will-navigate` without a pooled match increments `misses`.

**Verify**
```bash
node --test tests/renderer/canvas-preload-planner.test.js tests/renderer/canvas-preload-pool.test.js
node scripts/eval_canvas_preload.js
```

**Test results:** 9/9 pass (6 planner + 3 pool)

## Part 2 assessment (pre–Part 3)

**What worked**
- Shared URL pool eliminated duplicate quiet loads across tabs.
- Stashed backup reuse and generation guard integrated cleanly into one refresh path.
- Sibling-tab scoring is low-cost and test-covered.

**Gaps found**
- Native Canvas (DOM-only) never triggered preloads — biggest real-world gap since most course browsing is native mode.
- `refreshCanvasPredictiveViews` logic was monolithic; native IPC needed a shared executor.
- Link clicks still waited until `openCourseLinkInCanvasTab` flipped to browser mode with no head start.

### Part 3 — 2026-06-22

**Status:** Done

**Files added**
- `lib/canvas-preload-native.js` — `collectNativeSectionUrls` per section (weekly, assignments, files, modules, homepage)
- `tests/renderer/canvas-preload-native.test.js` — 4 section URL tests

**Files changed**
- `main.js` — `preloadCanvasUrlsForTab`, `handleCanvasPreloadPlan`, `canvas:preload_plan` IPC; refactored browser refresh to use shared executor
- `preload.js` — `canvasPreloadPlan` bridge
- `renderer/app.js` — `requestCanvasPreload`, `scheduleNativeCanvasSectionPreload`, `preloadCanvasLinkOnMousedown`; hooks on section switch + link mousedown
- `scripts/eval_canvas_preload.js` — includes native tests

**Behavior**
1. **Section switch:** Changing course tab (weekly, assignments, etc.) calls `canvas:preload_plan` with `courseId` + `courseSection`; main loads top URLs into shared pool.
2. **Link mousedown:** 2s debounced preload of clicked href before `openCourseLinkInCanvasTab` (append mode, no clear).
3. **Shared executor:** Browser tab refresh and native IPC both use `preloadCanvasUrlsForTab` (pool → stash → quiet load).

**Verify**
```bash
node --test tests/renderer/canvas-preload-planner.test.js tests/renderer/canvas-preload-pool.test.js tests/renderer/canvas-preload-native.test.js
node scripts/eval_canvas_preload.js
```

**Test results:** 13/13 pass

## Part 3 assessment (pre–Part 4)

**What worked**
- Native section preload closes the gap when users browse in DOM Canvas mode (no browser tab active).
- Shared `preloadCanvasUrlsForTab` executor keeps browser + native paths consistent.
- mousedown debounce avoids spamming quiet loads on hover sweeps.

**Gaps found**
- Planner still ignored `canvas_graph.json` exam/review dates and linked study files.
- Task list URLs (`dataStore` / Canvas-imported tasks) were not boosting preload rank.
- Focus courses for preload did not include context-index focus used by `vectorRetrieval.prefetch`.

### Part 4 — 2026-06-22

**Status:** Done

**Files added**
- `lib/canvas-preload-graph.js` — `collectGraphCandidates` from dated events, edge-linked files, syllabus assignments
- `tests/renderer/canvas-preload-graph.test.js` — 4 graph/task scoring tests

**Files changed**
- `lib/canvas-preload-planner.js` — merge graph + task candidates; `WEIGHTS.graphEvent`, `WEIGHTS.taskMatch`
- `main.js` — `readCanvasGraphForPreload` (mtime cache); `buildCanvasPreloadPlan` passes graph + tasks + index focus
- `scripts/eval_canvas_preload.js` — graph candidate counts in report

**Behavior**
1. **Graph events:** Upcoming dated events (±3d past / 21d future) emit linked file URLs and name-matched assignment URLs.
2. **Task boost:** URLs on ranked tasks gain score proportional to `priority_weight`.
3. **Shared focus:** Preload focus merges open-tab course IDs with `contextStore.index.focusCourseIds` (same alignment as speculative RAG prefetch).

**Verify**
```bash
node --test tests/renderer/canvas-preload-planner.test.js tests/renderer/canvas-preload-pool.test.js tests/renderer/canvas-preload-native.test.js tests/renderer/canvas-preload-graph.test.js
node scripts/eval_canvas_preload.js
```

**Test results:** 17/17 pass

## Part 4 assessment (pre–Part 5)

**What worked**
- Graph event horizon + linked files surface exam-week URLs the weekly bucket misses.
- Task `priority_weight` boost is cheap and aligns preload with the task list.
- Index focus merge keeps preload and speculative RAG on the same courses.

**Gaps found**
- `canvasPreloadStats.hits` / `misses` were in-memory only — no structured session log for offline analysis.
- Misses on `window-open` navigations were not recorded (only `will-navigate`).
- No eval script to compute hit rate from production/diagnostic sessions.

### Part 5 — 2026-06-22

**Status:** Done

**Files added**
- `lib/canvas-preload-metrics.js` — `createCanvasPreloadMetrics`, JSONL parse/aggregate, `appendEvent`
- `scripts/eval_canvas_preload_hitrate.js` — reads `.cache/canvas_preload/events.jsonl` + diagnostic JSONL
- `tests/renderer/canvas-preload-metrics.test.js` — 4 metrics tests

**Files changed**
- `main.js` — `recordCanvasPreloadHit` / `recordCanvasPreloadMiss`; always append events JSONL; `canvas:preload_stats` IPC; `window-open` miss tracking
- `scripts/eval_canvas_preload.js` — includes metrics tests

**Behavior**
1. **Navigation events:** Every predictive hit/miss logs `preload_hit` / `preload_miss` (diag when `NUCLEUS_DEBUG=tabs`) and appends to `.cache/canvas_preload/events.jsonl`.
2. **Payload:** `tabId`, `url`, `courseId`, `source` (`will-navigate` | `window-open`), `poolSize`, `plannedCount`.
3. **Hit-rate eval:** Merges dedicated events file with recent `session-*.jsonl` diagnostic logs; writes `.cache/canvas_preload/hitrate_report.json`.

**Verify**
```bash
node --test tests/renderer/canvas-preload-planner.test.js tests/renderer/canvas-preload-pool.test.js tests/renderer/canvas-preload-native.test.js tests/renderer/canvas-preload-graph.test.js tests/renderer/canvas-preload-metrics.test.js
node scripts/eval_canvas_preload.js
node scripts/eval_canvas_preload_hitrate.js
```

**CI notes**
- PR: run `node scripts/eval_canvas_preload.js` (embeds all preload unit tests).
- Nightly / manual session: enable `NUCLEUS_DEBUG=tabs` while browsing Canvas, then `node scripts/eval_canvas_preload_hitrate.js`.

**Test results:** 22/22 pass

## Part 5 assessment (pre–Part 6)

**What worked**
- Structured `preload_hit` / `preload_miss` events with pool context enable offline hit-rate analysis.
- Always-on `.cache/canvas_preload/events.jsonl` does not require full `NUCLEUS_DEBUG`.
- `window-open` miss tracking closes a blind spot in popup navigations.

**Gaps found**
- Native IPC path only used section URL lists — planner (weekly/graph/tasks) never ran for DOM Canvas mode.
- Async `weekly_schedule` build updated renderer but did not replan hidden preload views.
- CI scripts documented in preload.md but not wired to `package.json`.

### Part 6 — 2026-06-22

**Status:** Done

**Files added**
- `lib/canvas-preload-merge.js` — `mergePreloadUrls` with `extras-first` / `candidates-first` ordering
- `tests/renderer/canvas-preload-merge.test.js` — 4 merge tests

**Files changed**
- `main.js` — `planPreloadCandidatesForTab`; unified `handleCanvasPreloadPlan` (section + planner + explicit); `scheduleCanvasPreloadAfterContextChange` on canvas data + task import; browser refresh uses merge helper
- `package.json` — `test:canvas-preload`, `eval:canvas-preload`, `eval:canvas-preload-hitrate`
- `scripts/eval_canvas_preload.js` — includes merge tests

**Behavior**
1. **Context replan:** When `weekly_schedule` finishes building (`sendCanvasDataUpdate`) or Canvas tasks import, debounced replan refreshes the active canvas tab (browser or native).
2. **Unified native plan:** `canvas:preload_plan` ranks via full planner, then merges mousedown/section URLs (extras-first).
3. **CI:** `npm run test:canvas-preload` runs all 25 unit tests; `npm run eval:canvas-preload` for live candidate report.

**Verify**
```bash
npm run test:canvas-preload
npm run eval:canvas-preload
npm run eval:canvas-preload-hitrate
```

**Test results:** 25/25 pass

## Part 6 assessment (pre–Part 7)

**What worked**
- Context replan unlocks weekly_schedule value once async build completes.
- Unified native planner path finally applies graph/task scoring in DOM mode.
- npm scripts make CI integration straightforward.

**Gaps found**
- Original plan's **module sequence** signal (`w_seq`) was never implemented — in-course "next item" preloads missing.
- Browser tab URL changes did not replan (only tab activate + canvas data refresh).
- Module-following navigation is the most common Canvas click pattern after weekly/due.

### Part 7 — 2026-06-22

**Status:** Done

**Files added**
- `lib/canvas-preload-modules.js` — `collectModuleSequenceCandidates`, `pathsLikelySame`, `moduleSequenceScore`
- `tests/renderer/canvas-preload-modules.test.js` — 4 module sequence tests

**Files changed**
- `lib/canvas-preload-planner.js` — merge module candidates; `WEIGHTS.moduleSequence` (0.11)
- `main.js` — `scheduleCanvasPreloadAfterUrlChange` on `did-navigate` / `did-navigate-in-page`
- `package.json`, `scripts/eval_canvas_preload.js` — include module tests

**Behavior**
1. **Module sequence:** Walk `modules` + `module_items` in order; after matching active URL, emit up to 4 successors with decaying score.
2. **URL replan:** Active canvas browser tab navigation debounces (350ms) into `scheduleCanvasPredictiveRefresh` so module successors update as user moves through a module.

**Verify**
```bash
npm run test:canvas-preload
npm run eval:canvas-preload
```

**Test results:** 29/29 pass
