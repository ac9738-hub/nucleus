# Lecture notes (prose) (`lecture_notes`)

Prose lecture notes or handout explaining course material (not slides).

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is LECTURE NOTES. Log major sections with log_lecture_slide (slideOrder = section index). Extract teaching content with add_concept_node and log_* tools. Include pageid on every call.

## Type-specific log tools

Tools: `log_lecture_slide`, `log_lecture_objective`, `log_lecture_key_term`

LECTURE NOTES EXTRACTION (same slide/structure tools as slide decks):
- log_lecture_slide for each major section in document order (use slideOrder as section index)
- log_lecture_objective and log_lecture_key_term when present
Plus add_concept_node / log_detail / log_example / log_problem for teaching content.

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | yes |
| Problems | yes |
| Events | yes |
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

See `.cursor/skills/parser-file-type-lecture_notes/SKILL.md` when editing parser behavior for this type.
