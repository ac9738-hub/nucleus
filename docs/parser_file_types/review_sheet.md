# Review / study guide (`review_sheet`)

Exam review, drill, or study guide tied to a test (not the exam itself).

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is REVIEW/STUDY material for an exam. add_file_node(filetype=study_material), link_file_to_event, and extract key topics as concepts (lightweight — not every bullet).

## Type-specific log tools

_None — uses standard teaching/course tools only._

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | yes |
| Problems | yes |
| Events | no |
| Link to events | yes |
| Pass 2 | yes |
| Teaching outline | yes |
| Keyword extract | auto |
| Default `filetype` | `study_material` |
| Blocked pass-1 tools | none |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-review_sheet/SKILL.md` when editing parser behavior for this type.
