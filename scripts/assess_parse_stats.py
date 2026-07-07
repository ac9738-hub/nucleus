#!/usr/bin/env python3
"""Print parse cost + runtime efficiency report from canvas_graph.json."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_stats import (  # noqa: E402
    assess_from_completed_model_calls,
    format_file_efficiency_debug,
    format_session_efficiency_report,
    write_parse_stats_report,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', default=str(ROOT / 'canvas_graph.json'))
    parser.add_argument('--report', default=str(ROOT / '.cache' / 'parse_stats' / 'report.json'))
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--top', type=int, default=15, help='Show top N most expensive files')
    args = parser.parse_args()

    graph_path = Path(args.graph)
    if not graph_path.is_file():
        print(f'Graph not found: {graph_path}', file=sys.stderr)
        return 1

    state = json.loads(graph_path.read_text(encoding='utf-8'))
    completed = state.get('completed_model_calls') or {}
    parse_file_stats = completed.get('parse_file_stats') or []
    session_meta = completed.get('parse_session_summary') or {}
    wall_ms = float(session_meta.get('wall_ms') or 0.0)
    phase_timings = session_meta.get('phase_timings_ms') or {}

    summary = assess_from_completed_model_calls(
        completed,
        parse_file_stats=parse_file_stats,
        phase_timings=phase_timings,
        wall_ms=wall_ms,
    )

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(format_session_efficiency_report(summary))
        files = sorted(
            parse_file_stats,
            key=lambda row: float((row.get('cost') or {}).get('total_cost_usd') or 0.0),
            reverse=True,
        )
        if files:
            print('\nTop files by cost:', flush=True)
            for row in files[: max(1, int(args.top))]:
                label = row.get('filename') or row.get('fileid')
                print(f"  {row.get('courseid')} / {label}: {format_file_efficiency_debug(row)}", flush=True)

    write_parse_stats_report(summary, Path(args.report))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
