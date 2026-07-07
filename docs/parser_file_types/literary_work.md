# Literary work (`literary_work`)

Fiction, poetry, drama, or primary literary text — not STEM teaching.

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is a LITERARY WORK (fiction/poetry/drama). Call add_file_node(filetype=content) first. Then extract story-specific metadata with log_literary_* tools only — characters, themes, in-story plot events, settings, and symbols. Do NOT use add_concept_node, log_detail, log_event, or course exam tools.

## Type-specific log tools

Tools: `log_literary_character`, `log_literary_theme`, `log_literary_plot_event`, `log_literary_setting`, `log_literary_symbol`

LITERARY EXTRACTION — use ONLY these literary tools (not add_concept_node or log_detail):
- log_literary_character for each significant character
- log_literary_theme for themes/motifs supported by the text
- log_literary_plot_event for in-story plot beats (NOT course exams)
- log_literary_setting for places/time/social context
- log_literary_symbol for recurring symbols/images
Extract only what appears in this text. Include pageid when available. Do not invent analysis beyond what the passage supports.

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | **no** |
| Problems | **no** |
| Events | no |
| Link to events | no |
| Pass 2 | **no** |
| Teaching outline | no |
| Keyword extract | off |
| Default `filetype` | `content` |
| Blocked pass-1 tools | add_concept_node, log_detail, log_example, log_problem, log_concept_prerequisite, add_learning_block, add_syllabus |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-literary_work/SKILL.md` when editing parser behavior for this type.
