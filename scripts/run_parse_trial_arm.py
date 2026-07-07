#!/usr/bin/env python3
"""Run a single parse trial placement with live progress output."""
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

from canvas_parser.weekly_iteration.auth import apply_env_file, load_auth_from_env  # noqa: E402

apply_env_file(ROOT / '.env')

from canvas_parser.parse.balance_guard import preflight_deepseek_api  # noqa: E402
from canvas_parser.parse.course_orchestrator import run_course_orchestrated_lambda  # noqa: E402
from canvas_parser.parse.course_parse_plan import build_course_parse_plans, summarize_plans  # noqa: E402
from canvas_parser.parse.lambda_deploy import (  # noqa: E402
    LambdaWorkerState,
    _list_s3_json_keys,
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
    apply_production_placement,
    normalize_placement,
    placement_needs_lambda,
)
from canvas_parser.parse.trial_progress import TrialProgress  # noqa: E402
from canvas_parser.weekly_iteration.llm_parse import (  # noqa: E402
    build_parser_batches,
    merge_parser_batches_by_type,
)
from scripts.eval_graph_parse import DEFAULT_COURSES  # noqa: E402
from scripts.run_8course_budget_gate import BUDGET_8_COURSE_IDS  # noqa: E402
from scripts.run_full_reparse_canvas_data import load_batches  # noqa: E402
from scripts.postprocess_parse_graph import postprocess_graph  # noqa: E402
from scripts.run_parse_trial_compare import (  # noqa: E402
    DEFAULT_SNAPSHOTS,
    build_merged_batches,
    canvas_auth_payload,
    estimate_cost_from_graph,
    graph_stats,
    load_snapshots,
)

CACHE = ROOT / '.cache' / 'parse_trial'


async def run_lambda_placement_tracked(
    placement: str,
    batches: list[dict],
    worker: LambdaWorkerState,
    auth,
    *,
    timeout_seconds: int,
    out_dir: Path,
    progress: TrialProgress,
    benchmark_dedup: bool,
    production: bool,
    recover_run_id: str | None = None,
) -> dict[str, Any]:
    import boto3

    normalized = normalize_placement(placement)
    items = iter_batch_items(batches)
    run_id = recover_run_id or uuid.uuid4().hex
    result: dict[str, Any] = {
        'placement': normalized,
        'production': production,
        'run_id': run_id,
        'item_count': len(items),
        'lambda_function': worker.function_name,
        'bucket': worker.bucket,
        'transport': 'item_urls',
        'recovered': bool(recover_run_id),
    }
    started = time.perf_counter()

    s3 = boto3.client('s3', region_name=worker.region)
    lam = boto3.client('lambda', region_name=worker.region)
    canvas_auth = canvas_auth_payload(auth)

    if not recover_run_id:
        progress.set_phase('waiting_lambda', done=0)
        lambda_started = time.perf_counter()

        def _on_progress(done: int, total: int) -> None:
            progress.tick(done, phase='waiting_lambda')

        keys = invoke_and_wait_s3_items(
            lam,
            s3,
            worker.function_name,
            bucket=worker.bucket,
            run_id=run_id,
            items=items,
            placement=normalized,
            canvas_auth=canvas_auth,
            production=production,
            timeout_sec=timeout_seconds,
            on_progress=_on_progress,
        )
        result['invoke_sec'] = round(time.perf_counter() - lambda_started, 1)
    else:
        result['invoke_sec'] = 0.0
        progress.set_phase('waiting_lambda', done=0)
        prefix = f'runs/{run_id}/items/'
        keys = _list_s3_json_keys(s3, worker.bucket, prefix)
        progress.tick(len(keys), phase='waiting_lambda')
        if len(keys) < len(items):
            raise RuntimeError(
                f'Recover run {run_id} has {len(keys)} S3 fragments; expected {len(items)}',
            )
    progress.set_phase('merging', done=len(items))

    fragments = download_fragments(s3, worker.bucket, keys)
    merged = merge_graph_fragments(fragments)
    pre_graph = postprocess_graph(merged, skip_volume_caps=not production)
    pre_path = out_dir / 'canvas_graph_pre_dedup.json'
    pre_path.write_text(json.dumps(pre_graph, ensure_ascii=False), encoding='utf-8')
    result['pre_dedup'] = {
        'graph_path': str(pre_path),
        'stats': graph_stats(pre_graph),
        'cost': estimate_cost_from_graph(pre_graph),
    }

    if benchmark_dedup and normalized == 'lambda_download_parse':
        progress.set_phase('dedup_finalize', done=len(items))
        dedup_started = time.perf_counter()
        graph = finalize_merged_graph(merged, production=production)
        result['dedup_finalize_sec'] = round(time.perf_counter() - dedup_started, 2)
        if benchmark_dedup and normalized == 'lambda_download_parse':
            progress.emit(extra=f"dedup removed {result['pre_dedup']['stats']['concepts'] - graph_stats(graph)['concepts']} concepts")
    else:
        progress.set_phase('dedup_finalize', done=len(items))
        graph = finalize_merged_graph(merged, production=production)

    progress.set_phase('postprocess', done=len(items))
    graph = postprocess_graph(graph, skip_volume_caps=not production)
    graph_path = out_dir / 'canvas_graph.json'
    graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')

    elapsed = time.perf_counter() - started
    result.update({
        'elapsed_sec': round(elapsed, 1),
        'elapsed_min': round(elapsed / 60.0, 2),
        'graph_path': str(graph_path),
        'stats': graph_stats(graph),
        'cost': estimate_cost_from_graph(graph),
        'post_dedup': {
            'graph_path': str(graph_path),
            'stats': graph_stats(graph),
            'cost': estimate_cost_from_graph(graph),
        },
    })
    if benchmark_dedup and normalized == 'lambda_download_parse':
        pre = result['pre_dedup']['stats']
        post = result['post_dedup']['stats']
        result['dedup_delta'] = {
            'concepts': post['concepts'] - pre['concepts'],
            'details': post['details'] - pre['details'],
            'events': post['events'] - pre['events'],
            'files': post['files'] - pre['files'],
        }
    progress.set_phase('done', done=len(items))
    progress.emit(extra='COMPLETE')
    return result


