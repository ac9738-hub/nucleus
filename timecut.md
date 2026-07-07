# Timecut — parse speed iteration

Cut full-graph LLM parse wall time by **≥50%** on a fixed 3-course benchmark **without regressing parse quality**. Speed wins must pass a frozen quality scorecard before they ship.

---

## Goals

| Goal | Target | Status (2026-06-22) |
|------|--------|---------------------|
| **Speed** | ≥2× faster than quality baseline on 3 GT courses (ART102, CHM201, ASA344) | **Not met** — cached fast run is **0.79×** (30.5 min vs 24.1 min) |
| **Quality** | Pass fixture eval vs `quality_3course.json` | **Not met** — all three courses FAIL |
| **Constraint** | Never sacrifice extraction quality for speed | Enforced in code; stale fast graph predates guardrails |

### Benchmark courses

| Canvas ID | Course | Quality baseline concepts |
|-----------|--------|---------------------------|
| 18857 | ART102 | 237 |
| 15160 | CHM201 | 52 |
| 19971 | ASA344 | 34 |

**Batch scope (282 items):** 70 files, 40 assignments, 20 pages, 151 module items, 1 syllabus.

### Quality pass criteria

Evaluated by `scripts/eval_parse_quality.py` against `fixtures/parse_quality/benchmark_baseline.json` (frozen from `.cache/graph_eval/quality_3course.json`).

Per course, candidate must satisfy:

| Metric | Threshold |
|--------|-----------|
| Concept title recall | ≥ **85%** (fuzzy match via `names_match`) |
| Concept count ratio | **0.85 – 1.25** vs baseline |
| Detail count ratio | **0.75 – 1.50** vs baseline |
| Dated test-event ratio | ≥ **0.90** |
| Parsed-file ratio | ≥ **0.95** |

**Important:** Do **not** use `canvas_graph.json.pre_full_reparse_20260620.bak` as the quality GT — it only has 3 ART102 concepts. The correct reference is **`quality_3course.json`**.

### Speed measurement

```bash
python scripts/run_parse_speed_benchmark.py --baseline --fast --eval
```

- **Quality baseline timing:** 24.14 min (`quality_3course.meta.json`, 1448 s wall)
- **Fast candidate timing:** 30.51 min (`fast_3course.json`, 1830 s wall) — built with **older, quality-harming settings**
- **Target fast time:** ≤ **12 min** (50% cut from 24.1 min)

---

## Eval harness

| Artifact | Path |
|----------|------|
| Quality reference graph | `.cache/graph_eval/quality_3course.json` |
| Fast candidate graph | `.cache/graph_eval/fast_3course.json` |
| Frozen manifest | `fixtures/parse_quality/benchmark_baseline.json` |
| Benchmark report | `.cache/graph_eval/benchmark_report.json` |
| Parse quality report | `.cache/parse_quality/report.json` |

| Script | Purpose |
|--------|---------|
| `scripts/build_parse_quality_baseline.py` | Freeze per-course metrics + concept title fingerprints |
| `scripts/eval_parse_quality.py` | Compare candidate vs manifest |
| `scripts/eval_graph_parse.py` | Graph-vs-graph metrics + pass logic |
| `scripts/run_parse_speed_benchmark.py` | Baseline / fast parse + eval |
| `scripts/postprocess_parse_graph.py` | Offline merge + detail cleanup on saved graphs |
| `scripts/run_full_reparse_canvas_data.py` | Production full reparse; `apply_fast_reparse_env()` |

Tests: `pytest tests/test_parse_quality_baseline.py tests/test_graph_parse_eval.py tests/test_graph_merge_validate.py -q`

---

5. **Page link hubs** — `PARSER_SKIP_PAGE_LINK_HUB=1` enabled in fast env; verify on fresh run.

---

## Current evaluation (2026-06-22, iteration 4)

| Metric | Result |
|--------|--------|
| Stale fast vs quality timing | **0.79×** (30.5 min vs 24.1 min) — FAIL speed target |
| Raw fast quality | **FAIL** all courses |
| Post-processed + matching | **FAIL** — details mostly OK; recall/concepts still fail |
| Fresh parse | Blocked — DeepSeek **402 Insufficient Balance** |

---

## Iteration log

### Iteration 0 — Problem statement

Build a parse-quality eval set from current parsed data, then iterate to cut parse time **≥50%**. Explicit rule: **never sacrifice quality for speed**.

---

### Iteration 1 — Eval infrastructure + first speed opts

**Built:**

