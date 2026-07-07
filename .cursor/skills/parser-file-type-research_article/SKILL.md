---
name: parser-file-type-research_article
description: >-
  Parser rules for Research article files (research_article). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: Research article

**Type id:** `research_article`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `research_article`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `research_article`

## Classification

Peer-reviewed journal article or preprint (abstract, methods, results).

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

This is a RESEARCH ARTICLE. add_file_node first. Use log_article_claim, log_article_method, log_article_finding, and log_article_key_term for structured article metadata. Skip bibliographic boilerplate.

## Do not

- Skip pass 2 when profile.pass2 is false for this type
- Block tools listed in profile.pass1_tool_blocklist
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/research_article.md`
