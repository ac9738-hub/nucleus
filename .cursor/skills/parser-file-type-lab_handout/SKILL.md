---
name: parser-file-type-lab_handout
description: >-
  Parser rules for Lab handout files (lab_handout). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Lab handout

**Type id:** `lab_handout`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `lab_handout`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `lab_handout`

## Classification

Lab manual, protocol, pre-lab, or experiment instructions.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is a LAB HANDOUT. Extract protocol steps as log_detail; equipment/safety as concepts; analysis questions as log_problem.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/lab_handout.md`