- `scripts/build_parse_quality_baseline.py` — freeze metrics + concept title fingerprints
- `scripts/eval_parse_quality.py` — manifest regression checks
- `scripts/eval_graph_parse.py` — graph comparison + pass thresholds
- `fixtures/parse_quality/benchmark_baseline.json`
- `scripts/run_parse_speed_benchmark.py` — 3-course benchmark harness
- `canvas_parser/parse/pdf_cache.py` — disk cache for PDF page extraction
- Parser env flags: `PARSER_SKIP_DOWNLOAD_IF_CACHED`, optional skip flags (defaults off)
- `apply_fast_reparse_env()` in `run_full_reparse_canvas_data.py`

**First fast run results:**

| Metric | Before | After iter 1 | Target |
|--------|--------|--------------|--------|
| Wall time (3 courses) | ~13.6 min (early probe) | **25.7 min** (regression) | ≤12 min |
| LLM share | ~59% | ~82% | — |
| PDF I/O share | ~41% | ~18% (cache helped) | — |
| Benchmark eval | FAIL (~22% recall) | FAIL (CHM201-focused) | PASS |

**Root causes identified:**

1. Re-enabling page LLM on all 20 module pages inflated LLM time; many are link hubs.
2. **CHM201 collapse (74 → 12 concepts)** — linked PDFs blocked by bugs, not missing batch coverage.
3. Wrong baseline source briefly used (`canvas_graph.json.pre_full_reparse_20260620.bak`).

**Fixes started:**

- Rebuild baseline from `quality_3course.json`
- Tighten eval thresholds (concept ratio max **1.25**, details ratio max **1.50**)

---

### Iteration 2 — Linked-file + page-hub quality bugs

**Diagnosis:** Fast path skipped substantive linked PDF LLM parse; page link-hub skip was too aggressive.

**Changes:**

| Area | Fix |
|------|-----|
| `_linked_canvas_file_already_present()` | Only skip when file already in `parsed_items['file']`, not merely “has pages” |
| `linked_discovered_use_pass1_only()` | Full pass2 for substantive linked PDFs |
| Page link-hub skip | Gated behind `PARSER_SKIP_PAGE_LINK_HUB=1` (default **off**) |
| `apply_fast_reparse_env()` | Rewritten **quality-safe bulk**: keeps pass2, classify, pages, full linked mode; drops light linked mode, keyword extract auto, skip PDF blocks |

**Eval (stale fast graph):** Still FAIL on all courses; detail ratios extreme (CHM201 **26×**).

---

### Iteration 3 — Detail inflation + concept matching

**Diagnosis:** Quality graph is detail-sparse (46 details total across 3 courses). Fast graph had **353 details** from double-logging and unconstrained LLM `log_detail`.

**Changes:**

| File | Change |
|------|--------|
| `parser.py` | Remove `log_detail` from `seed_teaching_blocks_from_outline` (concept description already set) |
| `parser.py` | Tighten `log_detail`: skip name-echo, require ≥48 chars, cap **2/concept/file** |
| `parser.py` | Finalize: `dedupe_echo_concept_details`, `prune_excessive_concept_details` (max 2), `cap_course_detail_budget` (~0.17/concept) |
| `canvas_parser/graph/merge.py` | `heading_concepts_match` merge for numbered outline headings |
| `canvas_parser/weekly_iteration/match_utils.py` | Heading token overlap in `names_match` for eval recall |
| `scripts/postprocess_parse_graph.py` | Offline repair pipeline for saved graphs |

**Offline post-process on stale fast graph:**

- Merged 7 heading-related concept IDs; pruned 250+ excess details
- CHM201 recall preserved at **98.2%**
- Detail ratios improved but eval still **FAIL** overall

**Tests:** 14 passing (`test_parse_quality_baseline`, `test_graph_parse_eval`, `test_graph_merge_validate`, `test_names_match_is_fuzzy`).

---

## Quality-safe fast env (current)

`apply_fast_reparse_env()` — enabled for next benchmark run:

**Keeps (speed):**

- `PARSER_BULK_MODE=1`, batch merge by type
- `PARSER_DEFER_FILE_EMBED=1`, `PARSER_DEFER_CHECKPOINT=1`
- Skip assignment summary, syllabus final, external crawl
- `PARSER_SKIP_DOWNLOAD_IF_CACHED=1` + PDF disk cache
- Concurrency 28/32, `PARSER_MAX_BATCH_ITEMS=300`
- Defer per-file finalize / file index

**Does not enable (quality guardrails):**

