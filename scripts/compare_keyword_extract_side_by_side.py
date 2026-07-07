#!/usr/bin/env python3
"""Side-by-side before/after text for keyword extraction on saved course files."""
from __future__ import annotations

import argparse
import html
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.keyword_extract import compress_prompt_text
from parser import build_pdf_pages, folder, normalize_file_pages, pages_to_prompt_text

# file_id -> (label, source note)
FILE_CATALOG = {
    '3486114': ('CHM201 Final Exam', 'canvasfiles/'),
    '3161537': ('MAT orientation — parametric curves, parabolas, integrals', 'canvasfiles/'),
    '3161536': ('MAT orientation — arctan, concavity, graph transforms', 'canvasfiles/'),
    '3161529': ('MAT orientation workshop slides', 'canvasfiles/'),
    '3210541': ('NEU 201 Lecture 1 — cellular neuroanatomy, neurons & glia', 'canvas_graph.json pages'),
    '3222528': ('NEU 201 Lecture 2 — Nernst, ion channels, resting potential', 'canvas_graph.json pages'),
    '3250423': ('NEU 201 Lecture 5 — postsynaptic neurotransmitters', 'canvas_graph.json pages'),
    '3160073': ('Philosophy article (non-STEM baseline)', 'canvasfiles/'),
    '3160071': ('Humanities article (non-STEM baseline)', 'canvasfiles/'),
    '2797113': ('Small QALMRI submission', 'canvasfiles/'),
}

DEFAULT_FILES = [
    '3486114',
    '3161537',
    '3161536',
    '3210541',
    '3222528',
    '3250423',
    '3160073',
]
DEFAULT_OUT = ROOT / '.cache' / 'keyword_extract_side_by_side.html'
GRAPH_PATH = ROOT / 'canvas_graph.json'


def load_graph_file_node(file_id: str):
    if not GRAPH_PATH.exists():
        return None
    graph = json.loads(GRAPH_PATH.read_text(encoding='utf-8'))
    file_id = str(file_id)
    for course_id, files in (graph.get('files') or {}).items():
        if not isinstance(files, dict):
            continue
        node = files.get(file_id)
        if isinstance(node, dict) and node.get('pages'):
            return {
                'course_id': str(course_id),
                'name': str(node.get('name') or ''),
                'pages': normalize_file_pages(node['pages'], file_id),
            }
    return None


def load_before(file_id: str) -> dict:
    file_id = str(file_id)
    label, source = FILE_CATALOG.get(file_id, (file_id, 'unknown'))
    path = folder / file_id
    if path.is_file():
        pages = normalize_file_pages(build_pdf_pages(str(path), file_id), file_id)
        before = pages_to_prompt_text(pages)
        return {
            'file_id': file_id,
            'label': label,
            'source': source,
            'display_name': label,
            'pages': len(pages),
            'pdf_bytes': path.stat().st_size,
            'before': before,
        }

    graph_node = load_graph_file_node(file_id)
    if graph_node:
        pages = graph_node['pages']
        before = pages_to_prompt_text(pages)
        display = graph_node['name'] or label
        return {
            'file_id': file_id,
            'label': label,
            'source': source,
            'display_name': display,
            'pages': len(pages),
            'pdf_bytes': 0,
            'before': before,
        }

    raise FileNotFoundError(f'No local PDF or graph pages for file {file_id}')


def compare(file_id: str, *, max_chars: int, min_input: int) -> dict:
    row = load_before(file_id)
    after, stats = compress_prompt_text(
        row['before'],
        max_chars=max_chars,
        min_input_chars=min_input,
    )
    before = row['before']
    return {
        **row,
        'after': after,
        'max_chars': max_chars,
        'min_input': min_input,
        'compressed': bool(stats.get('compressed')),
        'reduction_pct': round(100 * (1 - len(after) / max(len(before), 1)), 1),
    }


