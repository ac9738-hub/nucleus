# Generic content (`generic_content`)

Fallback when no other type fits.

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

Unclassified file — use default teaching extraction rules conservatively.

## Type-specific log tools

_None — uses standard teaching/course tools only._

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | yes |
| Problems | yes |
| Events | yes |
| Link to events | no |
| Pass 2 | yes |
| Teaching outline | yes |
| Keyword extract | auto |
| Default `filetype` | `content` |
| Blocked pass-1 tools | none |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-generic_content/SKILL.md` when editing parser behavior for this type.
