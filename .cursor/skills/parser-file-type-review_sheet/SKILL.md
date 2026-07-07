---
name: parser-file-type-review_sheet
description: >-
  Parser rules for Review / study guide files (review_sheet). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Review / study guide

**Type id:** `review_sheet`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `review_sheet`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `review_sheet`

## Classification

Exam review, drill, or study guide tied to a test (not the exam itself).

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is REVIEW/STUDY material for an exam. add_file_node(filetype=study_material), link_file_to_event, and extract key topics as concepts (lightweight — not every bullet).

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/review_sheet.md`
