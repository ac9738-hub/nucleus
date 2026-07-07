# Problem set / worksheet (`problem_set`)

Problem set / worksheet focused on exercises (PS, HW, pset).

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is a PROBLEM SET. log_problem for every question with steps/answer when shown. add_assignment_node if it maps to a named assignment. Minimal or no concept nodes.

## Type-specific log tools

_None — uses standard teaching/course tools only._

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | **no** |
| Problems | yes |
| Events | no |
| Link to events | no |
| Pass 2 | yes |
| Teaching outline | no |
| Keyword extract | auto |
| Default `filetype` | `content` |
| Blocked pass-1 tools | add_concept_node, log_detail, log_example, log_concept_prerequisite, add_syllabus |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-problem_set/SKILL.md` when editing parser behavior for this type.
