---
name: parser-file-type-exam_solution
description: >-
  Parser rules for Exam solutions / answer key files (exam_solution). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Exam solutions / answer key

**Type id:** `exam_solution`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `exam_solution`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `exam_solution`

## Classification

Answer key, worked solutions, or grading rubric for an exam.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is an EXAM SOLUTION or ANSWER KEY. add_file_node(filetype=study_material) and link_file_to_event when the parent exam is identifiable. No concept extraction.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Run pass 2 or teaching-block seeding
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/exam_solution.md`