async def run_lambda_course_orchestrated_tracked(
    placement: str,
    batches: list[dict],
    worker: LambdaWorkerState,
    auth,
    *,
    timeout_seconds: int,
    out_dir: Path,
    progress: TrialProgress,
    production: bool,
    recover_run_id: str | None,
) -> dict[str, Any]:
    started = time.perf_counter()
    graph, meta = await run_course_orchestrated_lambda(
        batches,
        placement=placement,
        worker=worker,
        auth=auth,
        production=production,
        timeout_seconds=timeout_seconds,
        progress=progress,
        recover_run_id=recover_run_id,
    )
    graph = postprocess_graph(graph, skip_volume_caps=not production)
    graph_path = out_dir / 'canvas_graph.json'
    graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')
    elapsed = time.perf_counter() - started
    plan = meta.get('plan_summary') or {}
    result: dict[str, Any] = {
        'placement': placement,
        'production': production,
        'orchestration': 'course_scoped',
        'run_id': meta.get('run_id'),
        'recovered': bool(recover_run_id),
        'invoke_sec': meta.get('invoke_sec', 0),
        'plan_summary': plan,
        'item_count': plan.get('total_items', progress.total_items),
        'lambda_function': worker.function_name,
        'bucket': worker.bucket,
        'elapsed_sec': round(elapsed, 1),
        'elapsed_min': round(elapsed / 60.0, 2),
        'graph_path': str(graph_path),
        'stats': graph_stats(graph),
        'cost': estimate_cost_from_graph(graph),
        'worker_skip_summary': meta.get('worker_skip_summary'),
        'worker_skip_log': str(Path(os.environ.get('PARSER_WORKER_SKIP_LOG', '.cache/parse_trial/debug/worker_skips.jsonl'))),
    }
    progress.set_phase('done', done=progress.total_items)
    progress.emit(extra='COMPLETE')
    return result


