"""Course-scoped Lambda orchestration: syllabus → deterministic → concurrent file Lambda."""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from pathlib import Path
from typing import Any

from canvas_parser.parse.course_parse_plan import build_course_parse_plans, summarize_plans
from canvas_parser.parse.syllabus_discovery import resolve_all_course_syllabi
from canvas_parser.parse.lambda_runtime import apply_canvas_auth
from canvas_parser.parse.lambda_deploy import (
    LambdaWorkerState,
    download_fragments,
    expected_s3_item_result_keys,
    get_function_concurrency,
    invoke_and_wait_s3_items,
    upload_course_seeds,
    _list_s3_json_keys,
)
from canvas_parser.parse.lambda_runtime import (
    finalize_merged_graph,
    iter_batch_items,
    merge_graph_fragments,
    process_single_item,
    run_deterministic_course_items,
)
from canvas_parser.parse.worker_skip_log import log_worker_skip, summarize_skip_rows


async def _parse_syllabus_items_local(
    plan,
    *,
    placement: str,
    production: bool,
) -> dict[str, Any]:
    """Parse all syllabus sources for one course (body HTML, then syllabus PDFs)."""
    state: dict[str, Any] = {}
    for batch_type, item, _key in plan.syllabus_items:
        fragment = await process_single_item(
            batch_type,
            item,
            placement=placement,
            production=production,
            seed_state=state or None,
        )
        state = merge_graph_fragments([state, fragment]) if state else fragment
    return state


async def _parse_all_syllabi_first(
    plans,
    *,
    placement: str,
    production: bool,
    progress=None,
) -> dict[str, dict[str, Any]]:
    """Phase 1 — every course syllabus before assignments or file Lambdas."""
    if progress:
        progress.set_phase('syllabus', done=0)
    syllabus_total = sum(len(plan.syllabus_items) for plan in plans)
    done = 0

    async def _one(plan) -> tuple[str, dict[str, Any]]:
        nonlocal done
        state = await _parse_syllabus_items_local(
            plan,
            placement=placement,
            production=production,
        )
        done += max(1, len(plan.syllabus_items))
        if progress:
            progress.tick(min(done, syllabus_total or 1), phase='syllabus')
        return plan.course_id, state

    pairs = await asyncio.gather(*[_one(plan) for plan in plans])
    return {course_id: state for course_id, state in pairs}


async def _run_deterministic_for_course(
    plan,
    *,
    placement: str,
    production: bool,
    syllabus_state: dict[str, Any] | None,
) -> dict[str, Any]:
    if not plan.deterministic_items:
        return syllabus_state or {}
    det = await run_deterministic_course_items(
        plan.deterministic_items,
        placement=placement,
        production=production,
        seed_state=syllabus_state or None,
    )
    if syllabus_state:
        return merge_graph_fragments([syllabus_state, det])
    return det


