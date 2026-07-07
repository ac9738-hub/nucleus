---
name: parser-file-type-humanities_reading
description: >-
  Parser rules for Humanities reading files (humanities_reading). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Humanities reading

**Type id:** `humanities_reading`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `humanities_reading`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `humanities_reading`

## Classification

Non-fiction essay, philosophy, history, or cultural reading (not lab STEM).

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is a HUMANITIES READING. Log log_reading_section for each major section (ordered), log_reading_thesis, log_reading_argument, log_reading_key_term. No STEM concept graph.

## Do not

- Extract STEM concept graphs from literary/humanities prose
- Run pass 2 or teaching-block seeding
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/humanities_reading.md`
