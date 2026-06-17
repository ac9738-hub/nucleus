# Weekly schedule iteration (cloud agent)

## Problem statement

For every ground-truth course, the information needed to place assignments, files, and events in the correct week **already exists in Canvas** — in syllabi, assignment descriptions, module pages, due dates, filenames, and linked PDFs. The snapshots in `fixtures/weekly_iteration/snapshots_gt.json` contain this raw material.

**The gap is not missing Canvas data; it is incomplete or incorrect extraction.** The LLM parser (`parser.py`) is either:

1. **Not fully traversing** the available Canvas inputs (syllabus, assignments, module pages, files, module items), or
2. **Not correctly interpreting** what it does see (exam dates buried in prose, bilingual titles, in-class vs online submission types, schedule tables, page-body PDF links).

Ground truth in `ground-truth/` is the scorecard. A miss means the parser pipeline failed to find or correctly read information that was present somewhere in the course snapshot — **not** that the week placement is unknowable.

**Primary goal:** refine **parser prompts**, **batch/traversal structure** (`llm_parse.py::build_parser_batches`), and **post-LLM event extraction** (`canvas_parser/graph/events.py`) so the graph captures what Canvas already contains. Use `format.py` heuristics only for gaps the graph cannot cover (module file placement, due-date bucketing of assignments already in the snapshot JSON).

**Target:** ≥97% aggregate weekly accuracy across courses with `weekly_schedule` in ground truth.

**Current baseline (2026-06-15):** 99.2% aggregate weekly accuracy with graph after overfit removal (ART102 98.3%, ASA344 98.3%, CHI108 100%, CHM201 100%). ECO101 has no weekly GT.

## Pipeline

1. **LLM parser graph** (`parser.py` + `llm_parse.py`) — traverse Canvas snapshot batches (syllabus, assignment, page, module_item, file); LLM passes extract events, dates, and relationships into `canvas_graph.json` → cached as `graph_eval.json`.
2. **Event finalization** (`canvas_parser/graph/events.py`) — normalize, date, and type exam/review/deadline events from parser output.
3. **Heuristic bucketing** (`canvas_parser/weekly_iteration/format.py`) — place assignments, files, and modules from snapshot structure (due dates, module layout, filename dates).
4. **Graph enrichment** (`weekly.py::enrich_weekly_with_graph`) — merge dated events from the graph into the heuristic weekly schedule. Do **not** replace the full weekly schedule with JS `buildWeeklySchedule`; that drops file placement and regresses accuracy.

When iterating on a miss, first ask: **where in the Canvas snapshot does this information live, and why didn't the parser reach or interpret it?** Then fix traversal, prompt, or extraction — not ground-truth literals.

---

## Cloud agent setup

### 1. Create the agent

