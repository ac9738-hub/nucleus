#!/usr/bin/env python3
"""Compare parse speed, cost, and quality across three concurrent placements.

Placements (one Lambda invocation per batch item; each item carries Canvas URLs):
  local_download_lambda_parse — local URL/auth in payload → Lambda downloads + parse
  lambda_download_parse       — Lambda uses env Canvas auth + item URLs
  local_download_parse        — local concurrent per-item parse from URLs

Setup:
  pip install boto3
  python scripts/setup_aws_lambda_parse.py deploy

Report: .cache/parse_trial/report.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.balance_guard import preflight_deepseek_api  # noqa: E402
from canvas_parser.parse.course_scope import summarize_batch_scope  # noqa: E402
from canvas_parser.parse.lambda_deploy import (  # noqa: E402
    LambdaWorkerState,
    download_fragments,
    invoke_and_wait_s3_items,
    load_lambda_state,
)
from canvas_parser.parse.lambda_runtime import (  # noqa: E402
    finalize_merged_graph,
    iter_batch_items,
    merge_graph_fragments,
    run_items_concurrent,
)
from canvas_parser.parse.parse_trial import (  # noqa: E402
    PLACEMENT_LABELS,
    normalize_placement,
    placement_needs_lambda,
)
from canvas_parser.weekly_iteration.auth import load_auth_from_env  # noqa: E402
from canvas_parser.weekly_iteration.llm_parse import (  # noqa: E402
    build_parser_batches,
    merge_parser_batches_by_type,
)
from scripts.eval_graph_parse import DEFAULT_COURSES, evaluate_graphs  # noqa: E402
from scripts.postprocess_parse_graph import postprocess_graph  # noqa: E402

DEFAULT_SNAPSHOTS = ROOT / 'fixtures' / 'weekly_iteration' / 'snapshots_gt.json'
DEFAULT_BASELINE = ROOT / '.cache' / 'graph_eval' / 'quality_3course.json'
CACHE = ROOT / '.cache' / 'parse_trial'
DEFAULT_PLACEMENTS = (
    'local_download_lambda_parse',
    'lambda_download_parse',
    'local_download_parse',
)


def load_snapshots(path: Path, course_ids: list[int]) -> list[dict]:
    snapshots = json.loads(path.read_text(encoding='utf-8'))
    allowed = {str(course_id) for course_id in course_ids}
    return [
        snapshot for snapshot in snapshots
        if str((snapshot.get('course') or {}).get('id') or '') in allowed
    ]


def build_merged_batches(snapshots: list[dict], base_url: str) -> list[dict]:
    batches: list[dict] = []
    for snapshot in snapshots:
        batches.extend(build_parser_batches(snapshot, base_url))
    return merge_parser_batches_by_type(batches)


def canvas_auth_payload(auth) -> dict[str, str]:
    return {
        'cookie': auth.cookie or '',
        'csrf': auth.csrf or '',
        'base_url': auth.base_url or '',
    }


def graph_stats(graph: dict[str, Any]) -> dict[str, int]:
    concepts = graph.get('concepts') or []
    files = sum(len(bucket or {}) for bucket in (graph.get('files') or {}).values())
    events = graph.get('events') or []
    return {
        'concepts': len(concepts),
        'files': files,
        'events': len(events),
        'details': sum(len(c.get('details') or []) for c in concepts if isinstance(c, dict)),
    }


def estimate_cost_from_graph(graph: dict[str, Any]) -> dict[str, Any]:
    calls = (graph.get('completed_model_calls') or {}).get('deepseek_file_passes') or []
    classify = (graph.get('completed_model_calls') or {}).get('deepseek_classifications') or []
    from canvas_parser.parse.parse_cost import assess_parse_cost

    merged = []
    for row in calls + classify:
        merged.append({'usage': row.get('usage') or {}})
    summary = assess_parse_cost(merged) if merged else {}
    return {
        'total_cost_usd': summary.get('total_cost_usd'),
        'total_tokens': (summary.get('usage') or {}).get('total_tokens'),
        'api_calls': len(merged),
    }


async def run_lambda_placement(
    placement: str,
    batches: list[dict],
    worker: LambdaWorkerState,
    auth,
    *,
    timeout_seconds: int,
    out_dir: Path,
) -> dict[str, Any]:
    import boto3

    normalized = normalize_placement(placement)
    items = iter_batch_items(batches)
    run_id = uuid.uuid4().hex
    result: dict[str, Any] = {
        'placement': normalized,
        'run_id': run_id,
        'item_count': len(items),
        'lambda_function': worker.function_name,
        'bucket': worker.bucket,
        'transport': 'item_urls',
    }
    started = time.perf_counter()

    s3 = boto3.client('s3', region_name=worker.region)
    lam = boto3.client('lambda', region_name=worker.region)

    canvas_auth = canvas_auth_payload(auth)

    lambda_started = time.perf_counter()
    keys = invoke_and_wait_s3_items(
        lam,
        s3,
        worker.function_name,
        bucket=worker.bucket,
        run_id=run_id,
        items=items,
        placement=normalized,
        canvas_auth=canvas_auth,
        timeout_sec=timeout_seconds,
    )
    result['invoke_sec'] = round(time.perf_counter() - lambda_started, 1)
    fragments = download_fragments(s3, worker.bucket, keys)
    merged = merge_graph_fragments(fragments)
    graph = finalize_merged_graph(merged)
    graph = postprocess_graph(graph, skip_volume_caps=True)

    graph_path = out_dir / 'canvas_graph.json'
    graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')

    elapsed = time.perf_counter() - started
    result.update({
        'elapsed_sec': round(elapsed, 1),
        'elapsed_min': round(elapsed / 60.0, 2),
        'graph_path': str(graph_path),
        'stats': graph_stats(graph),
        'cost': estimate_cost_from_graph(graph),
    })
    return result


async def run_local_placement(
    batches: list[dict],
    *,
    out_dir: Path,
) -> dict[str, Any]:
    started = time.perf_counter()
    graph = await run_items_concurrent(
        batches,
        placement='local_download_parse',
        max_concurrent=int(os.getenv('PARSE_MAX_CONCURRENT', '28')),
    )
    graph = postprocess_graph(graph, skip_volume_caps=True)
    graph_path = out_dir / 'canvas_graph.json'
    graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')
    elapsed = time.perf_counter() - started
    return {
        'placement': 'local_download_parse',
        'elapsed_sec': round(elapsed, 1),
        'elapsed_min': round(elapsed / 60.0, 2),
        'graph_path': str(graph_path),
        'stats': graph_stats(graph),
        'cost': estimate_cost_from_graph(graph),
        'item_count': len(iter_batch_items(batches)),
    }


def evaluate_quality(
    arms: dict[str, dict],
    course_ids: list[int],
    baseline_path: Path,
) -> dict[str, Any]:
    if not baseline_path.is_file():
        return {'skipped': True, 'reason': f'baseline missing: {baseline_path}'}
    baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
    course_id_strs = [str(cid) for cid in course_ids]
    quality: dict[str, Any] = {'baseline': str(baseline_path), 'placements': {}}
    for key, row in arms.items():
        if row.get('error') or not row.get('graph_path'):
            continue
        graph_path = Path(row['graph_path'])
        if not graph_path.is_file():
            continue
        candidate = json.loads(graph_path.read_text(encoding='utf-8'))
        report = evaluate_graphs(baseline, candidate, course_id_strs)
        quality['placements'][key] = {
            'passed': report['passed'],
            'courses': report['courses'],
            'aggregateRecall': round(
                sum(c['conceptTitleRecall'] for c in report['courses']) / len(report['courses']),
                4,
            ) if report['courses'] else None,
        }
    return quality


def print_comparison(report: dict[str, Any]) -> None:
    rows = report.get('placements') or {}
    if not rows:
        return
    print('\n=== Parse trial (concurrent): speed · cost · quality ===')
    quality = (report.get('quality') or {}).get('placements') or {}
    slowest = max((r.get('elapsed_min') or 0) for r in rows.values()) or 1.0
    for key in report.get('placement_order') or rows.keys():
        row = rows[key]
        if row.get('error'):
            print(f'  {key}: FAILED — {row["error"]}')
            continue
        parts = [f"{row.get('elapsed_min', 0):.2f} min", f"items={row.get('item_count', '?')}"]
        if row.get('invoke_sec') is not None:
            parts.append(f"invoke={row['invoke_sec']}s")
        cost = (row.get('cost') or {}).get('total_cost_usd')
        if cost is not None:
            parts.append(f'${float(cost):.4f}')
        recall = (quality.get(key) or {}).get('aggregateRecall')
        if recall is not None:
            parts.append(f'recall={recall:.1%}')
        speedup = round(slowest / (row.get('elapsed_min') or 1), 2)
        print(f"  {key}: {', '.join(parts)}  ({speedup}x vs slowest)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--courses', type=int, nargs='*', default=list(DEFAULT_COURSES))
    parser.add_argument('--snapshots', type=Path, default=DEFAULT_SNAPSHOTS)
    parser.add_argument('--timeout', type=int, default=7200)
    parser.add_argument(
        '--placements',
        nargs='*',
        choices=list(PLACEMENT_LABELS.keys()),
        default=list(DEFAULT_PLACEMENTS),
    )
    parser.add_argument('--placement', choices=list(PLACEMENT_LABELS.keys()))
    parser.add_argument('--quality-baseline', type=Path, default=DEFAULT_BASELINE)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--report', type=Path, default=CACHE / 'report.json')
    args = parser.parse_args()

    course_ids = list(args.courses)
    placements = [args.placement] if args.placement else list(args.placements)
    worker = load_lambda_state(ROOT)

    snapshots = load_snapshots(args.snapshots, course_ids)
    if not snapshots:
        print(f'No snapshots for {course_ids}', file=sys.stderr)
        return 1

    auth = load_auth_from_env(ROOT)
    base_url = auth.base_url or 'https://princeton.instructure.com'
    batches = build_merged_batches(snapshots, base_url)
    scope = summarize_batch_scope(batches)
    items = iter_batch_items(batches)

    print(f'Courses: {course_ids}')
    print(f'Scope: {scope}')
    print(f'Concurrent items: {len(items)}')
    if worker:
        print(f'Lambda: {worker.function_name} @ {worker.region} bucket={worker.bucket}')
    else:
        print('Lambda: not deployed (run setup_aws_lambda_parse.py deploy)')

    if args.dry_run:
        for placement in placements:
            print(f'  {placement}: {PLACEMENT_LABELS[normalize_placement(placement)]}')
        return 0

    if any(placement_needs_lambda(p) for p in placements) and not worker:
        print('Deploy Lambda first: python scripts/setup_aws_lambda_parse.py deploy', file=sys.stderr)
        return 1

    preflight_deepseek_api(ROOT)

    report: dict[str, Any] = {
        'courses': course_ids,
        'scope': scope,
        'item_count': len(items),
        'lambda': worker.to_dict() if worker else None,
        'placement_order': placements,
        'placements': {},
    }

    for placement in placements:
        out_dir = CACHE / normalize_placement(placement)
        out_dir.mkdir(parents=True, exist_ok=True)
        try:
            if normalize_placement(placement) == 'local_download_parse':
                row = asyncio.run(run_local_placement(batches, out_dir=out_dir))
            else:
                assert worker is not None
                row = asyncio.run(run_lambda_placement(
                    placement,
                    batches,
                    worker,
                    auth,
                    timeout_seconds=args.timeout,
                    out_dir=out_dir,
                ))
            report['placements'][placement] = row
            print(
                f"[{placement}] {row['elapsed_min']} min "
                f"concepts={row['stats']['concepts']} "
                f"cost=${row.get('cost', {}).get('total_cost_usd', 0)}"
            )
        except Exception as error:
            report['placements'][placement] = {'placement': placement, 'error': str(error)}
            print(f'[{placement}] FAILED: {error}', file=sys.stderr)

    report['quality'] = evaluate_quality(report['placements'], course_ids, args.quality_baseline)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')
    print_comparison(report)
    print(f'Report: {args.report}')

    failed = [k for k, v in report['placements'].items() if v.get('error')]
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
