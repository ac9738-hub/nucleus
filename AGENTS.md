# Weekly schedule iteration (cloud agent)

Improve **weekly schedule accuracy** against annotated courses in `ground-truth/` using a **hybrid pipeline**:

1. **Deterministic heuristics** in `canvas_parser/weekly_iteration/format.py` — file/assignment/event bucketing from Canvas snapshots (modules, due dates, filename dates, syllabus exam hints, page-body PDF links).
2. **Parser graph enrichment** via `parser.py` — only adds **missing dated events** into the heuristic weekly schedule (`canvas_parser/weekly_iteration/weekly.py::enrich_weekly_with_graph`). Do **not** replace the full weekly schedule with JS `buildWeeklySchedule`; that drops file placement and regresses accuracy.

## Ground truth

| File | Notes |
|------|-------|
| `ground-truth/ART102-ARC102_F2025.json` | Architecture; exam events often missing |
| `ground-truth/ASA344-AMS344-URB344_F2025.json` | Reading discussions as weekly assignments; weakest course (~78%) |
| `ground-truth/CHI108_S2025.json` | Chinese; module-dated files; midterm variants |
| `ground-truth/CHM201_F2024.json` | Lecture PDFs from page bodies; exam events |
| `ground-truth/ECO101_S2026.json` | Already 100% — regression guard |

Cached Canvas input: `.cache/weekly_iteration/snapshots_enriched.json`. Parser graph cache: `.cache/weekly_iteration/graph_eval.json`.

## Evaluate

```bash
# Heuristic-only baseline (~88% as of last run)
python -m canvas_parser.weekly_iteration

# Heuristic + parser event enrichment (reuse cached graph)
python -m canvas_parser.weekly_iteration --llm

# Full re-parse through parser.py (~16 min; needs .env Canvas auth + DEEP_SEEK_API_KEY)
python -m canvas_parser.weekly_iteration --llm --refresh-graph

# Fetch or refresh Canvas snapshots (once per term)
python -m canvas_parser.weekly_iteration.fetch_snapshots --enrich-pages
```

Structured miss report: `.cache/weekly_iteration/report.json`.

Target: **≥90% aggregate weekly schedule accuracy** across all five ground-truth courses.

## Where to edit

| Area | File |
|------|------|
| Weekly bucketing heuristics | `canvas_parser/weekly_iteration/format.py` (`_build_weekly_schedule`, `_resolve_item_date`, `_extract_reading_discussions`, `_is_course_level_event`) |
| Parser event → week placement | `canvas_parser/weekly_iteration/weekly.py` |
| Event dates / exam detection in graph | `canvas_parser/graph/events.py`, `parser.py` finalize passes |
| Scoring / fuzzy match | `canvas_parser/weekly_iteration/evaluate.py`, `match_utils.py` |
| Iteration CLI / report | `canvas_parser/weekly_iteration/run.py` |

## Iteration loop

1. Run `python -m canvas_parser.weekly_iteration` and read `.cache/weekly_iteration/report.json`.
2. Fix the highest-impact misses (prioritize ASA344, then CHM201/ART102 exam events, then CHI108 edge cases).
3. Re-run evaluation; ensure ECO101 stays at 100%.
4. Run `python -m pytest tests/test_weekly_iteration.py -q` after logic changes.
5. Stop when aggregate ≥90% or no further improvements without overfitting one course.

## Constraints

- Prefer small, course-pattern heuristics over broad rewrites.
- Never swap in the JS `buildWeeklySchedule` output as the eval weekly schedule.
- Do not commit `.env`, cookies, or API keys.
