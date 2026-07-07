#!/usr/bin/env python3
"""Print DeepSeek parse cost report from canvas_graph.json completed_model_calls."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_cost import (  # noqa: E402
    assess_completed_model_calls,
    assess_file_parse_from_pass_records,
    format_cost_summary,
)


def main():
    parser = argparse.ArgumentParser(description='Assess DeepSeek V4 Flash parse costs from graph state.')
    parser.add_argument(
        '--graph',
        default=str(ROOT / 'canvas_graph.json'),
        help='Path to canvas_graph.json (default: repo root)',
    )
    parser.add_argument('--course', help='Filter to one course id')
    parser.add_argument('--file', help='Filter to one file id (requires --course or scans all)')
    parser.add_argument('--json', action='store_true', help='Emit JSON instead of text')
    args = parser.parse_args()

    graph_path = Path(args.graph)
    if not graph_path.is_file():
        print(f'Graph not found: {graph_path}', file=sys.stderr)
        return 1

    with graph_path.open(encoding='utf-8') as handle:
        state = json.load(handle)

    completed = state.get('completed_model_calls') or {}
    if args.file:
        passes = [
            item for item in (completed.get('deepseek_file_passes') or [])
            if str(item.get('fileid') or '') == str(args.file)
            and (not args.course or str(item.get('courseid') or '') == str(args.course))
        ]
        classify = None
        for item in completed.get('deepseek_classifications') or []:
            if str(item.get('fileid') or '') == str(args.file):
                if args.course and str(item.get('courseid') or '') != str(args.course):
                    continue
                classify = item
                break
        summary = assess_file_parse_from_pass_records(passes, classification_record=classify)
        if args.json:
            print(json.dumps(summary, indent=2))
        else:
            name = summary.get('filename') or args.file
            print(f'{name} ({args.file}): {format_cost_summary(summary)}')
        return 0

    report = assess_completed_model_calls(completed)
    if args.course:
        report['files'] = [
            item for item in report.get('files', [])
            if str(item.get('courseid') or '') == str(args.course)
        ]
        report['file_count'] = len(report['files'])
        report['total_cost_usd'] = round(sum(item['total_cost_usd'] for item in report['files']), 4)

    if args.json:
        print(json.dumps(report, indent=2))
        return 0

    print(f"Files: {report['file_count']}")
    print(f"Total: ${report['total_cost_usd']:.4f}")
    print(
        f"  input cache hit: ${report['input_cache_hit_cost_usd']:.4f} "
        f"miss: ${report['input_cache_miss_cost_usd']:.4f} "
        f"output: ${report['output_cost_usd']:.4f} "
        f"(cache hit rate {report['cache_hit_rate'] * 100:.1f}%)"
    )
    for item in sorted(
        report.get('files', []),
        key=lambda row: row.get('total_cost_usd', 0),
        reverse=True,
    )[:25]:
        name = item.get('filename') or item.get('fileid')
        print(f"  {item.get('courseid')} / {name}: {format_cost_summary(item)}")
    if report['file_count'] > 25:
        print(f"  … and {report['file_count'] - 25} more")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
