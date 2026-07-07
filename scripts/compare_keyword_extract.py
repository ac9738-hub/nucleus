#!/usr/bin/env python3
"""Compare pass-1 prompt size before vs after keyword extraction on local canvasfiles/."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault('PARSER_KEYWORD_EXTRACT', 'auto')
os.environ.setdefault('PARSER_KEYWORD_MIN_INPUT', '30000')
os.environ.setdefault('PARSER_KEYWORD_MAX_CHARS', '120000')

from canvas_parser.parse.keyword_extract import (  # noqa: E402
    compress_prompt_text,
    split_sentences,
)
from parser import build_pdf_pages, folder, normalize_file_pages, pages_to_prompt_text  # noqa: E402

DATE_PATTERN = re.compile(
    r'\b(?:'
    r'(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}'
    r'|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?'
    r'|\d{4}-\d{2}-\d{2}'
    r')\b',
    re.I,
)
DEFAULT_OUT = ROOT / '.cache' / 'keyword_extract_comparison.md'


def estimate_tokens(chars: int) -> int:
    return max(1, chars // 4)


def load_prompt_for_file(file_id: str) -> dict:
    pdf_path = folder / str(file_id)
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)
    pages = normalize_file_pages(build_pdf_pages(str(pdf_path), str(file_id)), str(file_id))
    prompt = pages_to_prompt_text(pages)
    return {
        'file_id': str(file_id),
        'bytes': pdf_path.stat().st_size,
        'pages': len(pages),
        'prompt': prompt,
    }


def salient_lines(text: str, limit: int = 8) -> list[str]:
    lines = []
    for sentence in split_sentences(text):
        lower = sentence.casefold()
        if DATE_PATTERN.search(sentence) or '%' in sentence:
            lines.append(sentence[:220])
        elif any(term in lower for term in ('exam', 'midterm', 'final', 'assignment', 'due', 'quiz', 'grade')):
            lines.append(sentence[:220])
        if len(lines) >= limit:
            break
    return lines


def dropped_sample(before: str, after: str, limit: int = 5) -> list[str]:
    after_norm = after.casefold()
    dropped = []
    for sentence in split_sentences(before):
        snippet = sentence.strip()
        if len(snippet) < 40:
            continue
        if snippet.casefold() in after_norm:
            continue
        if DATE_PATTERN.search(snippet) or '%' in snippet:
            continue
        dropped.append(snippet[:180])
        if len(dropped) >= limit:
            break
    return dropped


def compare_file(file_id: str) -> dict:
    loaded = load_prompt_for_file(file_id)
    before = loaded['prompt']
    after, stats = compress_prompt_text(before)
    kept = salient_lines(after)
    removed = dropped_sample(before, after) if stats.get('compressed') else []
    return {
        **loaded,
        'before_chars': len(before),
        'after_chars': len(after),
        'before_tokens_est': estimate_tokens(len(before)),
        'after_tokens_est': estimate_tokens(len(after)),
        'reduction_pct': round(100 * (1 - len(after) / max(len(before), 1)), 1),
        'compressed': bool(stats.get('compressed')),
        'stats': stats,
        'kept_salient': kept,
        'dropped_sample': removed,
        'after_preview': after[:1200],
    }


def pick_default_files(limit: int = 5) -> list[str]:
    if not folder.exists():
        return []
    ranked = sorted(
        (
            (path.name if path.is_file() else path.stem, path.stat().st_size)
            for path in folder.iterdir()
            if path.is_file()
        ),
        key=lambda row: row[1],
    )
    if not ranked:
        return []
    picks = []
    if ranked:
        picks.append(ranked[0][0])
    if len(ranked) > 2:
        picks.append(ranked[len(ranked) // 2][0])
    if len(ranked) > 1:
        picks.append(ranked[-1][0])
    for file_id, _size in reversed(ranked):
        if file_id not in picks:
            picks.append(file_id)
        if len(picks) >= limit:
            break
    return picks[:limit]


def render_markdown(rows: list[dict]) -> str:
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    lines = [
        '# Keyword extraction — before / after comparison',
        '',
        f'Generated: {now}',
        '',
        'Settings: `PARSER_KEYWORD_EXTRACT=auto`, `PARSER_KEYWORD_MIN_INPUT=30000`, `PARSER_KEYWORD_MAX_CHARS=120000`',
        '',
        'Token estimates use chars ÷ 4 (rough DeepSeek proxy).',
        '',
        '## Summary',
        '',
        '| File ID | PDF bytes | Pages | Before chars | After chars | Before ~tokens | After ~tokens | Reduction | Compressed? |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ]
    for row in rows:
        lines.append(
            f"| `{row['file_id']}` | {row['bytes']:,} | {row['pages']} | "
            f"{row['before_chars']:,} | {row['after_chars']:,} | "
            f"{row['before_tokens_est']:,} | {row['after_tokens_est']:,} | "
            f"{row['reduction_pct']}% | {'yes' if row['compressed'] else 'no'} |"
        )

    for row in rows:
        lines.extend([
            '',
            f"## File `{row['file_id']}`",
            '',
            f"- PDF size: **{row['bytes']:,}** bytes, **{row['pages']}** pages",
            f"- Pass-1 prompt: **{row['before_chars']:,}** → **{row['after_chars']:,}** chars "
            f"(~**{row['before_tokens_est']:,}** → ~**{row['after_tokens_est']:,}** tokens)",
        ])
        if not row['compressed']:
            lines.append('- **Not compressed** (below 30k char threshold or already small)')
            continue
        lines.extend([
            '',
            '### Salient lines kept (dates / grades / exams)',
            '',
        ])
        if row['kept_salient']:
            for item in row['kept_salient']:
                lines.append(f'- {item}')
        else:
            lines.append('- _(none matched salience heuristics in excerpt)_')

        lines.extend(['', '### Sample filler dropped', ''])
        if row['dropped_sample']:
            for item in row['dropped_sample']:
                lines.append(f'- ~~{item}~~')
        else:
            lines.append('- _(no obvious filler samples)_')

        lines.extend(['', '### After excerpt (first ~1200 chars)', '', '```text'])
        lines.append(row['after_preview'])
        if len(row.get('prompt', '')) > 1200 and row['compressed']:
            lines.append('…')
        lines.append('```')

    lines.append('')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', action='append', default=[], help='canvasfiles file id (repeatable)')
    parser.add_argument('--limit', type=int, default=5, help='auto-pick N files by size spread')
    parser.add_argument('--out', default=str(DEFAULT_OUT), help='markdown output path')
    args = parser.parse_args()

    file_ids = args.file or pick_default_files(args.limit)
    if not file_ids:
        raise SystemExit('No canvasfiles/ PDFs found.')

    rows = []
    errors = []
    for file_id in file_ids:
        try:
            rows.append(compare_file(file_id))
        except Exception as error:
            errors.append({'file_id': file_id, 'error': str(error)})

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    markdown = render_markdown(rows)
    if errors:
        markdown += '\n\n## Errors\n\n' + '\n'.join(
            f"- `{item['file_id']}`: {item['error']}" for item in errors
        )
    out_path.write_text(markdown, encoding='utf-8')

    print(json.dumps({
        'out': str(out_path),
        'files_compared': len(rows),
        'errors': len(errors),
        'rows': [
            {
                'file_id': row['file_id'],
                'before_chars': row['before_chars'],
                'after_chars': row['after_chars'],
                'reduction_pct': row['reduction_pct'],
                'compressed': row['compressed'],
            }
            for row in rows
        ],
    }, indent=2))


if __name__ == '__main__':
    main()
