---
name: parser-file-type-textbook_chapter
description: >-
  Parser rules for Textbook chapter files (textbook_chapter). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Textbook chapter

**Type id:** `textbook_chapter`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `textbook_chapter`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `textbook_chapter`

## Classification

Textbook section/chapter reading assigned for class.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is a TEXTBOOK CHAPTER. Log log_textbook_section for each section, log_textbook_definition and log_textbook_theorem for formal items, then add_concept_node / log_detail / log_example / log_problem for content and exercises.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/textbook_chapter.md`
