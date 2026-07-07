---
name: parser-file-type-past_exam
description: >-
  Parser rules for Past / current exam paper files (past_exam). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Past / current exam paper

**Type id:** `past_exam`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `past_exam`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `past_exam`

## Classification

Past or current exam paper, test, quiz sheet (often with honor code header).

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is an EXAM PAPER. Call add_file_node with filetype=study_material. link_file_to_event to Midterm/Final/Quiz/Exam using dates or filename. Do NOT extract concepts or teaching blocks from exam questions.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Run pass 2 or teaching-block seeding
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/past_exam.md`
