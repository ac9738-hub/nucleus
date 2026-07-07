---
name: parser-file-type-lecture_notes
description: >-
  Parser rules for Lecture notes (prose) files (lecture_notes). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Lecture notes (prose)

**Type id:** `lecture_notes`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `lecture_notes`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `lecture_notes`

## Classification

Prose lecture notes or handout explaining course material (not slides).

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is LECTURE NOTES. Log major sections with log_lecture_slide (slideOrder = section index). Extract teaching content with add_concept_node and log_* tools. Include pageid on every call.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/lecture_notes.md`