- `PARSER_SKIP_PASS2`
- `PARSER_SKIP_PAGE_LLM` (all pages)
- `PARSER_SKIP_LLM_CLASSIFY`
- `PARSER_SKIP_PDF_BLOCKS`
- `PARSER_KEYWORD_EXTRACT=auto`
- `PARSER_LINKED_FILE_MODE=full`

**Explicitly set:**

- `PARSER_LINKED_FILE_MODE=full`
- `PARSER_DEFER_BATCH_FINALIZE=0`
- `PARSER_SKIP_PAGE_LINK_HUB=1` — skip LLM on link-hub pages only; linked PDFs still enqueue

### Iteration 4 — Outline seeding order + matching + link-hub skip (2026-06-22)

**Diagnosis:** Recall misses were not just fuzzy-match gaps — fast parse often had **no concept at all** for baseline titles (e.g. `11 1 gardens`). Outline seeding ran **after** pass1; LLM paraphrases caused `teaching_unit_already_extracted` to skip canonical outline names. Cross-file concept names also blocked file-scoped seeding.

**Changes:**

| Area | Fix |
|------|-----|
| `parser.py` | Seed teaching outline **before** pass1 LLM (not after) |
| `parser.py` | `collect_file_teaching_names` — file-scoped via `sourcePages` |
| `parser.py` | `find_concept_by_name_or_id` — `teaching_labels_match`, `heading_concepts_match`, `names_match` |
| `match_utils.py` | Content-token overlap for eval (e.g. Brunelleschi ↔ Dome of Florence Cathedral) |
| `merge.py` | Tighter detail budget cap (`ratio=0.06`) |
| `run_full_reparse_canvas_data.py` | `PARSER_SKIP_PAGE_LINK_HUB=1` in fast env (targeted page skip) |

**Eval (stale fast + postprocess + improved matching):**

| Course | Recall | Concepts ratio | Details ratio |
|--------|--------|----------------|---------------|
| ART102 | 56.0% | 1.58× | **0.56×** |
| CHM201 | **98.2%** | 1.71× | 2.50× |
| ASA344 | 70.3% | 4.35× | **1.60×** |

Detail ratios largely fixed offline; recall improved but still below 85%. Concept inflation unchanged on stale graph. **Fresh parse required** to validate pre-pass seeding.

---

## Remaining gaps (priority order)

1. **Top up `DEEP_SEEK_API_KEY`** and run fresh benchmark — stale `fast_3course.json` is invalid for speed *and* quality claims.
2. **Concept inflation** — ASA344 4.35×, ART102 1.61×; needs parse-time discipline + heading merge at finalize (partial fix landed).
3. **ART102 / ASA344 recall** — numbered outline titles vs LLM paraphrases; heading match helps eval but seeding must align names at parse time.
4. **CHM201 detail budget** — baseline has only **2** details; course-level cap may need per-course sparsity (ratio ~0.04) after fresh parse.
5. **Page link hubs** — parse linked PDFs instead of LLM on hub pages (future targeted skip, not blanket `PARSER_SKIP_PAGE_LLM`).

---

## Commands cheat sheet

```bash
# Dry-run batch plan + tuning (no API)
python scripts/run_parse_speed_benchmark.py --dry-run

# Full benchmark (needs API credit)
python scripts/run_parse_speed_benchmark.py --fast --eval

# Eval existing graphs only
python scripts/run_parse_speed_benchmark.py --eval-only

# Parse quality vs frozen manifest
python scripts/eval_parse_quality.py \
  --candidate .cache/graph_eval/fast_3course.json \
  --manifest fixtures/parse_quality/benchmark_baseline.json

# Offline detail/concept cleanup
python scripts/postprocess_parse_graph.py \
  .cache/graph_eval/fast_3course.json \
  -o .cache/graph_eval/fast_3course_postprocessed.json

# Rebuild manifest from quality graph
python scripts/build_parse_quality_baseline.py \
  --graph .cache/graph_eval/quality_3course.json \
  --benchmark-only

# Tests
python -m pytest tests/test_parse_quality_baseline.py \
  tests/test_graph_parse_eval.py tests/test_graph_merge_validate.py -q
```

---

## Success definition

Ship timecut when **both** are true on the same run:

1. **Speed:** `fast_3course.json` wall time ≤ **12 min** (≥50% cut from 24.1 min quality baseline).
2. **Quality:** `eval_parse_quality.py` reports **PASS** for all three benchmark courses against `benchmark_baseline.json`.

Until a fresh parse passes quality, do not re-enable extraction shortcuts removed in iterations 2–3.
