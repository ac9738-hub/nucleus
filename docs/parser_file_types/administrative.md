# Administrative / orientation (`administrative`)

Orientation, logistics, course selection, policy — no course content.

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is ADMINISTRATIVE (orientation, logistics, course selection). add_file_node only. log_event only for dated orientation sessions if explicit.

## Type-specific log tools

_None — uses standard teaching/course tools only._

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | **no** |
| Problems | **no** |
| Events | yes |
| Link to events | no |
| Pass 2 | **no** |
| Teaching outline | no |
| Keyword extract | off |
| Default `filetype` | `content` |
| Blocked pass-1 tools | add_concept_node, log_detail, log_example, log_problem, log_concept_prerequisite, add_learning_block |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-administrative/SKILL.md` when editing parser behavior for this type.
