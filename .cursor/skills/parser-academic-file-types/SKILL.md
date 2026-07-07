---
name: parser-academic-file-types
description: >-
  Canvas parser academic file-type routing. Use when changing classification,
  pass-1/pass-2 behavior, or adding a new file type profile.
---

# Parser academic file types

Before pass 1, the parser classifies each file using **heuristics + optional LLM on a short snippet** (`canvas_parser/parse/file_types.py`).

## Flow

1. Trim pages / build snippet (`PARSER_CLASSIFY_SNIPPET_CHARS`, default 2800)
2. Heuristic classify from filename + snippet
3. If confidence < threshold (or `PARSER_FORCE_LLM_CLASSIFY=1`), LLM calls `classify_course_file_type`
4. Apply `FileTypeProfile`: system prompt overlay, tool allowlist, pass-2 skip, keyword extract

## Types

See `docs/parser_file_types/README.md` for the full table.

## Per-type skills

Each type has `.cursor/skills/parser-file-type-{type_id}/SKILL.md`.

## Adding a type

1. Add profile to `FILE_TYPE_PROFILES` in `file_types.py`
2. Add to `ALL_FILE_TYPE_IDS` and `CLASSIFY_TYPE_DESCRIPTIONS`
3. Run `python scripts/generate_parser_file_type_docs.py`
4. Add heuristic patterns if obvious from filename/snippet
