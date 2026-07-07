# Humanities reading (`humanities_reading`)

Non-fiction essay, philosophy, history, or cultural reading (not lab STEM).

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is a HUMANITIES READING. Log log_reading_section for each major section (ordered), log_reading_thesis, log_reading_argument, log_reading_key_term. No STEM concept graph.

## Type-specific log tools

Tools: `log_reading_thesis`, `log_reading_argument`, `log_reading_key_term`, `log_reading_section`

HUMANITIES READING EXTRACTION:
- log_reading_thesis for the central thesis
- log_reading_argument for major supporting arguments
- log_reading_key_term for defined terms
Do not use add_concept_node or log_problem.

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | **no** |
| Problems | **no** |
| Events | no |
| Link to events | no |
| Pass 2 | **no** |
| Teaching outline | no |
| Keyword extract | auto |
| Default `filetype` | `content` |
| Blocked pass-1 tools | add_concept_node, log_detail, log_example, log_problem, log_concept_prerequisite, add_learning_block, log_event, add_exam_node |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-humanities_reading/SKILL.md` when editing parser behavior for this type.
