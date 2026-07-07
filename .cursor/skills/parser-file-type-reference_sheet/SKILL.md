---
name: parser-file-type-reference_sheet
description: >-
  Parser rules for Reference / formula sheet files (reference_sheet). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Reference / formula sheet

**Type id:** `reference_sheet`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `reference_sheet`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `reference_sheet`

## Classification

Formula sheet, periodic table appendix, notation reference (no teaching narrative).

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is a REFERENCE SHEET (formulas, tables). add_file_node(filetype=study_material) only. No concept extraction.

## Do not

- Extract STEM concept graphs from literary/humanities prose
- Run pass 2 or teaching-block seeding
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/reference_sheet.md`
