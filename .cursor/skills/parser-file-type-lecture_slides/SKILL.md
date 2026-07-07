---
name: parser-file-type-lecture_slides
description: >-
  Parser rules for Lecture slides files (lecture_slides). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Lecture slides

**Type id:** `lecture_slides`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `lecture_slides`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `lecture_slides`

## Classification

Slide deck: short bullets, lecture N, chapter headings, figures.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is LECTURE SLIDES. First log every slide with log_lecture_slide (slideOrder, title, summary). Then add_concept_node / log_detail / log_example / log_problem for teaching content. Use log_lecture_objective and log_lecture_key_term when present.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/lecture_slides.md`
