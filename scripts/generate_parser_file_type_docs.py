#!/usr/bin/env python3
"""Generate docs/parser_file_types/*.md and .cursor/skills/parser-file-type-*/SKILL.md."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.file_types import ALL_FILE_TYPE_IDS, CLASSIFY_TYPE_DESCRIPTIONS, FILE_TYPE_PROFILES
from canvas_parser.parse.type_logs import TYPE_SPECIFIC_PASS1_INSTRUCTIONS, extra_tool_names_for_type

DOCS = ROOT / 'docs' / 'parser_file_types'
SKILLS = ROOT / '.cursor' / 'skills'


def render_doc(profile):
    blocked = ', '.join(profile.pass1_tool_blocklist) or 'none'
    extras = extra_tool_names_for_type(profile.type_id)
    if extras:
        extra_tools_section = 'Tools: `' + '`, `'.join(extras) + '`\n\n' + TYPE_SPECIFIC_PASS1_INSTRUCTIONS.get(profile.type_id, '')
    else:
        extra_tools_section = '_None — uses standard teaching/course tools only._'
    return f"""# {profile.label} (`{profile.type_id}`)

{CLASSIFY_TYPE_DESCRIPTIONS[profile.type_id]}

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

{profile.pass1_instructions}

## Type-specific log tools

{extra_tools_section}

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | {'yes' if profile.extract_concepts else '**no**'} |
| Problems | {'yes' if profile.extract_problems else '**no**'} |
| Events | {'yes' if profile.extract_events else 'no'} |
| Link to events | {'yes' if profile.link_to_events else 'no'} |
| Pass 2 | {'yes' if profile.pass2 else '**no**'} |
| Teaching outline | {'yes' if profile.teaching_outline else 'no'} |
| Keyword extract | {profile.keyword_extract} |
| Default `filetype` | `{profile.node_filetype}` |
| Blocked pass-1 tools | {blocked} |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-{profile.type_id}/SKILL.md` when editing parser behavior for this type.
"""


def render_skill(profile):
    return f"""---
name: parser-file-type-{profile.type_id}
description: >-
  Parser rules for {profile.label} files ({profile.type_id}). Use when editing
  pass-1/pass-2 behavior, classification heuristics, or extraction for this type.
---

# Parser: {profile.label}

**Type id:** `{profile.type_id}`

## When to apply

- Editing `canvas_parser/parse/file_types.py` for `{profile.type_id}`
- Changing pass-1 prompts or tool allowlists for this file category
- Debugging misclassified files that should be `{profile.type_id}`

## Classification

{CLASSIFY_TYPE_DESCRIPTIONS[profile.type_id]}

Snippet-only LLM classify runs before pass 1 when heuristic confidence is low.

## Extraction rules

{profile.pass1_instructions}

## Do not

- {'Extract STEM concept graphs from literary/humanities prose' if profile.type_id in {'literary_work', 'humanities_reading', 'administrative', 'reference_sheet'} else 'Skip pass 2 when profile.pass2 is false for this type'}
- {'Run pass 2 or teaching-block seeding' if not profile.pass2 else 'Block tools listed in profile.pass1_tool_blocklist'}
- Override classification with course-specific title literals in heuristics

## Full reference

`docs/parser_file_types/{profile.type_id}.md`
"""


def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    index_lines = [
        '# Parser academic file types',
        '',
        'Each course file is classified from a **filename + ~2.8k char snippet** before pass 1.',
        'Profiles live in `canvas_parser/parse/file_types.py`.',
        '',
        '| Type | Pass 2 | Concepts | Skill |',
        '| --- | --- | --- | --- |',
    ]
    for type_id in ALL_FILE_TYPE_IDS:
        profile = FILE_TYPE_PROFILES[type_id]
        (DOCS / f'{type_id}.md').write_text(render_doc(profile), encoding='utf-8')
        skill_dir = SKILLS / f'parser-file-type-{type_id}'
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / 'SKILL.md').write_text(render_skill(profile), encoding='utf-8')
        index_lines.append(
            f"| [{profile.label}]({type_id}.md) | "
            f"{'yes' if profile.pass2 else 'no'} | "
            f"{'yes' if profile.extract_concepts else 'no'} | "
            f"[skill](../../.cursor/skills/parser-file-type-{type_id}/SKILL.md) |"
        )

    index_lines.extend([
        '',
        '## Master skill',
        '',
        '`.cursor/skills/parser-academic-file-types/SKILL.md` — routing index for all types.',
        '',
    ])
    (DOCS / 'README.md').write_text('\n'.join(index_lines), encoding='utf-8')

    master = SKILLS / 'parser-academic-file-types'
    master.mkdir(parents=True, exist_ok=True)
    master_skill = """---
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
"""
    (master / 'SKILL.md').write_text(master_skill, encoding='utf-8')
    print(f'Wrote {len(ALL_FILE_TYPE_IDS)} types to {DOCS} and {SKILLS}')


if __name__ == '__main__':
    main()
