# Textbook chapter (`textbook_chapter`)

Textbook section/chapter reading assigned for class.

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is a TEXTBOOK CHAPTER. Log log_textbook_section for each section, log_textbook_definition and log_textbook_theorem for formal items, then add_concept_node / log_detail / log_example / log_problem for content and exercises.

## Type-specific log tools

Tools: `log_textbook_section`, `log_textbook_definition`, `log_textbook_theorem`

TEXTBOOK CHAPTER EXTRACTION (use WITH concept tools):
- log_textbook_section for every section heading (sectionNumber + title) — preserves hierarchy
- log_textbook_definition for formal definitions
- log_textbook_theorem for theorems/lemmas/rules
Use add_concept_node for major topics and log_detail for explanations; log_problem for exercises.

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

See `.cursor/skills/parser-file-type-textbook_chapter/SKILL.md` when editing parser behavior for this type.
