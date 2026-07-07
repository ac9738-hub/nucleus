# Exam solutions / answer key (`exam_solution`)

Answer key, worked solutions, or grading rubric for an exam.

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is an EXAM SOLUTION or ANSWER KEY. add_file_node(filetype=study_material) and link_file_to_event when the parent exam is identifiable. No concept extraction.

## Type-specific log tools

_None — uses standard teaching/course tools only._

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | **no** |
| Problems | **no** |
| Events | no |
| Link to events | yes |
| Pass 2 | **no** |
| Teaching outline | no |
| Keyword extract | off |
| Default `filetype` | `study_material` |
| Blocked pass-1 tools | add_concept_node, log_detail, log_example, log_problem, log_concept_prerequisite, add_syllabus |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-exam_solution/SKILL.md` when editing parser behavior for this type.
