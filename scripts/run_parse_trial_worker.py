#!/usr/bin/env python3
"""Run one parse trial phase on a worker machine (invoked via SSH from orchestrator)."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_trial import apply_placement  # noqa: E402
from canvas_parser.weekly_iteration.auth import load_auth_from_env  # noqa: E402
from canvas_parser.weekly_iteration.llm_parse import run_parser_batches  # noqa: E402
from scripts.postprocess_parse_graph import postprocess_graph  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=('download', 'inference', 'full'), required=True)
    parser.add_argument('--batches', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--timeout', type=int, default=7200)
    args = parser.parse_args()

    if not args.batches.is_file():
        print(f'Missing batches file: {args.batches}', file=sys.stderr)
        return 1

    args.work_dir.mkdir(parents=True, exist_ok=True)
    batches = json.loads(args.batches.read_text(encoding='utf-8'))
    if not batches:
        print('Empty batches', file=sys.stderr)
        return 1

    auth = load_auth_from_env(ROOT)
    stats_path = args.work_dir / 'parse_stats.json'
    graph_path = args.work_dir / 'canvas_graph.json'
    manifest_path = args.work_dir / 'worker_result.json'

    if args.phase == 'download':
        apply_placement('local_download_lambda_parse')
    elif args.phase == 'inference':
        apply_placement('local_download_lambda_parse')
    else:
        apply_placement('lambda_download_parse')

    started = time.perf_counter()
    graph = run_parser_batches(
        batches,
        ROOT,
        auth,
        timeout_seconds=args.timeout,
        keep_graph=args.phase != 'download',
        extra_env={'PARSER_STATS_REPORT_PATH': str(stats_path)},
    )
    elapsed_sec = round(time.perf_counter() - started, 1)

    result: dict = {
        'phase': args.phase,
        'elapsed_sec': elapsed_sec,
        'stats_path': str(stats_path),
        'graph_path': str(graph_path),
    }

    if args.phase == 'download':
        result['status'] = 'download_only'
        manifest_path.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result))
        return 0

    if not graph:
        print('Parser returned empty graph', file=sys.stderr)
        return 1

    graph = postprocess_graph(graph, skip_volume_caps=True)
    graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')
    result['status'] = 'ok'
    if stats_path.is_file():
        result['parse_stats'] = json.loads(stats_path.read_text(encoding='utf-8'))
    manifest_path.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
