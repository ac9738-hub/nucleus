# Discussion / seminar prompt (`discussion_prompt`)

Seminar/precept discussion questions or response prompts.

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is a DISCUSSION PROMPT. add_file_node first, then log_discussion_question for each prompt. Optional log_reading_key_term for defined readings vocabulary.

## Type-specific log tools

Tools: `log_discussion_question`

DISCUSSION PROMPT EXTRACTION:
- log_discussion_question for each prompt question
add_file_node first. No concept graph.

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
| Blocked pass-1 tools | add_concept_node, log_example, log_problem, log_concept_prerequisite, add_learning_block, log_event |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-discussion_prompt/SKILL.md` when editing parser behavior for this type.
