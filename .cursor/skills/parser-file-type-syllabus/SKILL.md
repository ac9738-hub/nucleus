---
name: parser-file-type-syllabus
description: >-
  Parser rules for Course syllabus files (syllabus). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Course syllabus

**Type id:** `syllabus`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `syllabus`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `syllabus`

## Classification

Course syllabus: schedule, grading, policies, assignment list, exam dates.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This file is a SYLLABUS. Call add_syllabus, add_assignment_node, add_exam_node/add_event_node, AND log_syllabus_week for each schedule row, log_syllabus_policy for policies, log_syllabus_textbook for required texts. Do NOT extract teaching concepts.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Run pass 2 or teaching-block seeding
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/syllabus.md`
