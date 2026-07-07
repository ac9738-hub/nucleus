"""CLI: build weekly schedules from canvas_data JSON on stdin or file."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .bridge import build_weekly_schedules


def _load_json(path: str | None) -> dict:
    if path and path != '-':
        return json.loads(Path(path).read_text(encoding='utf-8'))
    raw = sys.stdin.read()
    return json.loads(raw) if raw.strip() else {}


def _configure_stdout_utf8() -> None:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')


def _write_json_stdout(payload) -> None:
    text = json.dumps(payload, ensure_ascii=False)
    buffer = getattr(sys.stdout, 'buffer', None)
    if buffer is not None:
        buffer.write(text.encode('utf-8'))
        buffer.flush()
        return
    sys.stdout.write(text)
    sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    _configure_stdout_utf8()
    parser = argparse.ArgumentParser(description='Build weekly schedules from Canvas app data.')
    parser.add_argument(
        '--canvas-data',
        default='-',
        help='Path to canvas_data JSON (default: stdin)',
    )
    parser.add_argument(
        '--graph',
        default='',
        help='Path to canvas_graph.json (optional; enables graph event enrichment)',
    )
    parser.add_argument(
        '--no-graph',
        action='store_true',
        help='Skip parser graph enrichment',
    )
    args = parser.parse_args(argv)

    canvas_data = _load_json(args.canvas_data)
    graph = None
    if not args.no_graph and args.graph:
        graph_path = Path(args.graph)
        if graph_path.is_file():
            graph = json.loads(graph_path.read_text(encoding='utf-8'))

    schedules = build_weekly_schedules(canvas_data, graph, use_graph=not args.no_graph and graph is not None)
    _write_json_stdout(schedules)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