async def run_course_orchestrated_lambda(
    batches: list[dict[str, Any]],
    *,
    placement: str,
    worker: LambdaWorkerState,
    auth,
    production: bool,
    timeout_seconds: int,
    progress=None,
    recover_run_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Syllabus first (all courses), then deterministic, then concurrent file Lambda."""
    import boto3

    from scripts.run_parse_trial_compare import canvas_auth_payload

    all_items = iter_batch_items(batches)
    plans = build_course_parse_plans(all_items)
    # Fresh Canvas session for local download/classify (same as run_parser_batches).
    apply_canvas_auth(canvas_auth_payload(auth))
    if progress:
        progress.set_phase('syllabus_discover', done=0)
    await resolve_all_course_syllabi(plans, placement=placement, production=production)
    plan_summary = summarize_plans(plans)
    # Always pass live auth to Lambda downloads (not only local_download_lambda_parse).
    canvas_auth = canvas_auth_payload(auth)
    run_id = recover_run_id or uuid.uuid4().hex
    os.environ['PARSER_WORKER_RUN_ID'] = run_id
    os.environ.setdefault(
        'PARSER_WORKER_SKIP_LOG',
        str(Path('.cache/parse_trial/debug/worker_skips.jsonl').resolve()),
    )

    s3 = boto3.client('s3', region_name=worker.region)
    lam = boto3.client('lambda', region_name=worker.region)

    # Phase 1: syllabus for every course (blocks file Lambda until complete).
    syllabus_states = await _parse_all_syllabi_first(
        plans,
        placement=placement,
        production=production,
        progress=progress,
    )

    # Phase 2: deterministic assignments/pages/modules (local, seeded from syllabus).
    if progress:
        progress.set_phase('deterministic', done=0)
    det_total = sum(len(p.deterministic_items) for p in plans)
    det_done = 0
    det_lock = asyncio.Lock()

    async def _deterministic_one(plan) -> tuple[str, dict[str, Any]]:
        nonlocal det_done
        course_state = await _run_deterministic_for_course(
            plan,
            placement=placement,
            production=production,
            syllabus_state=syllabus_states.get(plan.course_id),
        )
        async with det_lock:
            det_done += len(plan.deterministic_items)
            if progress and det_total:
                progress.tick(det_done, phase='deterministic')
        return plan.course_id, course_state

    det_pairs = await asyncio.gather(*[_deterministic_one(plan) for plan in plans])
    course_seeds: dict[str, dict[str, Any]] = {}
    local_fragments: list[dict[str, Any]] = []
    for course_id, course_state in det_pairs:
        course_seeds[course_id] = course_state
        if course_state:
            local_fragments.append(course_state)

    # Phase 3: concurrent async Lambda for parseable files only (seeded per course).
    file_items: list[tuple[str, dict[str, Any], str]] = []
    seed_s3_key_by_item: dict[str, str] = {}
    course_seed_keys = upload_course_seeds(s3, worker.bucket, run_id, course_seeds)
    for plan in plans:
        seed_key = course_seed_keys.get(plan.course_id, '')
        for batch_type, item, key in plan.file_items:
            file_items.append((batch_type, item, key))
            if seed_key:
                seed_s3_key_by_item[key] = seed_key

    result_meta: dict[str, Any] = {
        'orchestration': 'course_scoped',
        'plan_summary': plan_summary,
        'run_id': run_id,
        'course_seeds': list(course_seeds.keys()),
        'lambda_concurrent': True,
        'lambda_reserved_concurrency': get_function_concurrency(lam, worker.function_name),
    }

    if not file_items:
        merged = merge_graph_fragments(local_fragments)
        graph = finalize_merged_graph(merged, production=production)
        return graph, result_meta

    if recover_run_id:
        prefix = f'runs/{run_id}/items/'
        expected_keys = expected_s3_item_result_keys(run_id, file_items)
        listed_keys = _list_s3_json_keys(s3, worker.bucket, prefix)
        keys = [key for key in listed_keys if key in expected_keys]
        missing_keys = sorted(expected_keys - set(keys))
        if missing_keys:
            sample = ', '.join(missing_keys[:5])
            raise RuntimeError(
                f'Recovered Lambda run {run_id} is missing {len(missing_keys)} expected item results'
                + (f' (first: {sample})' if sample else '')
            )
        result_meta['invoke_sec'] = 0.0
    else:
        if progress:
            progress.set_phase('waiting_lambda', done=0)
        lambda_started = time.perf_counter()

        def _on_progress(done: int, total: int) -> None:
            if progress:
                progress.tick(done, phase='waiting_lambda')

        # Thread-pool Event invokes overlap with S3 polling (no sequential ~1/s trickle).
        keys = invoke_and_wait_s3_items(
            lam,
            s3,
            worker.function_name,
            bucket=worker.bucket,
            run_id=run_id,
            items=file_items,
            placement=placement,
            canvas_auth=canvas_auth,
            production=production,
            seed_s3_key_by_item=seed_s3_key_by_item,
            timeout_sec=timeout_seconds,
            on_progress=_on_progress,
        )
        result_meta['invoke_sec'] = round(time.perf_counter() - lambda_started, 1)
        result_meta['lambda_wait_sec'] = result_meta['invoke_sec']

    lambda_fragments = download_fragments(s3, worker.bucket, keys)
    skip_rows: list[dict] = []
    for fragment in lambda_fragments:
        meta = fragment.get('_meta') or {}
        if not meta.get('skip_reason'):
            continue
        row = {
            'run_id': run_id,
            'placement': placement,
            'course_id': str(meta.get('courseid') or ''),
            'item_id': str(meta.get('item_id') or ''),
            'batch_type': str(meta.get('batch_type') or ''),
            'reason': str(meta.get('skip_reason') or ''),
            'parser_skip_lines': meta.get('parser_skip_lines') or [],
            'deepseek_passes': int(meta.get('deepseek_passes') or 0),
            'elapsed_ms': meta.get('elapsed_ms'),
        }
        skip_rows.append(row)
        log_worker_skip(
            run_id=run_id,
            placement=placement,
            course_id=row['course_id'],
            item_id=row['item_id'],
            batch_type=row['batch_type'],
            reason=row['reason'],
            parser_skip_lines=row['parser_skip_lines'],
            deepseek_passes=row['deepseek_passes'],
            elapsed_ms=row['elapsed_ms'],
            extra={'source': 's3_fragment'},
        )
    result_meta['worker_skip_summary'] = summarize_skip_rows(skip_rows)
    merged = merge_graph_fragments(local_fragments + lambda_fragments)
    if progress:
        progress.set_phase('dedup_finalize', done=len(file_items))
    graph = finalize_merged_graph(merged, production=production)
    return graph, result_meta