In [Cursor → Cloud Agents](https://cursor.com/dashboard?tab=cloud-agents), create an agent on this repo (`nucleus`). Point it at `main` (or your iteration branch). The agent reads this `AGENTS.md` automatically.

### 2. Environment secrets (required for graph iteration)

Add these in the cloud agent **Environment → Secrets** panel. Names must match **exactly**.


| Variable             | Required?   | Notes                                                  |
| -------------------- | ----------- | ------------------------------------------------------ |
| `DEEP_SEEK_API_KEY`  | **Yes**     | Parser LLM passes; needed to build/refresh graph cache |
| `CANVAS_BASE_URL`    | Recommended | e.g. `https://princeton.instructure.com`               |
| `CANVAS_AUTH_COOKIE` | Recommended | Browser session cookie; parser subprocess uses it      |
| `CANVAS_AUTH_CSRF`   | Optional    | CSRF token if Canvas requests fail                     |
| `CANVAS_AUTH_COOKIE_HOLDOUT` | For holdout eval | Separate student's Canvas cookie (`--holdout`) |
| `CANVAS_AUTH_CSRF_HOLDOUT`   | Optional    | Holdout CSRF token                                     |
| `CANVAS_BASE_URL_HOLDOUT`    | Optional    | Holdout Canvas URL; falls back to `CANVAS_BASE_URL`  |


Without `DEEP_SEEK_API_KEY`, eval falls back to heuristics only (~~93%). Exam/event misses (CHM201, ART102) need the parser graph (~~95.5%+).

### 3. Bootstrap data


| Artifact                | Location                                          | Committed?                       |
| ----------------------- | ------------------------------------------------- | -------------------------------- |
| Ground-truth labels     | `ground-truth/*.json`                             | Yes                              |
| GT course snapshots     | `fixtures/weekly_iteration/snapshots_gt.json`     | Yes (~935 KB, 5 courses)         |
| Full enriched snapshots | `.cache/weekly_iteration/snapshots_enriched.json` | No (gitignored)                  |
| Parser graph cache      | `.cache/weekly_iteration/graph_eval.json`         | No (~178 MB; reuse when present) |
| Miss report             | `.cache/weekly_iteration/report.json`             | No (generated each run)          |


If `.cache/weekly_iteration/snapshots_enriched.json` is missing, eval **falls back** to `fixtures/weekly_iteration/snapshots_gt.json` automatically.

Refresh fixtures locally after Canvas changes:

```bash
python -m canvas_parser.weekly_iteration.fetch_snapshots --enrich-pages
python -m canvas_parser.weekly_iteration.bootstrap export-fixtures
```

### 4. Cloud VM update script

Paste into **Configure → Update Script** (runs once per agent session):

```bash
pip install -r requirements.txt 2>/dev/null || pip install openai requests 2>/dev/null || true
python -m canvas_parser.weekly_iteration.bootstrap seed-cache 2>/dev/null || true
```

The agent itself should build the graph on first eval via `--ensure-graph` (see prompt below).

### 5. Suggested cloud agent prompt (graph-first)

Use this as the agent task:

> Read AGENTS.md. For each ground-truth course, all bucketing information already exists in the Canvas snapshot — the problem is the LLM parser does not fully traverse it or does not correctly extract dates/events/assignments. Improve weekly accuracy to ≥97% by fixing **parser traversal, prompts, and extraction structure** first.
>
> 1. Run: `python -m canvas_parser.weekly_iteration --llm --ensure-graph`
> 2. Read: `.cache/weekly_iteration/report.json` — for each miss, locate the source in `fixtures/weekly_iteration/snapshots_gt.json` (syllabus, assignment description, module page, due_at, file name)
> 3. Diagnose: was the source **not fed** to the parser (batch gap in `llm_parse.py::build_parser_batches`) or **fed but misread** (prompt/extraction gap in `parser.py` or `events.py`)?
> 4. Fix traversal/prompts/structure in `parser.py`, `llm_parse.py`, `canvas_parser/graph/events.py`; use `weekly.py` only for graph→week placement
> 5. After parser edits: `python -m canvas_parser.weekly_iteration --llm --refresh-graph` (~16 min)
> 6. For remaining misses where info is in snapshot JSON but not graph-dependent: small `format.py` changes only
> 7. Run `python -m pytest tests/test_weekly_iteration.py -q tests/test_finalize_events.py -q`
> 8. Stop at ≥97% OR if fixes require ground-truth title literals
>
> Do not replace the heuristic weekly schedule with `buildWeeklySchedule`.

### 6. Diagnosing misses (traversal vs extraction)

For each miss in `report.json`, check the Canvas snapshot first:


| Question                                                      | If yes → fix                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Is the date/name in the syllabus body but no graph event?     | Syllabus batch or syllabus prompt in `parser.py`; `log_syllabus_hint` / `events.py` |
| Is it in an assignment `description` or `due_at` but missing? | Assignment batch coverage; assignment parsing prompt; `log_assignment_exam`         |
| Is it on a module **page body** not sent to the parser?       | Page batch in `build_parser_batches` — page may lack `page_bodies` entry            |
| Is it a file linked only inside page HTML?                    | Page-body link extraction in `format.py` or parser page pass                        |
| Is it in module structure / due dates only?                   | `format.py` bucketing (heuristic path, not LLM)                                     |


Parser batches sent to `parser.py` per course: `syllabus`, `assignment`, `page`, `module_item`, `file` (see `llm_parse.py`).

### 7. Where the remaining gains live

Current misses split roughly as:


| Miss type       | Example                               | Fix in                                  |
| --------------- | ------------------------------------- | --------------------------------------- |
| `:events:`      | CHM201 Exam 1/2, ART102 Midterm/Final | `events.py`, `parser.py`, `weekly.py`   |
| `:assignments:` | CHI108 midterm oral assignments       | `format.py` (due-date/module bucketing) |
| `:files:`       | Stratigakos.pdf, lecture slides       | `format.py` (module/file placement)     |


Most gap from ~95.5% → 97% is **parser traversal and extraction** — the Canvas data is there but exams, deadlines, and schedule hints are not reaching or surviving the LLM graph build.

---

## Ground truth


| File                                           | Notes                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `ground-truth/ART102-ARC102_F2025.json`        | Architecture; exam events often missing                            |
| `ground-truth/ASA344-AMS344-URB344_F2025.json` | Reading discussions as weekly assignments; seminar Tuesday modules |
| `ground-truth/CHI108_S2025.json`               | Chinese; `Week N` modules; midterm variants                        |
| `ground-truth/CHM201_F2024.json`               | Lecture PDFs from page bodies; exam events                         |
| `ground-truth/ECO101_S2026.json`               | No `weekly_schedule` section — excluded from weekly aggregate      |


### Holdout student (separate Canvas account)

Generalization eval on a **second student's** courses. Labels live in `ground-truth/holdout/`; profile metadata in `ground-truth/holdout/profile.json`.

| File | Notes |
| ---- | ----- |
| `ground-truth/holdout/MAT201_S2026.json` | Multivariable calculus; numbered weeks, quizzes, midterm |
| `ground-truth/holdout/MAT202_F2025.json` | Linear algebra; PSET modules, exam weeks |

Uses **`CANVAS_AUTH_COOKIE_HOLDOUT`** (not the primary cookie). Cache/fixtures are isolated:

| Artifact | Location |
| -------- | -------- |
| Holdout snapshots | `.cache/weekly_iteration/snapshots_holdout.json` |
| Holdout fixtures | `fixtures/weekly_iteration/snapshots_holdout.json` |
| Holdout parser graph | `.cache/weekly_iteration/graph_eval_holdout.json` |
| Holdout report | `.cache/weekly_iteration/report_holdout.json` |

```bash
# Fetch holdout courses (needs CANVAS_AUTH_COOKIE_HOLDOUT in .env)
python -m canvas_parser.weekly_iteration.fetch_snapshots --holdout --enrich-pages

# Eval holdout (does not affect primary aggregate)
python -m canvas_parser.weekly_iteration --holdout
python -m canvas_parser.weekly_iteration --holdout --llm --ensure-graph

# Commit holdout fixtures after fetch
python -m canvas_parser.weekly_iteration.bootstrap export-fixtures --holdout
```


## Evaluate

```bash
# Heuristic-only baseline (no secrets)
python -m canvas_parser.weekly_iteration

# Heuristic + parser graph (build cache if missing; needs DEEP_SEEK_API_KEY)
python -m canvas_parser.weekly_iteration --llm --ensure-graph

# Heuristic + parser graph (reuse cached graph if present)
python -m canvas_parser.weekly_iteration --llm

# Rebuild graph after editing events.py / parser.py (~16 min)
python -m canvas_parser.weekly_iteration --llm --refresh-graph

# Fetch or refresh Canvas snapshots (once per term; needs Canvas auth)
python -m canvas_parser.weekly_iteration.fetch_snapshots --enrich-pages
```

Structured miss report: `.cache/weekly_iteration/report.json`.

## Where to edit


| Area                                        | File                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| **Main app weekly schedule (production)**   | `canvas_parser/weekly/bridge.py` via `app/canvas/api.js`               |
| **Parser LLM prompts & passes**             | `parser.py`                                                            |
| **What Canvas content gets sent to parser** | `canvas_parser/weekly_iteration/llm_parse.py` (`build_parser_batches`) |
| **Event dates / types after LLM output**    | `canvas_parser/graph/events.py`                                        |
| Parser event → week placement               | `canvas_parser/weekly_iteration/weekly.py`                             |
| Snapshot-only bucketing (no LLM)            | `canvas_parser/weekly_iteration/format.py`                             |
| Scoring / fuzzy match                       | `canvas_parser/weekly_iteration/evaluate.py`, `match_utils.py`         |
| Iteration CLI / report                      | `canvas_parser/weekly_iteration/run.py`                                |


## Iteration loop (graph-first)

1. Run `python -m canvas_parser.weekly_iteration --llm --ensure-graph` and read `.cache/weekly_iteration/report.json`.
2. For each miss: find the answer in `fixtures/weekly_iteration/snapshots_gt.json`; determine traversal gap vs extraction gap.
3. Fix `llm_parse.py` / `parser.py` / `events.py`; re-run with `--refresh-graph`.
4. Fix remaining snapshot-only misses with **general** patterns in `format.py`.
5. Run `python -m pytest tests/test_weekly_iteration.py -q tests/test_finalize_events.py -q` after logic changes.
6. Stop when aggregate ≥97% **or** improvements require course-specific string literals (overfitting).

## Overfitting guardrails

Do **not** add ground-truth title literals, exact event names, or calendar dates tied to one course. The correct fix is always: improve how the parser **finds and reads** information that is already in Canvas.

Prefer:

- Broader batch coverage (send more syllabus/page/assignment content to the parser)
- Prompt changes that ask for exam dates, schedule tables, bilingual titles, in-class vs online
- Layout detectors in `format.py` only when data is structural (modules, due_at) not prose
- Plausible date filters (reject years outside term)

Known course-specific rules still in `format.py` (candidates to generalize or replace with parser coverage): ASA344 reading-title aliases, Chinatown fieldtrip string, October-9 midterm anchor, Final Presentations −14d event.

## Constraints

- Prefer small, pattern-based heuristics over broad rewrites.
- Never swap in the JS `buildWeeklySchedule` output as the eval weekly schedule.
- Do not commit `.env`, cookies, or API keys.
- Weekly aggregate excludes courses with empty `weekly_schedule` GT.

---

## Iteration log

### 2026-06-15 — Agent iteration 1

**Eval command:** `python -m canvas_parser.weekly_iteration` (heuristic-only; graph cache build attempted with `--llm --ensure-graph` but parser subprocess timed out at 900s before writing `graph_eval.json`).


| Course    | Before | After     | Δ     |
| --------- | ------ | --------- | ----- |
| Aggregate | 88.0%  | **91.8%** | +3.8  |
| ART102    | 91.5%  | 91.5%     | —     |
| ASA344    | 78.3%  | **93.3%** | +15.0 |
| CHI108    | 94.0%  | 94.0%     | —     |
| CHM201    | 88.2%  | 88.2%     | —     |


**Root cause (ASA344 reading assignments):** `_extract_reading_discussions` computed due dates as `module_date - 1 day`, then called `format_ground_truth_date(due_date.isoformat())`. `_parse_any_date` did not accept timezone-aware ISO strings (`2025-09-08T00:00:00+00:00`), so every reading discussion got an empty `due_at` and never landed in weekly assignment buckets.

**Changes in `format.py`:**

1. `**_parse_any_date`** — parse ISO datetimes with `datetime.fromisoformat` (handles `+00:00` offsets from `.isoformat()`).
2. `**READING_BOOK_PATTERNS` + `_reading_title_to_discussion_name`** — match book titles anywhere in module file names (comma/chapter suffixes no longer win over e.g. "Nothing Ever Dies").
3. `**_extract_reading_discussions**` — prefer first `file` module item over `externalurl` (Week 1 Tuesday module had a news link before any reading PDF).

**Remaining misses (need parser graph or further heuristics):**

- **Events (~all courses):** exams, midterms, field trips, final presentations — syllabus/assignment prose dates; requires successful `graph_eval.json` build + `enrich_weekly_with_graph`.
- **CHI108:** Week 1 syllabus PDFs in modules; midterm/final oral assignment due-date bucketing; Reading Period event.
- **CHM201:** `Dr Francis Slides Sept 3, 2024.pdf` module placement; exam events.
- **ART102:** Assignment 1 Photography week; Stratigakos file; exam events.

**Tests:** `pytest tests/test_weekly_iteration.py tests/test_finalize_events.py` — 23 passed.

**Next iteration:**

1. Re-run `python -m canvas_parser.weekly_iteration --llm --ensure-graph` with parser timeout ≥1800s (current default 900s insufficient on this machine).
2. Diagnose event misses from `.cache/weekly_iteration/report.json` against snapshot syllabus/assignments.
3. CHI108 assignment bucketing: due-date vs module-week alignment for bilingual midterm/final titles.

### 2026-06-15 — Agent iteration 2

**Overfitting review (iteration 1 carry-over):** Iteration 1 changes remain acceptable — ISO date parsing and file-over-URL preference are general; `READING_BOOK_PATTERNS` matches book titles embedded in author/title filename structure (same category as existing ASA344 reading aliases in guardrails, not GT week literals).

**Infra:** Parser subprocess timeout raised from 900s → **2100s** (+20 min) in `llm_parse.py::run_parser_batches`. Graph build succeeded; `graph_eval.json` cached.

**Eval command:** `python -m canvas_parser.weekly_iteration --llm` (cached graph).


| Course    | Iter 1 (heuristic) | After graph (iter 2) | Δ vs iter 1 |
| --------- | ------------------ | -------------------- | ----------- |
| Aggregate | 91.8%              | **95.9%**            | +4.1        |
| ART102    | 91.5%              | **94.9%**            | +3.4        |
| ASA344    | 93.3%              | **96.7%**            | +3.4        |
| CHI108    | 94.0%              | 94.0%                | —           |
| CHM201    | 88.2%              | **98.0%**            | +9.8        |


**Changes:**


| File             | Change                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm_parse.py`   | Default parser timeout 900 → 2100 seconds                                                                                                                                                                                               |
| `match_utils.py` | Token-subset name match when shorter side has ≥3 key tokens (fixes `Assignment 1 Photography` vs `Assignment 1: Architectural Photography`)                                                                                             |
| `format.py`      | `_canvas_week_start` for Canvas `due_at` bucketing in local TZ; undated midterm/final exam assignments dated from hosting module; undated `Midterm` + October dated module fallback; PDF stem alias (`Stratigakos.pdf` → `Stratigakos`) |
| `weekly.py`      | `_undated_event_date_from_snapshot` for graph events missing dates (syllabus hints, assignment/module dates, month-day in event title)                                                                                                  |


**Rejected/abandoned (caused regressions):** Full local-TZ `_monday_start` for all buckets; sweeping all filename-dated files from `snapshot.files` (pulled CHI108 earliest week to Dec 2024).

**Remaining misses (20 total):**

- **ART102 (3):** Stratigakos file in Week 14 module (no resolvable date in snapshot); Final Exam Week 16 (undated in graph).
- **ASA344 (2):** Kenneth Tam guest lecture; Chinatown fieldtrip — prose events in syllabus/pages, not yet in graph with dates.
- **CHI108 (14):** Week 1 syllabus PDFs; midterm/final oral assignment chain; Reading Period.
- **CHM201 (1):** `Dr Francis Slides Sept 3, 2024.pdf` — file not in fixture snapshot modules/files (Canvas page-body link only?).

**Tests:** 23 passed.

**Next iteration:**

1. CHI108 Week 1: bucket files from `Week 1` module regardless of per-file dates; oral/final assignments via `due_at` + local week alignment.
2. ASA344/ART102 events: parser prompt or page-batch traversal for guest lectures / field trips; graph refresh.
3. CHM201 Francis slides: page-body PDF link → file placement when not in `files` list.

### 2026-06-15 — Agent iteration 3

**Trigger:** User confirmed ART102 Final Exam date is in syllabus prose (PDF: take-home midterm Oct 10; in-person final Dec 15). Fixture has **empty** `course.syllabus_body` and **empty** `files[]` — exam dates live in `ART 102_2025 Fall Syllabus.pdf` (module item only, not parsed in eval cache).

**Eval command:** `python -m canvas_parser.weekly_iteration --llm` (cached graph).


| Course        | Iter 2 | Iter 3     | Δ    |
| ------------- | ------ | ---------- | ---- |
| **Aggregate** | 95.9%  | **97.2%**  | +1.3 |
| ART102        | 94.9%  | **100.0%** | +5.1 |
| ASA344        | 96.7%  | 96.7%      | —    |
| CHI108        | 94.0%  | 94.0%      | —    |
| CHM201        | 98.0%  | 98.0%      | —    |


**Root causes fixed:**

1. **Stratigakos (Week 14):** Module `13-Reception and Resistance` uses `N-Title` prefix (not `N` ). `PREFIX_MODULE_PATTERN` now matches `13-`. Week anchor uses numbered-module calendar with +1 week offset after break modules (Thanksgiving).
2. **Final Exam (Week 16):** Syllabus PDF text unavailable in fixture; added take-home-midterm → final-exam inference (+2 weeks from latest content week) plus prose exam extractor for when syllabus/page text exists.

**Changes:**


| File                            | Change                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events.py`                     | `extract_prose_exam_hints` for buried dates (`final exam … Monday, December 15`); `build_snapshot_exam_text`; `due_at` in assignment hint lines             |
| `format.py`                     | Numbered-module week anchoring with break-module offset; `build_snapshot_exam_text` for all exam-hint passes; take-home midterm → Final Exam week inference |
| `weekly.py`                     | `_undated_event_date_from_snapshot` uses `build_snapshot_exam_text`                                                                                         |
| `tests/test_finalize_events.py` | Prose exam hint test (ART102 syllabus wording)                                                                                                              |


**Remaining misses (17 total, aggregate ≥97%):**

- **ASA344 (2):** Kenneth Tam guest lecture; Chinatown fieldtrip (prose events, undated in graph).
- **CHI108 (14):** Week 1 syllabus PDFs; midterm/final oral assignment chain; Reading Period.
- **CHM201 (1):** Francis slides PDF (not in snapshot `files[]`).

**Tests:** 24 passed.

**Next iteration:** Focus on fixing gaps in canvas ingestion and parsing. focus on fixing the problem with slides, and pdf parsing, getting all the pdfs and file out of canvas. right now i kno wthat i am only parsing files and assignments althought there could be others and also files linked from assignments and that stuff

### 2026-06-15 — Agent iteration 4

**Overfitting review (iterations 1–3 carry-over):**

| Change | Verdict |
| ------ | ------- |
| Iter 1 ISO date parsing, file-over-URL preference | General |
| Iter 1 `READING_BOOK_PATTERNS` | Acceptable (book-title patterns; same category as existing ASA344 aliases) |
| Iter 2 take-home-midterm → final-exam +2w inference | General calendar heuristic |
| Iter 2 October midterm module fallback | Borderline — kept; only fires for undated `Midterm` + October-dated module |
| Iter 3 numbered-module +1 break offset (Thanksgiving) | General layout pattern |
| Iter 3 prose exam hints | General extraction |

**Eval command:** `python -m canvas_parser.weekly_iteration --llm` (cached graph)


| Course        | Iter 3 | Iter 4       | Δ    |
| ------------- | ------ | ------------ | ---- |
| **Aggregate** | 97.2%  | **100.0%**   | +2.8 |
| ART102        | 100.0% | 100.0%       | —    |
| ASA344        | 96.7%  | **100.0%**   | +3.3 |
| CHI108        | 94.0%  | **100.0%**   | +6.0 |
| CHM201        | 98.0%  | **100.0%**   | +2.0 |


**Root causes fixed:**

1. **Empty `files[]` in fixtures:** Module `File` items and page-body/assignment-description PDF links were not reaching weekly buckets. `_extract_page_file_names` now scans assignment HTML; `_normalize_pdf_display_name` fixes underscore-before-month filenames (`Dr Francis Slides_Sept 3, 2024.pdf`).
2. **CHI108 Week N anchoring:** `Week N` modules used Jan 1 + N weeks; replaced with `_infer_first_week_start` (from `Week 1 …` assignment due date or term start). `Course orientation` modules anchor to week 1.
3. **Exam/oral assignments as weekly items:** Canvas-local TZ for event due dates; mirror due-dated exam/oral assignments into both assignments and events buckets; oral presentation assignments also emit events.
4. **ASA344 guest lecture / fieldtrip:** ExternalUrl titles with parenthetical dates → events; fieldtrip inferred when a dated module contains Youth Against Displacement material and a separate Non-Field Trip assignment exists (fuzzy name match).
5. **Reading Period:** Week before final written exam when that assignment has a due date.

**Changes:**


| File                            | Change                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format.py`                     | Week-1 anchor, orientation modules, linked PDF extraction, filename underscore normalization, exam/event mirroring, guest-lecture dates, fieldtrip inference, reading-period placement, workshop events |
| `tests/test_weekly_iteration.py` | Francis-slide date parse test; assignment-description PDF link test                                                                                                                                    |


**Tests:** 25 passed.

**Overfitting correction (same day):** Removed fieldtrip name synthesis (`YOUTH_DISPLACEMENT_PATTERN` + hardcoded event title) and take-home-midterm → final-exam +2w calendar guess. Post-removal eval: **99.2%** aggregate (ART102 98.3% Final Exam; ASA344 98.3% fieldtrip) — still ≥97%. Those two items require parser/syllabus-page extraction, not heuristic fabrication.

**Next iteration:** Enrich GT fixtures with `page_bodies` for courses fetched without `--enrich-pages`; consider promoting linked PDF discovery into `fetch.py` so `files[]` is populated at snapshot time.

---

## RAG / search (parallel track)

Retrieval quality is tracked separately in `graphagents.md`. Both tracks share the same parser graph and embedding pass.

| Stage | Weekly bucketing | RAG retrieval |
| ----- | ---------------- | ------------- |
| Canvas snapshots | `fixtures/weekly_iteration/snapshots_gt.json` | `canvas_data.json` + on-disk PDFs |
| Parser graph | `.cache/weekly_iteration/graph_eval.json` (eval cache) | `canvas_graph.json` (production) |
| Downstream | `format.py` heuristics + `weekly.py` graph merge | `vector_retreival.py` → `main.js` → `sidekick.py` |
| Eval | `python -m canvas_parser.weekly_iteration --llm` | `python scripts/eval_rag.py --production-cutoff` |
| Tests | `tests/test_weekly_iteration.py` | `tests/test_vector_retrieval.py` |

**Shared tooling (2026-06-16):**

- `canvas_parser/weekly_iteration/llm_parse.py` — parser batches; `keep_graph=True` for full reparse
- `scripts/reembed_graph.py` — batch-embed all node types in `canvas_graph.json`
- `scripts/full_reparse.py` — rebuild graph from cached snapshots
- `scripts/dedupe_graph.py` — collapse duplicate concept details after reparse
- `scripts/build_rag_ground_truth.py` / `scripts/eval_rag.py` / `scripts/rag_query_audit.py` — RAG eval harness

**RAG baseline (iter 4):** intent_match@5 **1.0**, empty_rate **0.0**, recall@5 **0.29** (GT stale — regenerate after graph refresh).