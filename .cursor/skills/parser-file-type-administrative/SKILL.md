---
name: parser-file-type-administrative
description: >-
  Parser rules for Administrative / orientation files (administrative). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Administrative / orientation

**Type id:** `administrative`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `administrative`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `administrative`

## Classification

Orientation, logistics, course selection, policy — no course content.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is ADMINISTRATIVE (orientation, logistics, course selection). add_file_node only. log_event only for dated orientation sessions if explicit.

## Do not

- Extract STEM concept graphs from literary/humanities prose
- Run pass 2 or teaching-block seeding
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/administrative.md`
