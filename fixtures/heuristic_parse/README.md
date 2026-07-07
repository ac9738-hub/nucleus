# Heuristic parse benchmark & holdout

Evaluates **deterministic-first** parsing: file-type classification and section/teaching-unit extraction **without** sending full document text to the LLM.

## Sets

| Set | Path | Courses | Use |
|-----|------|---------|-----|
| **In-sample** | `insample/manifest.json` | 18857, 15160, 19971 | Tune heuristics + postprocess |
| **Holdout** | `holdout/manifest.json` | 15222, 14788, 17239 | Generalization only — do not overfit |
| **Textbook** | `textbook/manifest.json` + `textbook/*.txt` | manual | Chapter → section mapping (you paste text) |

## Build manifests from local files

Requires `canvasfiles/` PDFs and a source graph (default `.cache/graph_eval/fast_3course_iter8.json` or `canvas_graph.json`):

```bash
python scripts/build_heuristic_parse_fixtures.py
python scripts/build_heuristic_parse_fixtures.py --graph canvas_graph.json --all-courses
```

Each manifest row:

- `fileId`, `courseId`, `filename`
- `expectedFileType` — label from graph when `academicFileTypeSource=heuristic` and conf ≥ 0.90, else graph LLM label
- `labelSource` — `graph_heuristic` | `graph_llm` | `high_confidence_heuristic_only`
- `localPdf` — whether `canvasfiles/{fileId}` exists
- `expectedSections` — optional list of section headings (from graph details / typeExtractions / teaching_blocks)

## Textbook chapters (manual paste)

1. Open `textbook/ch01_placeholder.txt` (etc.) and replace `PASTE_CHAPTER_TEXT_HERE` with plain text.
2. Edit `textbook/manifest.json` — add `expectedSections` with chapter/section numbers you expect heuristics to find (e.g. `1.1`, `1.2`, `Chapter 2`).
3. Re-run eval.

## Evaluate

```bash
python scripts/eval_heuristic_parse.py
python scripts/eval_heuristic_parse.py --holdout
python scripts/eval_heuristic_parse.py --textbook
```

Report: `.cache/heuristic_parse/report.json`

**Pass gates** (see `profile.json`):

- File-type accuracy ≥ 92% on labeled rows
- ≥ 90% of files classified by heuristic alone (LLM classify ≤ 10%)
- Section recall ≥ 85% vs expected section labels where present
- Target: ≥ 90% prompt cache hit rate on LLM cleanup calls (tracked when wired)

## Do not

- Add course-specific title literals to heuristics to pass holdout rows
- Use holdout labels while editing `heuristic_classify()` patterns
