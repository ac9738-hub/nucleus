#!/usr/bin/env python3
"""Multi-scenario before/after comparison on saved canvasfiles/."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.keyword_extract import compress_prompt_text, split_sentences
from parser import build_pdf_pages, folder, normalize_file_pages, pages_to_prompt_text

FILES = [
    ('3160073', 'Largest extracted text (~36k chars, 28 pp)'),
    ('3160071', 'Borderline size (~30k chars, 24 pp)'),
    ('3486114', 'Exam PDF (~19k chars, 19 pp)'),
    ('2797113', 'Small syllabus-style (~2.5k chars)'),
]
OUT = ROOT / '.cache' / 'keyword_extract_comparison.md'


def salient_samples(text, limit=4):
    rows = []
    for sentence in split_sentences(text):
        lower = sentence.casefold()
        if any(key in lower for key in ('exam', 'midterm', 'final', 'due', '%', 'assignment', 'quiz', 'grade')):
            rows.append(sentence[:140])
        if len(rows) >= limit:
            break
    return rows


def compare_file(file_id, *, max_chars, min_input):
    path = folder / file_id
    pages = normalize_file_pages(build_pdf_pages(str(path), file_id), file_id)
    before = pages_to_prompt_text(pages)
    after, stats = compress_prompt_text(before, max_chars=max_chars, min_input_chars=min_input)
    return {
        'file_id': file_id,
        'pages': len(pages),
        'pdf_bytes': path.stat().st_size,
        'before_chars': len(before),
        'after_chars': len(after),
        'before_tokens_est': len(before) // 4,
        'after_tokens_est': len(after) // 4,
        'reduction_pct': round(100 * (1 - len(after) / max(len(before), 1)), 1),
        'compressed': bool(stats.get('compressed')),
        'salient_before': salient_samples(before),
        'salient_after': salient_samples(after),
        'after_preview': after[:900],
    }


def main():
    scenarios = [
        ('Default auto (min 30k, max 120k)', 120000, 30000),
        ('Aggressive (min 10k, max 8k) — tight budget demo', 8000, 10000),
    ]
    lines = [
        '# Keyword extraction — before / after on your saved canvasfiles',
        '',
        'Source: local `canvasfiles/` cache (**289 PDFs**, ~952k total extracted chars).',
        '',
        'Important: none of your cached PDFs individually reach the **~5.4M char** prompt that crashed CHI108 (`3562530`).',
        'Default auto mode therefore leaves most real files unchanged. The aggressive scenario shows retention under pressure.',
        '',
    ]

    for title, max_chars, min_input in scenarios:
        lines.extend(['---', '', f'## Scenario: {title}', ''])
        lines.append('| File | Pages | Before chars | After chars | ~Tokens before→after | Reduction |')
        lines.append('| --- | ---: | ---: | ---: | --- | ---: |')
        rows = [compare_file(fid, max_chars=max_chars, min_input=min_input) for fid, _label in FILES]
        for row, (fid, _label) in zip(rows, FILES):
            tok = f"{row['before_tokens_est']:,}→{row['after_tokens_est']:,}"
            lines.append(
                f"| `{fid}` | {row['pages']} | {row['before_chars']:,} | {row['after_chars']:,} | {tok} | {row['reduction_pct']}% |"
            )
        lines.append('')
        for row, (fid, label) in zip(rows, FILES):
            lines.extend([f'### `{fid}` — {label}', ''])
            if not row['compressed']:
                lines.append('- **No compression** at this threshold.')
            else:
                lines.append(
                    f"- Compressed **{row['before_chars']:,} → {row['after_chars']:,}** chars "
                    f"({row['reduction_pct']}% reduction)"
                )
            lines.extend(['', '**Salient lines before (sample):**', ''])
            for sample in row['salient_before']:
                lines.append(f'- {sample}')
            if not row['salient_before']:
                lines.append('- _(none matched exam/due/% heuristics)_')
            lines.extend(['', '**Salient lines after (sample):**', ''])
            for sample in row['salient_after']:
                lines.append(f'- {sample}')
            if not row['salient_after']:
                lines.append('- _(none matched exam/due/% heuristics)_')
            lines.extend(['', '**After excerpt:**', '', '```text', row['after_preview'], '```', ''])

    base_pages = normalize_file_pages(build_pdf_pages(str(folder / '3160073'), '3160073'), '3160073')
    base = pages_to_prompt_text(base_pages)
    repeat = max(1, 5_400_000 // max(len(base), 1))
    synthetic = ('\n\n'.join([base] * min(repeat, 200)))
    after_syn, _stats = compress_prompt_text(synthetic, max_chars=120000, min_input_chars=30000)
    lines.extend([
        '---',
        '',
        '## Synthetic: CHI108-scale crash extrapolation',
        '',
        f'Built by repeating your largest cached PDF prompt (`3160073`) to **{len(synthetic):,}** chars '
        f'(~**{len(synthetic) // 4:,}** tokens — similar to the 1.35M-token abort).',
        '',
        '| | Chars | ~Tokens |',
        '|---|---:|---:|',
        f'| Before | {len(synthetic):,} | {len(synthetic) // 4:,} |',
        f'| After keyword extract | {len(after_syn):,} | {len(after_syn) // 4:,} |',
        f'| Reduction | {round(100 * (1 - len(after_syn) / len(synthetic)), 1)}% | |',
        '',
        'This is where keyword extraction pays off — would cap pass-1 input and avoid the 400 context abort.',
        '',
    ])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print(f'Wrote {OUT}')
    print(f'Synthetic: {len(synthetic):,} -> {len(after_syn):,} chars')


if __name__ == '__main__':
    main()