async def run_local_placement_tracked(
    batches: list[dict],
    *,
    out_dir: Path,
    progress: TrialProgress,
    production: bool,
) -> dict[str, Any]:
    started = time.perf_counter()
    graph = await run_items_concurrent(
        batches,
        placement='local_download_parse',
        max_concurrent=int(__import__('os').environ.get('PARSE_MAX_CONCURRENT', '28')),
        progress=progress,
        production=production,
    )
    progress.set_phase('postprocess', done=progress.total_items)
    graph = postprocess_graph(graph, skip_volume_caps=not production)
    graph_path = out_dir / 'canvas_graph.json'
    graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')
    elapsed = time.perf_counter() - started
    progress.set_phase('done', done=progress.total_items)
    progress.emit(extra='COMPLETE')
    return {
        'placement': 'local_download_parse',
        'production': production,
        'elapsed_sec': round(elapsed, 1),
        'elapsed_min': round(elapsed / 60.0, 2),
        'graph_path': str(graph_path),
        'stats': graph_stats(graph),
        'cost': estimate_cost_from_graph(graph),
        'item_count': progress.total_items,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--placement', required=True, choices=list(PLACEMENT_LABELS.keys()))
    parser.add_argument('--production', action='store_true', help='App-representative llm-fast (no trial skips)')
    parser.add_argument('--from-canvas-data', action='store_true', help='Build batches from canvas_data.json (app scope)')
    parser.add_argument('--courses', type=int, nargs='*', default=None)
    parser.add_argument('--snapshots', type=Path, default=DEFAULT_SNAPSHOTS)
    parser.add_argument('--timeout', type=int, default=7200)
    parser.add_argument('--progress-log', type=Path, default=None)
    parser.add_argument('--benchmark-dedup', action='store_true')
    parser.add_argument('--recover-run-id', default=None, help='Skip invoke; merge existing S3 run')
    parser.add_argument('--report', type=Path, default=None)
    args = parser.parse_args()

    placement = normalize_placement(args.placement)
    production = bool(args.production)
    scope_label = 'production' if production else 'trial'
    out_dir = CACHE / scope_label / placement
    out_dir.mkdir(parents=True, exist_ok=True)
    progress_log = args.progress_log or (CACHE / 'progress' / f'{scope_label}_{placement}.json')
    report_path = args.report or (CACHE / 'arms' / f'{scope_label}_{placement}.json')

    if args.from_canvas_data:
        course_ids = args.courses if args.courses is not None else list(BUDGET_8_COURSE_IDS)
        batches, selected_ids = load_batches(ROOT, princeton_only=True, course_ids=course_ids)
        if not batches:
            print(f'No batches for courses {course_ids}', file=sys.stderr)
            return 1
        print(f'Canvas data courses: {selected_ids}')
    else:
        course_ids = args.courses if args.courses is not None else list(DEFAULT_COURSES)
        snapshots = load_snapshots(args.snapshots, list(course_ids))
        if not snapshots:
            print(f'No snapshots for {course_ids}', file=sys.stderr)
            return 1
        auth_for_batches = load_auth_from_env(ROOT)
        base_url = auth_for_batches.base_url or 'https://princeton.instructure.com'
        batches = build_merged_batches(snapshots, base_url)
    auth = load_auth_from_env(ROOT)
    items = iter_batch_items(batches)
    if production and placement_needs_lambda(placement):
        plan_summary = summarize_plans(build_course_parse_plans(items))
        progress = TrialProgress(placement, plan_summary.get('lambda_file_items', len(items)), log_path=progress_log)
    else:
        progress = TrialProgress(placement, len(items), log_path=progress_log)

    if production:
        apply_production_placement(placement)

    print(f'=== Parse arm: {placement} ({scope_label}) ===')
    print(PLACEMENT_LABELS[placement])
    if production:
        print('Mode: llm-fast (app production — no trial skips)')
        if placement_needs_lambda(placement):
            plan_summary = summarize_plans(build_course_parse_plans(items))
            print(
                'Orchestration: course-scoped '
                f"(syllabus={plan_summary['syllabus_items']}, "
                f"deterministic={plan_summary['deterministic_items']}, "
                f"lambda_files={plan_summary['file_items']})"
            )
    else:
        print('Mode: trial llm-fast (trimmed)')
    print(f'Items: {len(items)}')
    progress.emit()

    if placement_needs_lambda(placement):
        worker = load_lambda_state(ROOT)
        if not worker:
            print('Lambda not deployed. Run: python scripts/setup_aws_lambda_parse.py deploy', file=sys.stderr)
            return 1
        preflight_deepseek_api(ROOT)
        if production:
            result = asyncio.run(run_lambda_course_orchestrated_tracked(
                placement,
                batches,
                worker,
                auth,
                timeout_seconds=args.timeout,
                out_dir=out_dir,
                progress=progress,
                production=production,
                recover_run_id=args.recover_run_id,
            ))
        else:
            benchmark = args.benchmark_dedup or placement == 'lambda_download_parse'
            result = asyncio.run(run_lambda_placement_tracked(
                placement,
                batches,
                worker,
                auth,
                timeout_seconds=args.timeout,
                out_dir=out_dir,
                progress=progress,
                benchmark_dedup=benchmark,
                production=production,
                recover_run_id=args.recover_run_id,
            ))
    else:
        preflight_deepseek_api(ROOT)
        result = asyncio.run(run_local_placement_tracked(
            batches,
            out_dir=out_dir,
            progress=progress,
            production=production,
        ))

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, indent=2, default=str), encoding='utf-8')
    print(f'Report: {report_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
