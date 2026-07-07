# Nucleus — System Architecture

Nucleus is a desktop academic workflow application built on **Electron**. It integrates Canvas LMS, Gmail, an AI assistant (Sidekick), a structured learning mode (Synapse Learn), task management, and document artifacts. The app keeps sensitive credentials and filesystem access in the **main process**; the renderer is sandboxed behind a preload IPC bridge.

This document explains how the major modules fit together so a developer who has never seen the codebase can trace data flows, find the right file to edit, and reason about bugs.

For weekly-schedule iteration rules and eval targets, see `AGENTS.md`. For RAG retrieval iteration, see `graphagents.md`.

---

## Table of contents

1. [High-level topology](#1-high-level-topology)
2. [Process model](#2-process-model)
3. [On-disk artifacts](#3-on-disk-artifacts)
4. [Electron shell](#4-electron-shell)
5. [Canvas ingestion and parsing](#5-canvas-ingestion-and-parsing)
6. [Knowledge graph](#6-knowledge-graph)
7. [Weekly schedule](#7-weekly-schedule)
8. [Vector retrieval (RAG)](#8-vector-retrieval-rag)
9. [Sidekick agent](#9-sidekick-agent)
10. [Synapse Learn](#10-synapse-learn)
11. [Mail, Gradescope, artifacts](#11-mail-gradescope-artifacts)
12. [Tasks and context](#12-tasks-and-context)
13. [IPC contract](#13-ipc-contract)
14. [Evaluation and tests](#14-evaluation-and-tests)
15. [Security model](#15-security-model)
16. [Debugging guide](#16-debugging-guide)
17. [Where to edit what](#17-where-to-edit-what)
18. [Tab management and rendering](#18-tab-management-and-rendering) — **start here for tab/Canvas bugs**

---

## 1. High-level topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Electron main (main.js)                         │
│  IPC · BrowserWindow · WebContentsView pool · Python child processes    │
├──────────────┬──────────────┬──────────────┬──────────────┬──────────────┤
│ data-store   │ context-*    │ app/canvas   │ agent-*      │ engine.js    │
│ artifact-*   │ taskoptimizer│ app/mail     │ sidekick.py  │ vector_*.py  │
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘
       │              │              │              │              │
       ▼              ▼              ▼              ▼              ▼
  renderer/      canvas_data    parser.py      sidekick.py    canvas_graph.json
  (preload.js)   .json                         (tools)        (embeddings)
```

**Three persistent JSON hubs:**

| File | Writer | Readers |
|------|--------|---------|
| `canvas_data.json` | `app/canvas/api.js` | Parser, weekly bridge, context index, UI |
| `canvas_graph.json` | `parser.py` | `vector_retreival.py`, Synapse teaching, artifacts |
| User data (tasks, workspaces) | `data-store.js` | Renderer, Sidekick tools |

---

## 2. Process model

| Process | Entry | Spawned by | Protocol |
|---------|-------|------------|----------|
| Electron main | `main.js` | `electron .` | IPC with renderer |
| Renderer | `index.html` → `renderer/app.js` | BrowserWindow | `window.nucleus` via `preload.js` |
| Parser | `parser.py` | `app/canvas/api.js` | Newline JSON on stdin/stdout |
| Sidekick | `sidekick.py` | `agent-process.js` | Newline JSON on stdin/stdout |
| Retrieval | `vector_retreival.py` | `main.js` | Newline JSON on stdin/stdout |
| Artifacts (optional) | `agent_artifacts/build.py` | `agent-artifacts.js` | JSON stdin → file path stdout |

Python children are long-lived where possible: the parser runs for the duration of a parse job; Sidekick stays open across chat turns; retrieval may be spawned per query batch.

---

## 3. On-disk artifacts

### Production (repo root or userData)

| Path | Description |
|------|-------------|
| `canvas_data.json` | Raw Canvas API snapshot: courses, assignments, modules, files, page bodies |
| `canvas_graph.json` | Parsed knowledge graph with concepts, events, files, embeddings |
| `gradescope_state.json` | Gradescope session for assignment sync |
| `.env` | API keys and Canvas auth cookies (never commit) |

### Caches (`.cache/`, gitignored)

| Path | Description |
|------|-------------|
| `.cache/weekly_iteration/graph_eval.json` | Parser graph cache for weekly eval |
| `.cache/weekly_iteration/report.json` | Weekly miss report |
| `.cache/synapse_teaching/` | Built curriculum cache |
| `.cache/canvas_preload/` | Preload telemetry |

### Fixtures and ground truth (committed)

| Path | Description |
|------|-------------|
| `fixtures/weekly_iteration/snapshots_gt.json` | Princeton GT course snapshots |
| `ground-truth/*.json` | Labeled weekly schedules |
| `ground-truth/harvard/` | Harvard Canvas GT |
| `ground-truth/holdout/` | Holdout student GT |
| `RAG_ground_truth.json` | RAG eval queries |

---

## 4. Electron shell

### 4.1 `main.js`

The main process owns:

- **Window lifecycle** — `BrowserWindow`, layout, themes
- **Tab system** — `currtabs[]`, active tab, workspace tabs
- **WebContentsView pool** — `lib/canvas-preload-pool.js` recycles Canvas browser views for fast navigation
- **IPC handlers** — all `ipcMain.handle` / `ipcMain.on` endpoints (see [§13](#13-ipc-contract))
- **Python spawning** — parser, Sidekick, retrieval, artifact builder
- **Canvas native views** — dashboard/course UI in `app/canvas/` loaded as WebContentsViews

Key subsystems imported at the top:

| Module | Role |
|--------|------|
| `data-store.js` | Tasks, workspaces, project groups |
| `context-store.js` | Versioned context slices for Sidekick |
| `context-index.js` | Compact app-state index from tasks + Canvas |
| `agent-process.js` | Sidekick subprocess adapter |
| `agent-artifacts.js` | Artifact create/update |
| `engine.js` | Web search + RAG results page |
| `lib/canvas-preload-*` | Predictive link preloading for Canvas tabs |
| `lib/sidekick-router.js` | Intent routing (mirrors `sidekick_router.py`) |
| `text-chunks.js` | Citation formatting (mirrors Python `text_chunks.py`) |

### 4.2 `preload.js`

Exposes `window.nucleus` to the renderer via `contextBridge`. Every method maps to an `ipcRenderer.invoke` or `send`. **Any new IPC endpoint must be added here and in `main.js`.**

### 4.3 Renderer (`renderer/`)

| File | Role |
|------|------|
| `app.js` | Top-level UI controller: sections, workspaces, Sidekick panel |
| `render.js` | Bootstraps data from IPC, owns `state` and `tasks` |
| `workspace-page-tabs.js` | Tab bar, Canvas native/browser mode switching, tab sync |
| `artifact-tabs.js` | Artifact preview tabs |

The renderer has **no Node.js access**. All file/network operations go through IPC.

**Tab system:** See **[§18 Tab management and rendering](#18-tab-management-and-rendering)** for the full sequential flows, race guards, and known bugs. This is the most fragile area of the UI.

### 4.4 Themes (`theme-manager.js`, `themes/`)

Themes supply CSS manifests. `NUCLEUS_THEME` env selects `default`, `dark`, or `white` at startup.

---

## 5. Canvas ingestion and parsing

### 5.1 Auth — `app/canvas/auth.js`

Opens a dedicated WebContentsView to capture Canvas session cookies (`Cookie` header) and CSRF token from outbound requests. Credentials are stored in memory and written to `.env` fields (`CANVAS_AUTH_COOKIE`, `CANVAS_AUTH_CSRF`, `CANVAS_BASE_URL`).

### 5.2 Fetch — `app/canvas/api.js`

This is the production Canvas sync pipeline:

1. **REST pagination** — courses, assignments, modules, module items, files, pages
2. **Page body enrichment** — fetches HTML bodies for module pages (configurable limits in `RESOURCE_LIMITS`)
3. **Write** `canvas_data.json` — course-keyed buckets: `assignments`, `modules`, `module_items`, `files`, `pages`, `syllabi`, etc.
4. **Spawn** `parser.py` — streams JSON batches on stdin
5. **Task generation** — reads graph output and builds study tasks via `weekly-schedule.js` + `study-sections.js`
6. **Homepage cache** — saves themed Canvas homepages under `app/canvas/canvas_homepages/`

**Parser batch protocol:** Each stdin line is a JSON object:

```json
{ "type": "syllabus|assignment|page|module_item|file|course|done", "content": [...] }
```

`chunkParserPayload` splits large batches to respect `PARSER_MAX_BATCH_ITEMS`.

### 5.3 Parser service — `parser.py`

~8k-line async service. High-level pipeline per course:

```
Canvas batch in
  → download PDFs / extract text (canvas_parser/content/extractors.py)
  → classify file type (canvas_parser/parse/file_types.py)
  → LLM pass-1 / pass-2 per type profile
  → merge concepts (canvas_parser/graph/merge.py)
  → finalize events (canvas_parser/graph/events.py)
  → build text chunks + embeddings
  → write canvas_graph.json atomically
```

Important parser modules:

| Module | Role |
|--------|------|
| `canvas_parser/parse/file_types.py` | 18 academic file-type profiles (syllabus, lecture_slides, problem_set, …) |
| `canvas_parser/parse/fast_path.py` | Heuristic skip for simple files |
| `canvas_parser/parse/llm_resilience.py` | Retries, rate limits |
| `canvas_parser/content/extractors.py` | PDF, Office, HTML text extraction |
| `canvas_parser/content/ocr.py` | OCR for scanned PDFs |
| `canvas_parser/content/page_blocks.py` | Structured page block extraction |
| `canvas_parser/content/teaching_blocks.py` | Teaching unit detection for Synapse |
| `canvas_parser/graph/events.py` | Exam/review/deadline event dating |
| `canvas_parser/graph/merge.py` | Concept dedup and budget caps |
| `canvas_parser/graph/persist.py` | Graph state serialization |
| `canvas_parser/content/chunk_embeddings.py` | OpenAI embeddings for chunks |

**Graph node classes** (defined in `parser.py`): `conceptNode`, `detailNode`, `exampleNode`, `problemNode`, `eventNode`, `assignmentNode`, `fileNode`, `syllabusNode`, `learningBlock`, etc. Each carries `embedding`, `courseid`, and type-specific fields.

### 5.4 Eval traversal — `canvas_parser/weekly_iteration/llm_parse.py`

The eval harness uses `build_parser_batches()` to decide what snapshot content reaches the parser. Production `api.js` has its own batch builder that should stay aligned. When weekly accuracy misses occur, check whether the miss is a **traversal gap** (content never sent) vs **extraction gap** (sent but misread).

---

## 6. Knowledge graph

`canvas_graph.json` structure:

```json
{
  "version": "...",
  "concepts": { "courseId": [ ... ] },
  "events": { "courseId": [ ... ] },
  "files": { "courseId": [ ... ] },
  "assignments": { "courseId": [ ... ] },
  "syllabi": { "courseId": [ ... ] },
  "learningBlocks": { "courseId": [ ... ] },
  "edges": [ ... ]
}
```

Post-parse maintenance scripts (in `scripts/`):

| Script | Purpose |
|--------|---------|
| `reembed_graph.py` | Re-embed all nodes after model change |
| `dedupe_graph.py` | Collapse duplicate concept details |
| `full_reparse.py` | Rebuild graph from cached snapshots |
| `postprocess_parse_graph.py` | Quality passes after parse |

---

## 7. Weekly schedule

Weekly bucketing places assignments, files, modules, and events into **week rows** for the Canvas UI and eval scoring.

### 7.1 Production path

```
canvas_data.json
  → app/canvas/weekly-schedule.js (JS heuristics for UI)
  → canvas_parser/weekly/bridge.py (Python bridge for IPC/API calls)
  → canvas_parser/weekly_iteration/format.py (shared heuristic engine)
  → optional graph merge via weekly.py
```

`bridge.py` converts `canvas_data.json` shape into the snapshot shape expected by `format.py`, including `page_bodies` from module page items.

### 7.2 Eval path — `canvas_parser/weekly_iteration/`

| Module | Role |
|--------|------|
| `format.py` | Heuristic bucketing: module layout, due dates, filename dates, syllabus tables |
| `weekly.py` | Merges dated graph events into heuristic schedule |
| `evaluate.py` | Fuzzy match against `ground-truth/` |
| `match_utils.py` | `normalize_name`, `names_match` — canonical string matching |
| `run.py` | CLI: `python -m canvas_parser.weekly_iteration --llm` |
| `availability.py` | Harvard unlocked-only scoring |

**Important constraint:** Do not replace the Python heuristic weekly schedule with `buildWeeklyScheduleFromCanvasData` from JS — that drops file placement and regresses eval accuracy (see `AGENTS.md`).

### 7.3 Graph event merge — `weekly.py::enrich_weekly_with_graph`

After heuristics build week rows, graph events with resolvable dates are placed into the matching week. Undated events may get dates from syllabus hints, assignment `due_at`, or module anchors via `_undated_event_date_from_snapshot`.

---

## 8. Vector retrieval (RAG)

### 8.1 `vector_retreival.py`

Loads `canvas_graph.json`, embeds the user query (OpenAI `text-embedding-3-small`), scores nodes with:

- Cosine similarity on node embeddings
- Keyword / fuzzy title match
- Intent classification (deadline, exam, concept, syllabus, …)
- Type-extraction boosts from parser pass-2 metadata
- Chunk-level retrieval within file nodes

Returns **startpoints** — ranked graph nodes plus expanded neighbors and formatted citation chunks for grounding.

### 8.2 `engine.js`

Renders search results in an internal browser tab. Combines Brave web search with Canvas vector retrieval when the query is academic.

### 8.3 Citation formatting

`text-chunks.js` (JS) and `canvas_parser/content/text_chunks.py` (Python) must stay in sync. They produce `[C#]` chunk labels and `[R#]` retrieval labels for Sidekick grounding.

### 8.4 Eval

```bash
python scripts/eval_rag.py --all --production-cutoff
```

Ground truth: `RAG_ground_truth.json`, `RAG_holdout_ground_truth.json`.

---

## 9. Sidekick agent

### 9.1 Flow

```
User message (renderer)
  → ipcMain 'prompt:send'
  → lib/sidekick-router.js classifies intent
  → optional vector_retreival.py query
  → context-store + context-index + context_format.py assemble snapshot
  → agent-process.js writes JSON line to sidekick.py stdin
  → sidekick.py streams text / tool calls as JSON lines
  → main.js executes tools (add_task, open_canvas_tab, create_artifact, …)
  → tool response written back to sidekick.py stdin
```

### 9.2 `sidekick.py`

- Models: Claude (`ANTHROPIC_API_KEY`) and DeepSeek (`DEEP_SEEK_API_KEY`)
- Tool definitions for tasks, tabs, Canvas, artifacts, retrieval
- `sidekick_context.py` injects grounding instructions and citation rules
- `sidekick_router.py` routes to tool/data/chat/fallback paths

### 9.3 `agent-process.js`

Thin adapter: spawns Python, buffers stdout by newline, dispatches:

| JSON shape | Handler |
|------------|---------|
| `"string"` | `onText` — stream to UI |
| `{ type: "done" }` | `onDone` |
| `{ type: "replace", text }` | Replace last message |
| `[tool_call, ...]` | `onToolCall` → stdin tool response |

### 9.4 Context pipeline

| Module | Role |
|--------|------|
| `context-store.js` | Versioned slices: UI state, retrieval results, screen region |
| `context-index.js` | Compact index: due-soon tasks, focus courses, weekly highlights |
| `context_format.py` | Formats snapshot into Sidekick system prompt text |
| `text_sanitize.py` | UTF-16 surrogate cleanup (mirrored in `context-index.js`) |

---

## 10. Synapse Learn

Synapse is a structured study mode that walks students through a **curriculum** derived from the knowledge graph.

### 10.1 Backend — `canvas_parser/synapse_teaching.py`

`build_curriculum(course_id, graph)`:

1. Collect teaching units from graph concepts, file `typeExtractions`, and page blocks
2. Build holistic lessons from Canvas homepage links (`holistic_canvas.py`)
3. Order lessons by module sequence, document order, lecture numbers
4. Strip admin/logistics noise
5. Attach grounding chunks via `synapse_grounding.py`

CLI: `python -m canvas_parser.synapse_teaching --course-id 12345`

### 10.2 Frontend — `app/synapse/`

| File | Role |
|------|------|
| `synapse.js` | Main Synapse UI |
| `synapse-tabs.js` | Tab navigation |
| `teaching-curriculum.js` | IPC to list/load curriculum, cache in `.cache/synapse_teaching/` |
| `course-teacher.js` | Per-lesson teaching interaction |
| `client.js` | Chat IPC for Synapse Q&A |

### 10.3 Eval

```bash
python scripts/eval_synapse_teaching.py
python scripts/eval_synapse_teaching_holdout.py --compare-in-sample
```

---

## 11. Mail, Gradescope, artifacts

### 11.1 Mail — `app/mail/`

| File | Role |
|------|------|
| `api.js` | Gmail OAuth, fetch, send, modify |
| `cache.js` | Local message cache |
| `classify.js` | Email classification |
| `contacts.js` | Contact sync |
| `events.js` | Calendar-style mail events |
| `mail.js` / `mail-tabs.js` | UI |

### 11.2 Gradescope — `app/platforms/gradescope/`

Syncs Gradescope assignments to Canvas project tasks. Name matching uses `lib/normalize-name.js`.

### 11.3 Artifacts

| File | Role |
|------|------|
| `artifact-store.js` | Persists artifacts under Electron `userData` |
| `artifact-generators.js` | In-process HTML/chart/table/flashcard generators |
| `artifact-graph-flashcards.js` | Flashcards from graph concepts |
| `agent-artifacts.js` | Routes to JS generators or `agent_artifacts/build.py` for docx/pptx |
| `agent_artifacts/build.py` | Python docx/pptx builder |

---

## 12. Tasks and context

### 12.1 `data-store.js`

In-memory store for workspaces, project groups, and tasks. Canvas sync merges course project groups from parsed graph data. Tasks carry study sections (`study-sections.js`) for spaced review.

### 12.2 `taskoptimizer.js`

Production task priority scoring using prerequisites, due dates, and priority weights. Eval harness: `task_optimizer_iteration/`.

### 12.3 Canvas → tasks

`app/canvas/api.js` reads graph learning blocks and weekly schedule to emit task cards with study sections. Refreshes on parser progress events (`PARSER_TASK_REFRESH_MS`).

---

## 13. IPC contract

Complete surface is defined in `preload.js`. Grouped by domain:

### App and layout
- `app:renderer_ready`, `data:get`, `theme:list`, `theme:set`
- `layout:workspace_sidebar_collapsed`, `layout:right_panel_width`, `overlay:set_open`

### Tabs and navigation
- `tabs:push`, `tabs:new_active`, `tabs:navigate`, `tabs:back`

### Canvas
- `canvas:ensure_auth`, `canvas:request_update`, `canvas:open_app`, `canvas:logout`
- `canvas:preload_plan`, `canvas:open_link`, `canvas:restore_native`, `canvas:fetch_image`
- Events: `canvas:update`, `canvas:navigation-finished`, `tabs:url_update`

### Sidekick and Synapse
- `prompt:send`, `synapse:send`, `synapse:list-courses`, `synapse:get-curriculum`

### Mail
- `mail:ensure_auth`, `mail:get_inbox`, `mail:get_view`, `mail:send`, `mail:modify`, …

### Artifacts
- `artifacts:list`, `artifacts:get`, `artifacts:download`, `artifacts:open_external`

### Context
- `context:ui_state` (send), `region:text_context`, `region:capture_shortcut`

### Engine
- `engine:url`, `engine:internal-navigate`, `engine:open-app`

---

## 14. Evaluation and tests

### Formal test suites (keep)

| Command | Covers |
|---------|--------|
| `npm test` | Node tests: IPC, renderer, context |
| `npm run test:canvas-preload` | Canvas preload planner/pool |
| `npm run test:app-fork` | App fork timing/race tests |
| `pytest tests/` | Python: weekly, parser, retrieval, sidekick, synapse |

### Formal eval harnesses (keep)

| Command | Metric |
|---------|--------|
| `python -m canvas_parser.weekly_iteration --llm` | Weekly schedule accuracy vs ground truth |
| `python scripts/eval_rag.py --production-cutoff` | RAG recall/nDCG |
| `python scripts/eval_synapse_teaching.py` | Curriculum coverage |
| `python scripts/run_parse_speed_benchmark.py` | Parse cost/time budget |
| `npm run eval:canvas-preload` | Preload hit rate |
| `npm run eval:app-fork` | Startup/tab-switch timing |

### Profile-specific eval

```bash
python -m canvas_parser.weekly_iteration --harvard      # Harvard Canvas GT
python -m canvas_parser.weekly_iteration --holdout      # Holdout student
```

Reports land in `.cache/weekly_iteration/report*.json`.

---

## 15. Security model

- **Renderer sandbox:** `contextIsolation: true`, no `nodeIntegration`
- **Secrets in main only:** `.env`, Canvas cookies, API keys never exposed to preload/renderer
- **IPC validation:** Tool handlers in `main.js` validate arguments before filesystem/network ops
- **Canvas auth:** Session cookies captured once via dedicated auth view; stored in `.env` for Python subprocesses
- **No ground-truth literals in production code:** Eval labels live only in `ground-truth/` (see `AGENTS.md` overfitting guardrails)

---

## 16. Debugging guide

### Canvas data missing or stale
1. Check `.env` has valid `CANVAS_AUTH_COOKIE` / `CANVAS_BASE_URL`
2. Trigger sync: open Canvas app or `canvas:request_update`
3. Inspect `canvas_data.json` for the course bucket

### Parser not producing graph
1. Check `DEEP_SEEK_API_KEY` in `.env`
2. Watch parser stderr from `api.js` (stdout is parsed silently)
3. Run `python parser.py` manually with a test batch line
4. Check `canvas_parser/graph/parse_activity_log.py` output in terminal

### Weekly schedule wrong in UI
1. Compare `bridge.py` output vs `format.py` directly on snapshot
2. Check whether graph events exist in `canvas_graph.json` for the course
3. Run eval: `python -m canvas_parser.weekly_iteration --llm` and read `report.json`

### RAG returning wrong nodes
1. `python scripts/rag_query_audit.py` for single-query trace
2. Check embeddings present on target nodes in graph
3. Run `python scripts/eval_rag.py` with failing query

### Sidekick tool failures
1. Enable `NUCLEUS_DEBUG=all` (`npm run start:debug`)
2. Check `lib/diagnostics-main.js` channels
3. Trace IPC handler in `main.js` for the tool name

### Synapse curriculum empty
1. `python -m canvas_parser.synapse_teaching --course-id <id>` CLI
2. Check graph has `typeExtractions` / teaching blocks for course files
3. Run `python scripts/eval_synapse_teaching.py`

### Canvas tab slow / blank
1. Preload pool stats: `canvas:preload_stats` IPC
2. Check `lib/canvas-preload-planner.js` candidate URLs
3. `npm run eval:canvas-preload` for regression
4. **Full tab flow:** [§18](#18-tab-management-and-rendering) — surface type (native vs browser), `renderTab`, slate/snapshot races

---

## 17. Where to edit what

| Goal | Primary files |
|------|---------------|
| New IPC feature | `preload.js`, `main.js`, renderer caller |
| Canvas API fetch | `app/canvas/api.js` |
| Parser prompts / passes | `parser.py`, `canvas_parser/parse/file_types.py` |
| What content reaches parser (eval) | `canvas_parser/weekly_iteration/llm_parse.py` |
| Event dates after LLM | `canvas_parser/graph/events.py` |
| Weekly heuristics | `canvas_parser/weekly_iteration/format.py` |
| Weekly graph merge | `canvas_parser/weekly_iteration/weekly.py` |
| Production weekly UI | `app/canvas/weekly-schedule.js`, `canvas_parser/weekly/bridge.py` |
| RAG ranking | `vector_retreival.py` |
| Sidekick tools / prompts | `sidekick.py`, `sidekick_context.py` |
| Intent routing | `sidekick_router.py`, `lib/sidekick-router.js` |
| Synapse curriculum | `canvas_parser/synapse_teaching.py`, `app/synapse/teaching-curriculum.js` |
| Artifacts | `agent-artifacts.js`, `artifact-generators.js` |
| Task priority | `taskoptimizer.js` |
| Gmail | `app/mail/api.js` |
| Themes | `themes/`, `theme-manager.js` |
| File type classification | `canvas_parser/parse/file_types.py`, `.cursor/skills/parser-file-type-*/` |
| **Tab switching / Canvas browser** | **§18**, `main.js`, `renderer/workspace-page-tabs.js`, `renderer/app.js`, `renderbugs.md` |

---

## 18. Tab management and rendering

This section documents the tab system end-to-end. Tab switching is **paint-first, sync-second**: the renderer updates DOM immediately, then asynchronously tells main to attach/detach `WebContentsView`s. That design reduces perceived latency but creates many race windows. For a catalog of observed bugs, see `renderbugs.md`.

### 18.1 Split ownership model

Nucleus does **not** have a single source of truth for tabs. Two parallel tab lists exist:

| Layer | Variables | What it tracks |
|-------|-----------|----------------|
| **Renderer** | `state.tabs`, `state.activeTabId`, `state.activeTabByWorkspace`, `state.top` | **All** workspace tabs: center, task, browser, canvas, mail, synapse, artifact |
| **Main** | `currtabs`, `activetab`, `tabids` | **Web/native-app tabs only**: `browsertab`, `canvastab`, `mailtab`, `synapsetab` |

Center tabs (`type: "center"`) and task tabs (`type: "task"`) exist only in the renderer. When one is active, main calls `renderTab("None")` and hides every `WebContentsView` — the renderer paints HTML into `#view`.

Main tracks tabs with `shouldTrackInCurrtabs()` (`main.js`):

```javascript
tab.type === "browsertab" || tab.type === "canvastab" ||
tab.type === "mailtab" || tab.type === "synapsetab"
```

**Synchronization** happens through two IPC calls that must usually run in order:

1. `tabs:push` — reconcile the full tab list (`currtabs` merge, view create/destroy/stash)
2. `tabs:new_active` — set `activetab` and show/hide the correct surface

### 18.2 Tab types and visual surfaces

| Tab type | `canvasMode` | What the user sees | Who paints `#view` |
|----------|--------------|-------------------|-------------------|
| `center` | — | Project center panel | Renderer HTML |
| `task` | — | Task workspace | Renderer HTML |
| `browsertab` | — | External website | Main `WebContentsView` over `#view` |
| `canvastab` | `native` (default) | Canvas dashboard / course (in-app UI) | Renderer via `nucleusCanvasApp.renderCanvasApp()` |
| `canvastab` | `browser` | Canvas website in embedded browser | Main `WebContentsView` over empty `#view` |
| `mailtab` | — | Gmail UI | Renderer via `nucleusMailApp` |
| `synapsetab` | — | Synapse Learn UI | Renderer via `nucleusSynapseApp` |
| `artifacttab` | — | Artifact preview | Renderer via `nucleusArtifactTabs` |

Helper predicates (used on both sides):

- `isWebContentTab(tab)` — `browsertab`, or `canvastab` with `canvasMode === "browser"`
- `isCanvasNativeTab(tab)` — `canvastab` and `canvasMode !== "browser"`
- `isNativeSurfaceTab(tab)` — mail, synapse, artifact, or native canvas

**Canvas is the hardest case** because one tab record switches between two completely different rendering backends (DOM app vs Electron webview).

### 18.3 Key files

| File | Responsibility |
|------|----------------|
| `renderer/app.js` | `switchWorkspaceTab`, `paintActiveView`, `composeActiveViewHtml`, `setViewSwitching`, canvas toolbars |
| `renderer/workspace-page-tabs.js` | `syncTabs`, `syncActiveTab`, `deferActiveTabSync`, `openCourseLinkInCanvasTab`, `restoreCanvasNativePage`, `newWebContentTab` |
| `renderer/render.js` | IPC listeners: `tabs:view_state`, `tabs:url_update`, `tabs:snapshot_overlay`, `applyTabViewState` |
| `main.js` | `tabs:push`, `tabs:new_active`, `tabs:navigate`, `tabs:back`, `renderTab`, `syncActiveSurfaceFromMainTab`, canvas link/native handlers |
| `lib/canvas-preload-pool.js` | Predictive URL → view registry (mostly inactive under simple model) |
| `lib/canvas-preload-planner.js` | Scores preload URL candidates from schedule/graph |
| `preload.js` | IPC bridge: `tabschanged`, `newactivetab`, `openCanvasLink`, `restoreCanvasNative`, `backBrowserTab` |
| `renderbugs.md` | Observed latency drivers, races, functional bugs |

### 18.4 Tab record fields (renderer ↔ main)

Fields that cross the IPC boundary and affect rendering:

| Field | Set by | Meaning |
|-------|--------|---------|
| `id` | Renderer | Stable tab key (`canvas:…`, `browser:…`) |
| `type` | Renderer | Tab kind (see §18.2) |
| `workspaceId` | Renderer | Owning workspace |
| `url` | Both | Browser/Canvas browser URL; cleared for native canvas |
| `canvasMode` | Both | `"native"` or `"browser"` for canvas tabs |
| `canvasNativePage` | Both | Native page: `dashboard`, `course`, etc. |
| `courseId`, `courseSection` | Both | Native canvas navigation state |
| `nativeHistory` | Renderer | Stack of native states for browser→native restore |
| `loading` | **Both (races)** | Navigation in progress; affects snapshot overlay |
| `viewTier` | Both | `"active"`, `"stashed"`, `"discarded"` — view lifecycle hint |
| `discarded` | Both | Tab unloaded from memory |
| `snapshotDataUrl` | Main→renderer | PNG data URL for transition coverup |
| `pendingSwitchSlate` | Renderer→main | Canvas browser tab switch should use slate path |
| `injection` | Renderer | CSS injected into Canvas browser views |
| `yindex` | Renderer | Scroll position in native canvas course view |

Main tab records additionally hold `view` (the `WebContentsView` reference) and `poolType` (`"web"` | `"canvas"`).

### 18.5 Paint-first architecture

Every tab switch follows this pattern:

```
User click
  → Renderer updates state + paints #view immediately (optimistic)
  → async IPC: tabs:push then tabs:new_active
  → Main attaches/detaches WebContentsView
  → Main sends tabs:view_state / tabs:url_update back to renderer
  → Renderer may repaint again (applyTabViewState → paintActiveView)
```

**Why paint-first:** `paintActiveView` runs synchronously in the click handler so native canvas/mail/synapse appear instantly without waiting for main-process view pool work.

**Cost:** Renderer and main can disagree for tens to thousands of milliseconds. Guards (§18.6) drop stale IPC; bugs occur when guards fail or fields like `loading` desync.

#### `paintActiveView` (`renderer/app.js`)

1. `getActiveViewContext()` — resolve `activeTab` from `state`
2. `composeActiveViewHtml()` — build inner HTML:
   - Native canvas → `nucleusCanvasApp.renderCanvasApp(tab, canvasData)`
   - Web content tab → often **empty** (main webview covers `#view`); may show `snapshotDataUrl` overlay while `loading`
   - Mail/synapse/artifact → respective app renderers
3. Write `view.innerHTML` or crossfade via `nucleusViewTransition`
4. `mountActiveViewHandlers` — wire click handlers (including Canvas link → `openCourseLinkInCanvasTab`)

`setViewSwitching(true)` adds CSS class `view-is-switching` on `#view` during transitions.

### 18.6 Race guards and serialization

| Guard | Location | What it prevents |
|-------|----------|------------------|
| `tabSurfaceSyncGeneration` | `workspace-page-tabs.js` | Stale `deferActiveTabSync` completing after a newer tab click |
| `lastTabPushFingerprint` | Renderer `syncTabs` | Redundant `tabs:push` when tab list unchanged |
| `lastTabsPushFingerprint` | Main `tabs:push` | Redundant main-side reconciliation |
| `runSerializedTabOperation` | `main.js` | Concurrent `tabs:push` / `tabs:new_active` corrupting `currtabs` |
| `rendererActiveTabRequestSeq` | Main `tabs:new_active` | Only the latest activation request runs |
| `tabActivationGeneration` | Main | Deferred deactivation of previous tab cancelled on newer activation |
| `canvasLinkCancelGen` | Main | In-flight `canvas:open_link` cancelled when user restores native or opens another link |
| `canvasLinkOpening` | Renderer | Double-click on Canvas links ignored |
| `canvasPreloadGeneration` | Main | Stale background preload loads abandoned |
| `requestAnimationFrame` early `finishTabSurfaceSwitch` | Renderer | Clears `view-is-switching` before IPC returns (intentional UX tradeoff) |

**Not serialized (important):** `canvas:open_link` and `canvas:preload_plan` run **outside** `runSerializedTabOperation`. They can interleave with `tabs:push` and mutate `currtabs` / pool concurrently (`renderbugs.md` F10).

### 18.7 WebContentsView pool and simple tab model

`BrowserPool` (`main.js`) manages recycled `WebContentsView` instances:

| Tier | Limit (per `web` / `canvas`) | Purpose |
|------|------------------------------|---------|
| Active | 4 | Tabs with visible or attached views |
| Backup (stash) | 3 | Stashed tab views for fast restore |
| Max pool | 8 | Hard cap including predictive preload |

`USE_SIMPLE_TAB_MODEL = true` (`main.js:233`): each `canvastab` gets a **dedicated** canvas `WebContentsView` via `ensureCanvasTabWebView`. Pool-based predictive preload for canvas is largely bypassed; `hideCanvasTabWebView` replaces true stash for native canvas tabs.

When native canvas is active, main **hides** the dedicated view but keeps it warm for the next browser link.

### 18.8 `renderTab` — main-process visibility

`renderTab(view, window, tab)` (`main.js`) is the single function that decides which `WebContentsView` is attached and visible:

1. `view === "None"` → `hideAllWebContentViews` (native/mail/center active)
2. Detach all other tab views from the window
3. `attachWebContentView(window, view, tab)` — position over `#view` bounds
4. If `rendererOverlayDepth > 0` → hide (modal open)
5. If `view._nucleusBlankedForCanvasWipe` or `_nucleusRestorePending` → hide
6. Canvas browser tab: defer reveal while `tab.loading` or `_nucleusSlateNavigationInProgress`
7. Otherwise `revealCanvasView` (may delay 100ms unless `immediate: true`)

`syncActiveSurfaceFromMainTab(window, mainTab)` routes to `renderTab`:

- Web content tab with view → `renderTab(view, …)`
- Native surface tab → `renderTab("None", …)` + hide/warm canvas view
- No tab → `renderTab("None", …)`

### 18.9 Main → renderer events

| Event | Handler | Effect |
|-------|---------|--------|
| `tabs:view_state` | `applyTabViewState` | Updates `viewTier`, `discarded`, `snapshotDataUrl`, **`loading=false` on active tier** |
| `tabs:url_update` | `render.js` listener | Updates `tab.url`, toolbar |
| `tabs:title_update` | `render.js` listener | Updates `tab.pageTitle` |
| `tabs:snapshot_overlay` | Snapshot overlay state | Full-frame cover image in `#view` |
| `canvas:navigation-finished` | Clears loading, toolbar refresh | `"done"`, `"auth"`, `"fail"` |

**Race hotspot:** `applyTabViewState` sets `tab.loading = false` whenever `tier === "active"` (`render.js:93-95`), but `broadcastTabViewState` does not send a `loading` field. Main may still consider the tab loading during slate navigation → renderer drops loading overlay prematurely (R1 in `renderbugs.md`).

---

### 18.10 Flow: User clicks a workspace tab

**Entry:** Tab bar click → `switchWorkspaceTab(tabId)` (`renderer/app.js`)

#### Phase A — Renderer (synchronous, same tick)

| Step | Action |
|------|--------|
| A1 | `switchGen = bumpTabSurfaceSyncGeneration()` — invalidates prior async syncs |
| A2 | `patchOptimisticWorkspaceTabActive(tabId)` — tab bar `.active` class + `setViewSwitching(true)` |
| A3 | `rememberActiveCanvasYIndex()` — save scroll if leaving native canvas |
| A4 | `state.activeTabId = tabId`, `state.activeTabByWorkspace[workspaceId] = tabId` |
| A5 | `demoteSiblingWebTabViewTiers()` — sibling web tabs → `viewTier: "stashed"` |
| A6 | `nextTab.loading = false` (**optimistic — may disagree with main**) |
| A7 | `nextTab.pendingSwitchSlate = true` if switching to canvas **browser** tab |
| A8 | `nextTab.viewTier = "active"` |
| A9 | `window.__nucleusTabSnapshot.clear()` |
| A10 | `patchWorkspacePageTabs()` + `renderWorkspaceViewPartial({ shell: "minimal" })` |
| A11 | `beginPendingViewTransition()` |
| A12 | **`paintActiveView({ fast: true })`** — user sees new content immediately |
| A13 | `syncRenderContext()` → `context:ui_state` IPC |
| A14 | `deferActiveTabSync(switchGen)` — schedules Phase B |

#### Phase B — Renderer async (`deferActiveTabSync`)

| Step | Action |
|------|--------|
| B1 | `syncTabs()` → `window.nucleus.tabschanged(state.tabs, activeTabId)` |
| B2 | If `switchGen` still current and `activeTabId` unchanged → `syncActiveTab()` → `newactivetab(tab)` |
| B3 | `finishTabSurfaceSwitch(switchGen)` → `setViewSwitching(false)` |
| B4 | **Parallel:** `requestAnimationFrame` also calls `finishTabSurfaceSwitch` — UI unlocks before B1-B2 finish (R11) |

`syncTabs` may **skip** if `buildTabPushFingerprint()` unchanged (note: fingerprint omits `loading` — F11).

#### Phase C — Main `tabs:push` (serialized)

| Step | Action |
|------|--------|
| C1 | Fingerprint check → may return early |
| C2 | Remove closed tabs: `releaseTabView`, clear predictive views, delete snapshots |
| C3 | For each incoming tab: `mergeIncomingTab` or `createMainTabRecord` + push to `currtabs` |
| C4 | Canvas tabs: `ensureCanvasTabWebView`; if native → `hideCanvasTabWebView` |
| C5 | Inactive web tabs → `stashTabViewToBackup` or hide |
| C6 | Active tab without view → acquire from pool / restore stash / create new view |
| C7 | `deactivateTabsOutsideWorkspace` |
| C8 | **`syncActiveSurfaceFromMainTab(mainwindow, activeMainTab)`** |

#### Phase D — Main `tabs:new_active` (serialized, after push)

| Step | Action |
|------|--------|
| D1 | `rendererActiveTabRequestSeq` stale check |
| D2 | `tabActivationGeneration++` |
| D3 | `mergeIncomingTab(foundtab, rendererPayload)` |
| D4 | `activetab = foundtab` |
| D5 | `tabViewLifecycle.onTabActivated` → ensure view exists |
| D6 | `syncActiveSurfaceFromMainTab` again |
| D7 | `setImmediate` → deferred `onTabDeactivated(previous)` + `deactivateTabsOutsideWorkspace` (gated by `tabActivationGeneration`) |

#### Phase E — Main → renderer feedback

- `tabs:view_state` with tier/snapshot → `applyTabViewState` → may trigger **second** `paintActiveView`
- `tabs:url_update` if URL changed during restore

**If user clicks another tab before Phase B-D complete:** `switchGen` mismatch → stale sync dropped; newer switch wins.

---

### 18.11 Flow: Canvas native → browser (click course link)

**Entry:** Link in native Canvas DOM → `openCourseLinkInCanvasTab(link)` (`workspace-page-tabs.js`)

#### Renderer steps

| Step | Action |
|------|--------|
| 1 | If `canvasLinkOpening` → **return** (drops rapid clicks, R3) |
| 2 | `resolveCanvasTabForLink(workspaceId)` — reuse existing canvas tab |
| 3 | `pushCanvasNativeHistory(tab)` — push `{page, courseId, courseSection, yindex}` onto `nativeHistory` |
| 4 | `tab.canvasMode = "browser"`, `tab.url = href`, `tab.loading = true` |
| 5 | `state.activeTabId = tab.id` |
| 6 | **`paintActiveView({ fast: true })`** — `#view` empty or snapshot; webview not yet visible |
| 7 | **`await window.nucleus.openCanvasLink({ tabId, url, tabs, activeTabId })`** — blocks until main finishes |
| 8 | **`tab.loading = false`** unconditionally after IPC (**before main may finish slate**, R2) |
| 9 | `queueTabSyncAfterRender()` → microtask: `syncTabs` + `syncActiveTab` |

#### Main `canvas:open_link` → `activateCanvasBrowserLinkSimple` (when `USE_SIMPLE_TAB_MODEL`)

| Step | Action |
|------|--------|
| M1 | `cancelSnap = canvasLinkCancelSnapshot(tabId)` |
| M2 | `mergeRendererTabsFromPayload(tabs, activeTabId)` |
| M3 | Promote `browsertab` → `canvastab` if needed |
| M4 | `tab.canvasMode = "browser"`, `tab.url = normalizedUrl`, `tab.loading = true` |
| M5 | `activetab = tab` |
| M6 | `view = await ensureCanvasTabWebView(tab)` — dedicated view |
| M7 | `ensureCanvasTabViewHandlers` + **`renderTab(view, window, tab)`** (view hidden while loading) |
| M8 | Cancel check → may return `{ reason: "cancelled" }` |
| M9 | If URL mismatch → `loadCanvasLinkFast` (auth check + loadURL + nav wait) |
| M10 | Else → `revealCanvasView({ immediate: true })` |
| M11 | `syncActiveSurfaceFromMainTab` + `canvas:navigation-finished: "done"` + `tabs:url_update` |

**Not serialized with `tabs:push`:** link open can race with a concurrent push (F10).

**After link:** `queueTabSyncAfterRender` runs a **full** `tabs:push` even though main already activated the surface (L16) — duplicate work.

---

### 18.12 Flow: Canvas browser → native (restore)

**Entry:** `restoreCanvasNativePage(tab)` (`workspace-page-tabs.js`) — **defined but not wired to any toolbar button** as of this writing. Canvas toolbar back uses web history only (`goBackActiveCanvasTab`).

#### Intended renderer steps

| Step | Action |
|------|--------|
| 1 | `nativeHistory.pop()` → restore `canvasNativePage`, `courseId`, etc. |
| 2 | `tab.canvasMode = "native"`, `tab.url = ""`, `tab.loading = false` |
| 3 | **`await window.nucleus.restoreCanvasNative({ tabId, tab, tabs, activeTabId })`** |
| 4 | `refreshCanvasNativeView({ skipTransition: true })` — paints native DOM |
| 5 | `queueTabSyncAfterRender()` |

#### Main `canvas:restore_native` → `restoreCanvasNativeSurface`

| Step | Action |
|------|--------|
| 1 | **`bumpCanvasLinkCancel(tabId)`** — aborts in-flight link open |
| 2 | `mergeRendererTabsFromPayload` |
| 3 | `foundtab.canvasMode = "native"`, clear url |
| 4 | `hideCanvasTabWebView` (simple model) |
| 5 | `activetab = foundtab` |
| 6 | **`hideAllWebContentViews`** + `syncActiveSurfaceFromMainTab` → `renderTab("None")` |

**Bug class:** If restore is not called, webview stays visible over native DOM (F3). If `nativeHistory` is empty but user expects native, web back does nothing useful (F2).

---

### 18.13 Flow: `queueTabSyncAfterRender` (post-render sync)

Called after `closeTab`, `newWebContentTab`, `openCanvasAppTab`, successful link open, etc.

| Step | Action |
|------|--------|
| 1 | Set `tabSyncCoalescePending = true` |
| 2 | Schedule single microtask (coalesces multiple calls per tick) |
| 3 | `await syncTabs()` |
| 4 | `await syncActiveTab()` (unless `activeOnly`) |

**Note:** Full `render()` does **not** automatically sync — callers must invoke `queueTabSyncAfterRender` explicitly.

---

### 18.14 Flow: Create new browser/canvas tab

**Entry:** `+` button → `newbrowsertab` → `newWebContentTab` (`workspace-page-tabs.js`)

| Step | Action |
|------|--------|
| 1 | Create tab object with `id: "browser:timestamp:…"` or `"canvas:…"` |
| 2 | `state.tabs.push(newtab)` |
| 3 | If active: update `state.activeTabId`, call `render()` |
| 4 | Async `finishTabSync`: optional `getEngineUrl()` for empty browser tabs |
| 5 | `await syncTabs()` → main creates view for active web tab |
| 6 | If active: `await syncActiveTab()` → `tabs:new_active`, `render()` again |

Canvas tabs start with `loading: true` until `canvas:navigation-finished`.

---

### 18.15 Flow: Browser back button

#### Generic `browsertab`

`goBackActiveBrowserTab` → `tabs:back` → `view.webContents.goBack()` — URL updates via navigation listeners.

#### Canvas browser tab

`goBackActiveCanvasTab` → `tabs:back` (canvas branch):

| Step | Action |
|------|--------|
| 1 | `view._nucleusSuppressNextCanvasSlate = true` |
| 2 | `view.webContents.goBack()` |
| 3 | `waitForCanvasNavigationAndSettle` |
| 4 | Update `foundtab.url`, send `tabs:url_update` |
| 5 | `revealCanvasView(view, { immediate: true })` |

**Does not** call `restoreCanvasNativePage` even when `nativeHistory.length > 0`.

---

### 18.16 Slate / snapshot coverup (Canvas browser)

When navigating to a new Canvas URL, main may run `runCanvasSlateNavigation`:

1. Hide webview
2. **`capturePage()`** — full-frame screenshot (blocks navigation start, L1)
3. Send snapshot to renderer via `tabs:view_state` / overlay
4. `loadURL`
5. Reveal when settled

The animated `slate.html` overlay is **not** on the hot path. The cost is dominated by `capturePage()` before `loadURL`.

Renderer shows snapshot in `composeActiveViewHtml` when `tab.loading && tab.snapshotDataUrl`.

**Races:** Renderer clears `loading` before slate completes (R2); `applyTabViewState` clears `loading` on active tier (R1) — both defeat the snapshot overlay.

---

### 18.17 Known race conditions and bug patterns

| ID | Symptom | Root cause | Files |
|----|---------|------------|-------|
| R1 | Loading overlay disappears mid-navigation | `applyTabViewState` forces `loading=false` on active tier | `render.js` |
| R2 | Blank flash during link open | Renderer sets `loading=false` after IPC regardless of main state | `workspace-page-tabs.js` |
| R4 | Stale sync after fast tab switching | `deferActiveTabSync` dropped by generation — expected | `workspace-page-tabs.js` |
| R6 | Native restore vs stashed view_state | `tabs:view_state` stashed tier arrives during native restore | `render.js`, main stash |
| R7 | Link open cancelled | `bumpCanvasLinkCancel` on native restore | `main.js` |
| R10 | Main/renderer `loading` disagree | `mergeIncomingTab` on `tabs:new_active` overwrites after link open | `main.js` |
| R11 | UI shows switch complete before main ready | `requestAnimationFrame` early `finishTabSurfaceSwitch` | `workspace-page-tabs.js` |
| F2 | Back button blank screen | Web `goBack` with empty history + hidden webview | `tabs:back` |
| F3 | Native canvas hidden under webview | `restoreCanvasNative` not called | toolbar wiring |
| F10 | Pool corruption / wrong active view | `canvas:open_link` not serialized with `tabs:push` | `main.js` |
| L3 | 4s+ tab switch | `tabs:push` queued behind prior serialized work | `runSerializedTabOperation` |
| L16 | Slow link open tail | Redundant full `tabs:push` after link already activated | `openCourseLinkInCanvasTab` |

Full list with measurement hooks: `renderbugs.md`.

---

### 18.18 Debugging tab issues

1. **Enable diagnostics:** `npm run start:debug` (`NUCLEUS_DEBUG=all`) — `lib/diagnostics-main.js` channels: `tabs`, `ipc`, `layout`, `pool`
2. **Identify which surface should be visible:** native DOM vs webview — check `tab.canvasMode`, `activetab` on main, whether `renderTab("None")` was called
3. **Check sync order:** was `tabs:push` skipped by fingerprint? was `tabs:new_active` stale?
4. **Canvas link:** trace `openCourseLinkInCanvasTab` → `canvas:open_link` → `loadCanvasLinkFast` → `canvas:navigation-finished`
5. **Run race tests:** `node --test tests/renderer/tab-switch-races.test.js tests/app-fork/race-activation.test.js`
6. **Run timing eval:** `npm run eval:app-fork`

| Symptom | First checks |
|---------|--------------|
| Wrong page after tab switch | `restoreStashedTabView` URL mismatch; stash fingerprint |
| Canvas link does nothing | `canvasLinkOpening` mutex; `invalid_tab` type; pool `no_view` |
| Native canvas blank | `nucleusCanvasApp` loaded? `htmlLen` in native render |
| Webview over native app | `restoreCanvasNative` called? `hideAllWebContentViews` |
| Tab bar missing | `state.top !== "workspace"` clears bar (F4) |
| Slow switch | serialized queue depth; slate `capturePage` time |

---

## Appendix A — `canvas_data.json` shape

Course-keyed buckets (string course IDs as keys):

```json
{
  "courses": [ { "id", "name", "course_code", "term", ... } ],
  "assignments": { "courseId": [ ... ] },
  "modules": { "courseId": [ ... ] },
  "module_items": { "courseId": { "moduleId": [ ... ] } },
  "files": { "courseId": [ ... ] },
  "pages": { "courseId": [ ... ] },
  "syllabi": { "courseId": { "syllabus_body", ... } },
  "page_bodies": { "courseId": { "pageUrl": "html..." } }
}
```

## Appendix B — Parser file types

Eighteen academic profiles in `canvas_parser/parse/file_types.py`:

`syllabus`, `lecture_slides`, `lecture_notes`, `problem_set`, `assignment_sheet`, `past_exam`, `exam_solution`, `lab_handout`, `humanities_reading`, `literary_work`, `research_article`, `textbook_chapter`, `reference_sheet`, `review_sheet`, `discussion_prompt`, `code_technical`, `administrative`, `generic_content`

Each profile defines pass-1/pass-2 prompts and extraction schema. Skills in `.cursor/skills/parser-file-type-*/` document per-type rules.

## Appendix C — Shared JS/Python mirrors

These pairs must be kept logically in sync when editing:

| JavaScript | Python |
|------------|--------|
| `lib/sidekick-router.js` | `sidekick_router.py` |
| `text-chunks.js` | `canvas_parser/content/text_chunks.py` |
| `context-index.js` (`cleanSurrogates`) | `text_sanitize.py` |
| `lib/normalize-name.js` | `canvas_parser/weekly_iteration/match_utils.py` (`normalize_name`) |

## Appendix D — npm scripts reference

| Script | Purpose |
|--------|---------|
| `npm start` | Launch Electron |
| `npm test` | Node unit tests |
| `npm run test:context` | Context store + format tests |
| `npm run test:canvas-preload` | Preload module tests |
| `npm run test:app-fork` | Fork/stress tests |
| `npm run eval:*` | Performance eval harnesses |
| `npm run start:debug` | `NUCLEUS_DEBUG=all` |

---

*Last updated: 2026-06-24 — reflects post-cleanup architecture (agent debug instrumentation removed, ad-hoc probe scripts deleted).*
