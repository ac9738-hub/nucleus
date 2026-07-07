---
name: parser-file-type-generic_content
description: >-
  Parser rules for Generic content files (generic_content). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Generic content

**Type id:** `generic_content`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `generic_content`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `generic_content`

## Classification

Fallback when no other type fits.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

Unclassified file — use default teaching extraction rules conservatively.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/generic_content.md`
