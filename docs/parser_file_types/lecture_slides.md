# Lecture slides (`lecture_slides`)

Slide deck: short bullets, lecture N, chapter headings, figures.

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is LECTURE SLIDES. First log every slide with log_lecture_slide (slideOrder, title, summary). Then add_concept_node / log_detail / log_example / log_problem for teaching content. Use log_lecture_objective and log_lecture_key_term when present.

## Type-specific log tools

Tools: `log_lecture_slide`, `log_lecture_objective`, `log_lecture_key_term`

LECTURE SLIDE EXTRACTION (use WITH add_concept_node / log_detail / log_example / log_problem):
- log_lecture_slide for EVERY slide in order (slideOrder + title + summary) — required for sequencing
- log_lecture_objective for stated learning objectives
- log_lecture_key_term for on-slide definitions (glossary)
Then extract teaching content with add_concept_node and log_* as usual. Always include pageid.

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | yes |
| Problems | yes |
| Events | no |
| Link to events | no |
| Pass 2 | yes |
| Teaching outline | yes |
| Keyword extract | auto |
| Default `filetype` | `content` |
| Blocked pass-1 tools | none |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-lecture_slides/SKILL.md` when editing parser behavior for this type.
