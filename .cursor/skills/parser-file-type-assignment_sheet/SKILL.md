---
name: parser-file-type-assignment_sheet
description: >-
  Parser rules for Assignment / homework sheet files (assignment_sheet). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Assignment / homework sheet

**Type id:** `assignment_sheet`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `assignment_sheet`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `assignment_sheet`

## Classification

Homework/problem-set handout with tasks due for submission.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is an ASSIGNMENT SHEET. Call add_assignment_node and log_problem for each task. Put referenced file names in lookingfor/filechildren. Do not build a concept map.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/assignment_sheet.md`
