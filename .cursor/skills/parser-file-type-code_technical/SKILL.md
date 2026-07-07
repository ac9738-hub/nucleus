---
name: parser-file-type-code_technical
description: >-
  Parser rules for Code / technical document files (code_technical). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Code / technical document

**Type id:** `code_technical`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `code_technical`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `code_technical`

## Classification

Code listing, API doc, algorithm writeup, technical spec with code blocks.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is CODE/TECHNICAL material. Concepts for APIs/algorithms; log_example for code samples; log_problem for exercises. Preserve function/class names from the text.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/code_technical.md`
