---
name: parser-file-type-discussion_prompt
description: >-
  Parser rules for Discussion / seminar prompt files (discussion_prompt). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Discussion / seminar prompt

**Type id:** `discussion_prompt`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `discussion_prompt`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `discussion_prompt`

## Classification

Seminar/precept discussion questions or response prompts.

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is a DISCUSSION PROMPT. add_file_node first, then log_discussion_question for each prompt. Optional log_reading_key_term for defined readings vocabulary.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Run pass 2 or teaching-block seeding
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/discussion_prompt.md`
