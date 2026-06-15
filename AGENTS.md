# Weekly schedule iteration (cloud agent)

Improve **weekly schedule accuracy** against annotated courses in `ground-truth/` using a **hybrid pipeline**:

1. **Deterministic heuristics** in `canvas_parser/weekly_iteration/format.py` — file/assignment/event bucketing from Canvas snapshots (modules, due dates, filename dates, syllabus exam hints, page-body PDF links).
2. **Parser graph enrichment** via `parser.py` — only adds **missing dated events** into the heuristic weekly schedule (`canvas_parser/weekly_iteration/weekly.py::enrich_weekly_with_graph`). Do **not** replace the full weekly schedule with JS `buildWeeklySchedule`; that drops file placement and regresses accuracy.

**Target:** ≥97% aggregate weekly accuracy across courses with `weekly_schedule` in ground truth.

**Current baseline (2026-06-13):** ~95.5% aggregate (ART102 92%, ASA344 97%, CHI108 96%, CHM201 98%). ECO101 has no weekly GT.

---

## Cloud agent setup

### 1. Create the agent

In [Cursor → Cloud Agents](https://cursor.com/dashboard?tab=cloud-agents), create an agent on this repo (`nucleus`). Point it at `main` (or your iteration branch). The agent reads this `AGENTS.md` automatically.

### 2. Environment secrets

Add these in the cloud agent **Environment** panel (or repo `.env` locally). Never commit values.

| Variable | Required for | Notes |
|----------|--------------|-------|
| `CANVAS_BASE_URL` | Snapshot fetch | e.g. `https://princeton.instructure.com` |
| `CANVAS_AUTH_COOKIE` | Snapshot fetch, `--refresh-graph` | Browser session cookie from Canvas |
| `CANVAS_AUTH_CSRF` | Snapshot fetch (optional) | CSRF token if Canvas requires it |
| `DEEP_SEEK_API_KEY` | `--refresh-graph` only | Parser LLM passes; not needed for heuristic + cached graph |

**Default iteration** (`--llm` without `--refresh-graph`) needs **no secrets** — it uses committed fixtures and an optional cached parser graph. If the graph cache is absent, `--llm` logs a warning and evaluates **heuristics only** (~93% baseline); pass `--refresh-graph` locally to rebuild the cache, then copy `.cache/weekly_iteration/graph_eval.json` into the cloud environment if you want the full ~95.5% hybrid baseline.

### 3. Bootstrap data

| Artifact | Location | Committed? |
|----------|----------|------------|
| Ground-truth labels | `ground-truth/*.json` | Yes |
| GT course snapshots | `fixtures/weekly_iteration/snapshots_gt.json` | Yes (~935 KB, 5 courses) |
| Full enriched snapshots | `.cache/weekly_iteration/snapshots_enriched.json` | No (gitignored) |
| Parser graph cache | `.cache/weekly_iteration/graph_eval.json` | No (~178 MB; reuse when present) |
| Miss report | `.cache/weekly_iteration/report.json` | No (generated each run) |

If `.cache/weekly_iteration/snapshots_enriched.json` is missing, eval **falls back** to `fixtures/weekly_iteration/snapshots_gt.json` automatically.

Refresh fixtures locally after Canvas changes:

```bash
python -m canvas_parser.weekly_iteration.fetch_snapshots --enrich-pages
python -m canvas_parser.weekly_iteration.bootstrap export-fixtures
```

### 4. Suggested cloud agent prompt

Use this (or similar) as the agent task:

> Iterate on weekly module bucketing and parser event enrichment until aggregate weekly accuracy ≥97%. Run `python -m canvas_parser.weekly_iteration --llm`, read `.cache/weekly_iteration/report.json`, fix the highest-impact misses with **general** heuristics in `format.py` / `weekly.py` / `events.py`, re-run eval, and run `python -m pytest tests/test_weekly_iteration.py -q`. Stop if fixes require ground-truth title literals. Do not replace the heuristic weekly schedule with `buildWeeklySchedule`.

---

## Ground truth

| File | Notes |
|------|-------|
| `ground-truth/ART102-ARC102_F2025.json` | Architecture; exam events often missing |
| `ground-truth/ASA344-AMS344-URB344_F2025.json` | Reading discussions as weekly assignments; seminar Tuesday modules |
| `ground-truth/CHI108_S2025.json` | Chinese; `Week N` modules; midterm variants |
| `ground-truth/CHM201_F2024.json` | Lecture PDFs from page bodies; exam events |
| `ground-truth/ECO101_S2026.json` | No `weekly_schedule` section — excluded from weekly aggregate |

## Evaluate

```bash
# Heuristic-only baseline (no secrets)
python -m canvas_parser.weekly_iteration

# Heuristic + parser event enrichment (reuse cached graph if present)
python -m canvas_parser.weekly_iteration --llm

# Full re-parse through parser.py (~16 min; needs Canvas auth + DEEP_SEEK_API_KEY)
python -m canvas_parser.weekly_iteration --llm --refresh-graph

# Fetch or refresh Canvas snapshots (once per term; needs Canvas auth)
python -m canvas_parser.weekly_iteration.fetch_snapshots --enrich-pages
```

Structured miss report: `.cache/weekly_iteration/report.json`.

## Where to edit

| Area | File |
|------|------|
| Weekly bucketing heuristics | `canvas_parser/weekly_iteration/format.py` |
| Parser event → week placement | `canvas_parser/weekly_iteration/weekly.py` |
| Event dates / exam detection in graph | `canvas_parser/graph/events.py`, `parser.py` |
| Scoring / fuzzy match | `canvas_parser/weekly_iteration/evaluate.py`, `match_utils.py` |
| Iteration CLI / report | `canvas_parser/weekly_iteration/run.py` |

## Iteration loop

1. Run `python -m canvas_parser.weekly_iteration --llm` and read `.cache/weekly_iteration/report.json`.
2. Fix highest-impact misses with **general** patterns (module date layouts, due-date bucketing, exam vs assignment routing).
3. Re-run; ensure ECO101 non-weekly sections stay stable if extended.
4. Run `python -m pytest tests/test_weekly_iteration.py -q` after logic changes.
5. Stop when aggregate ≥97% **or** improvements require course-specific string literals (overfitting).

## Overfitting guardrails

Do **not** add ground-truth title literals, exact event names, or calendar dates tied to one course. Prefer:

- Layout detectors (`Week N` modules, `Tuesday, Month Day` modules, `Course orientation`)
- Submission-type routing (online essay vs in-class exam)
- Plausible date filters (reject years outside term)
- Syllabus / assignment `due_at` when present

Known course-specific rules still in `format.py` (candidates to generalize): ASA344 reading-title aliases, Chinatown fieldtrip string, October-9 midterm anchor, Final Presentations −14d event.

## Constraints

- Prefer small, pattern-based heuristics over broad rewrites.
- Never swap in the JS `buildWeeklySchedule` output as the eval weekly schedule.
- Do not commit `.env`, cookies, or API keys.
- Weekly aggregate excludes courses with empty `weekly_schedule` GT.

## Cursor Cloud specific instructions

Dependencies are installed by the startup update script (`npm install` for the Electron app + `pip install --user` for the Python pipeline: `pytest PyMuPDF openai anthropic ollama python-dotenv python-docx python-pptx numpy requests`). There is no Python manifest in the repo, so that explicit list is the source of truth. The `pytest`/`dotenv`/`pymupdf` console scripts land in `~/.local/bin`, which is not on `PATH`; invoke tools as modules (e.g. `python3 -m pytest`).

Non-obvious caveats:

- **Python tests must run with `-s`**: `python3 -m pytest tests/ -q -s`. `parser.py` calls `sys.stdin.reconfigure(...)` at import time; under pytest's default captured stdin this raises `AttributeError: 'DontReadFromInput' object has no attribute 'reconfigure'` and aborts collection of any test that imports `parser` (e.g. `tests/test_normalize_date.py`). `-s` (no capture) keeps the real stdin and all tests pass. JS tests run normally with `npm test` (`node --test`).
- **Weekly eval exit code**: `python -m canvas_parser.weekly_iteration [--llm]` exits `1` whenever aggregate accuracy is below the `--target` (default 0.97). That is the pass/fail signal, not a crash. Report is written to `.cache/weekly_iteration/report.json`. Without a `.cache/weekly_iteration/graph_eval.json`, `--llm` logs a warning and falls back to heuristics-only.
- **Running the Electron app on Linux**: the `package.json` `start` scripts use Windows `set` syntax and do not work as-is. Launch directly with `DISPLAY=:1 NUCLEUS_THEME=default ./node_modules/.bin/electron . --no-sandbox` (a display is available at `:1`; theme is `default`/`dark`/`white`).
- **`python` vs `python3`**: `main.js` spawns child processes via `spawn('python', ...)` (`vector_retreival.py`, `sidekick.py`). The system only ships `python3`, so a `python` -> `python3` symlink is required or the app dies with a fatal `spawn python ENOENT` uncaught exception on startup. A symlink at `/usr/local/bin/python` (on `PATH`) satisfies this.
- **Optional integrations degrade gracefully**: with no secrets set (`OPENAI_API_KEY`, `DEEP_SEEK_API_KEY`, `ANTHROPIC_API_KEY`, `BRAVE_API_KEY`, Canvas auth, Gmail OAuth, local Ollama), the eval/tests still run, and the GUI still opens — the `vector_retreival.py`/`sidekick.py` child processes just error out and close while the main window stays up. The embedded browser (Canvas/Synapse/Mail tiles) loads real external sites without secrets.
- The `eval:context` / `test:context` scripts also need committed runtime artifacts (`canvas_graph.json`, `canvas_data.json`) that are gitignored; their JS portions pass but the Python portion exits early with `Missing canvas_graph.json` when those files are absent. This is expected, not a setup failure.
