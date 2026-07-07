# Course syllabus (`syllabus`)

Course syllabus: schedule, grading, policies, assignment list, exam dates.

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This file is a SYLLABUS. Call add_syllabus, add_assignment_node, add_exam_node/add_event_node, AND log_syllabus_week for each schedule row, log_syllabus_policy for policies, log_syllabus_textbook for required texts. Do NOT extract teaching concepts.

## Type-specific log tools

Tools: `log_syllabus_week`, `log_syllabus_policy`, `log_syllabus_textbook`

SYLLABUS EXTRACTION (use WITH add_syllabus / add_assignment_node / add_exam_node):
- log_syllabus_week for each week/unit schedule row (weekNumber, topic, readings)
- log_syllabus_policy for attendance, late work, collaboration, grading policies
- log_syllabus_textbook for required/recommended texts
Still call add_exam_node for every dated exam and add_assignment_node for graded work.

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
| Blocked pass-1 tools | add_concept_node, log_detail, log_example, log_problem, log_concept_prerequisite |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-syllabus/SKILL.md` when editing parser behavior for this type.
