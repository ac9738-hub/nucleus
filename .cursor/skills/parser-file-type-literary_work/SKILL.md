---
name: parser-file-type-literary_work
description: >-
  Parser rules for Literary work files (literary_work). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Literary work

**Type id:** `literary_work`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `literary_work`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `literary_work`

## Classification

Fiction, poetry, drama, or primary literary text — not STEM teaching.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is a LITERARY WORK (fiction/poetry/drama). Call add_file_node(filetype=content) first. Then extract story-specific metadata with log_literary_* tools only — characters, themes, in-story plot events, settings, and symbols. Do NOT use add_concept_node, log_detail, log_event, or course exam tools.

## Do not

- Extract STEM concept graphs from literary/humanities prose
- Run pass 2 or teaching-block seeding
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/literary_work.md`