def render_html(rows: list[dict], *, title: str, max_chars: int, min_input: int) -> str:
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    parts = [
        '<!DOCTYPE html>',
        '<html lang="en"><head>',
        '<meta charset="utf-8">',
        f'<title>{html.escape(title)}</title>',
        '<style>',
        'body { font-family: Georgia, "Times New Roman", serif; margin: 0; background: #f4f1ea; color: #1a1a1a; }',
        'header { background: #2c3e50; color: #fff; padding: 1.25rem 1.5rem; }',
        'header h1 { margin: 0 0 0.35rem; font-size: 1.35rem; }',
        'header p { margin: 0.2rem 0; opacity: 0.9; font-size: 0.95rem; }',
        '.file-block { margin: 1.5rem; border: 1px solid #ccc; border-radius: 8px; overflow: hidden; background: #fff; }',
        '.file-block.stem { border-color: #7ba7d7; }',
        '.file-head { background: #eae6dc; padding: 0.85rem 1rem; border-bottom: 1px solid #ccc; }',
        '.file-block.stem .file-head { background: #e8f0fa; }',
        '.file-head h2 { margin: 0 0 0.35rem; font-size: 1.1rem; }',
        '.stats { font-size: 0.9rem; color: #444; }',
        '.cols { display: grid; grid-template-columns: 1fr 1fr; min-height: 420px; }',
        '.col { border-right: 1px solid #ddd; display: flex; flex-direction: column; min-width: 0; }',
        '.col:last-child { border-right: none; }',
        '.col-label { font-family: system-ui, sans-serif; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.5rem 0.75rem; background: #f8f8f8; border-bottom: 1px solid #eee; }',
        '.col.before .col-label { background: #eef4ff; color: #1e4a8a; }',
        '.col.after .col-label { background: #eefaf0; color: #1a6b32; }',
        '.text-pane { flex: 1; padding: 0.85rem 1rem; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 0.88rem; line-height: 1.45; max-height: 70vh; }',
        '.note { margin: 0 1.5rem 1.5rem; padding: 0.85rem 1rem; background: #fff8e6; border: 1px solid #e6d9a8; border-radius: 6px; font-size: 0.92rem; }',
        '@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } .col { border-right: none; border-bottom: 1px solid #ddd; } }',
        '</style></head><body>',
        '<header>',
        f'<h1>{html.escape(title)}</h1>',
        f'<p>Generated {now} · max_chars={max_chars:,} · min_input={min_input:,}</p>',
        '<p>Scroll each column independently. Compare what pass 1 would send to the LLM before vs after keyword extraction.</p>',
        '</header>',
        '<div class="note">',
        'Sources: local <code>canvasfiles/</code> PDFs and NEU lecture slide text from <code>canvas_graph.json</code> ',
        '(PDFs not downloaded locally, but parsed page text is in the graph). STEM sections have a blue border.',
        '</div>',
    ]

    stem_ids = {'3161537', '3161536', '3161529', '3210541', '3222528', '3250423', '3486114'}
    for row in rows:
        stem_class = 'file-block stem' if row['file_id'] in stem_ids else 'file-block'
        bytes_line = f'PDF {row["pdf_bytes"]:,} bytes · ' if row['pdf_bytes'] else f'source {html.escape(row["source"])} · '
        parts.extend([
            f'<div class="{stem_class}">',
            '<div class="file-head">',
            f'<h2>`{html.escape(row["file_id"])}` — {html.escape(row["display_name"])}</h2>',
            f'<div class="stats">{html.escape(row["label"])} · {bytes_line}',
            f'{row["pages"]} pages · ',
            f'before {len(row["before"]):,} chars · after {len(row["after"]):,} chars · ',
            f'~{len(row["before"]) // 4:,} → ~{len(row["after"]) // 4:,} tokens · ',
            f'reduction {row["reduction_pct"]}% · ',
            f'compressed={"yes" if row["compressed"] else "no"}',
            '</div></div>',
            '<div class="cols">',
            '<div class="col before">',
            f'<div class="col-label">Before — full extracted text ({len(row["before"]):,} chars)</div>',
            f'<div class="text-pane">{html.escape(row["before"])}</div>',
            '</div>',
            '<div class="col after">',
            f'<div class="col-label">After — keyword extract ({len(row["after"]):,} chars)</div>',
            f'<div class="text-pane">{html.escape(row["after"])}</div>',
            '</div>',
            '</div></div>',
        ])

    parts.append('</body></html>')
    return '\n'.join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', action='append', default=[], help='file id (canvasfiles or graph)')
    parser.add_argument('--max-chars', type=int, default=15000, help='keyword extract output cap')
    parser.add_argument('--min-input', type=int, default=10000, help='only compress above this size')
    parser.add_argument('--out', default=str(DEFAULT_OUT))
    args = parser.parse_args()

    file_ids = args.file or DEFAULT_FILES
    rows = []
    errors = []
    for fid in file_ids:
        try:
            rows.append(compare(fid, max_chars=args.max_chars, min_input=args.min_input))
        except Exception as error:
            errors.append((fid, str(error)))

    title = 'Keyword extraction — side-by-side text comparison'
    content = render_html(rows, title=title, max_chars=args.max_chars, min_input=args.min_input)
    if errors:
        content += '\n<!-- Errors: ' + '; '.join(f'{fid}: {err}' for fid, err in errors) + ' -->'
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(content, encoding='utf-8')
    print(f'Wrote {out}')
    for row in rows:
        print(
            f"  {row['file_id']}: {len(row['before']):,} -> {len(row['after']):,} chars "
            f"({row['reduction_pct']}%) compressed={row['compressed']}"
        )
    for fid, err in errors:
        print(f'  ERROR {fid}: {err}')


if __name__ == '__main__':
    main()
