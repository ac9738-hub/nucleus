---
name: parser-file-type-problem_set
description: >-
  Parser rules for Problem set / worksheet files (problem_set). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Problem set / worksheet

**Type id:** `problem_set`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `problem_set`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `problem_set`

## Classification

Problem set / worksheet focused on exercises (PS, HW, pset).

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is a PROBLEM SET. log_problem for every question with steps/answer when shown. add_assignment_node if it maps to a named assignment. Minimal or no concept nodes.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/problem_set.md`
