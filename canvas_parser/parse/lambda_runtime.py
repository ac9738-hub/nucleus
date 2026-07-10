"""Per-item parse runtime for AWS Lambda and local concurrent trials."""
from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import tempfile
import time
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any, Iterable

from canvas_parser.parse.worker_skip_log import (
    collect_parser_skip_lines,
    infer_fragment_skip,
    log_worker_skip,
)

from canvas_parser.graph.persist import build_graph_state
from canvas_parser.graph.upgrade import upgrade_graph_state
from canvas_parser.parse.parse_trial import (
    apply_placement,
    apply_production_placement,
    clear_all_parse_trial_env,
    is_production_parse,
)


_PARSER_STATE_LOCK = asyncio.Lock()


def item_key(batch_type: str, item: dict[str, Any]) -> str:
    courseid = str(item.get('courseid') or '')
    item_id = str(item.get('id') or '')
    return f'{batch_type}__{courseid}__{item_id}'


def iter_batch_items(batches: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any], str]]:
    rows: list[tuple[str, dict[str, Any], str]] = []
    for batch in batches:
        batch_type = str(batch.get('type') or 'unknown')
        for item in batch.get('content') or []:
            if isinstance(item, dict):
                rows.append((batch_type, item, item_key(batch_type, item)))
    return rows


def reset_parser_state() -> None:
    import parser as parser_mod

    parser_mod.syllabusNodes.clear()
    parser_mod.fileNodes.clear()
    parser_mod.conceptNodes.clear()
    parser_mod.learningBlocks.clear()
    parser_mod.graphEdges = parser_mod.GraphEdgeStore()
    parser_mod.moduleOrderHints.clear()
    parser_mod.courseModules.clear()
    parser_mod.externalPlatforms.clear()
    parser_mod.problems.clear()
    parser_mod.logged_details.clear()
    parser_mod.logged_examples.clear()
    parser_mod.logged_problems.clear()
    parser_mod.logged_assignments.clear()
    parser_mod.logged_events.clear()
    parser_mod.looking_for_files.clear()
    parser_mod.looking_for_in_canvas.clear()
    parser_mod.pending_linked_canvas_files.clear()
    parser_mod.url_to_node.clear()
    parser_mod.assignmentResourceNodes.clear()
    parser_mod.external_crawl_state.clear()
    parser_mod.externalResources.clear()
    parser_mod.parse_file_stats.clear()
    parser_mod.parser_thread_log_lines = []
    parser_mod.completed_model_calls = {
        'local_assignment_summaries': [],
        'deepseek_file_passes': [],
        'deepseek_classifications': [],
        'parse_file_stats': [],
        'parse_session_summary': {},
    }
    for bucket in parser_mod.parsed_items.values():
        bucket.clear()
    for bucket in parser_mod.parsed_item_keys.values():
        bucket.clear()
    parser_mod.phase_timings.update({
        'pdf_io_ms': 0.0,
        'parse_llm_ms': 0.0,
        'write_state_ms': 0.0,
        'embed_ms': 0.0,
        'external_ms': 0.0,
    })


def apply_canvas_auth(auth: dict[str, Any] | None) -> None:
    """Apply Canvas credentials from invoke payload (local_download_lambda_parse arm)."""
    if not auth:
        return
    cookie = str(auth.get('cookie') or '').strip()
    csrf = str(auth.get('csrf') or '').strip()
    base_url = str(auth.get('base_url') or '').strip()
    if cookie:
        os.environ['CANVAS_AUTH_COOKIE'] = cookie
    if csrf:
        os.environ['CANVAS_AUTH_CSRF'] = csrf
    if base_url:
        os.environ['CANVAS_BASE_URL'] = base_url.rstrip('/')


def configure_runtime(
    *,
    placement: str,
    phase: str | None = None,
    canvasfiles_dir: Path | None = None,
    production: bool | None = None,
) -> None:
    target = canvasfiles_dir or Path(os.getenv('PARSER_CANVASFILES_DIR', '/tmp/canvasfiles'))
    if os.getenv('PARSER_DEBUG_SESSION') == '1':
        target.mkdir(parents=True, exist_ok=True)
        os.environ['PARSER_CANVASFILES_DIR'] = str(target)
        import parser as parser_mod

        parser_mod.folder = target
        parser_mod.init_parse_runtime()
        return

    clear_all_parse_trial_env()
    use_production = production if production is not None else is_production_parse()
    if use_production:
        apply_production_placement(placement)
    else:
        apply_placement(placement, phase=phase)
    target = canvasfiles_dir or Path(os.getenv('PARSER_CANVASFILES_DIR', '/tmp/canvasfiles'))
    target.mkdir(parents=True, exist_ok=True)
    os.environ['PARSER_CANVASFILES_DIR'] = str(target)
    os.environ.setdefault('PARSER_OUTSIDE_SOURCES_DIR', '/tmp/nucleus-outside-sources')
    # Lambda /var/task is read-only — PDF page cache must live on ephemeral storage.
    if str(target).startswith('/tmp') or os.getenv('AWS_LAMBDA_FUNCTION_NAME'):
        os.environ.setdefault('PARSER_PDF_CACHE_DIR', '/tmp/pdf_extract')
        os.environ.setdefault('CANVAS_DOWNLOAD_MAX_BYTES', str(128 * 1024 * 1024))
    # Always download from item.url on Lambda / concurrent local (no blob cache).
    os.environ['PARSER_SKIP_DOWNLOAD_IF_CACHED'] = '0'
    import parser as parser_mod

    parser_mod.folder = target
    parser_mod.init_parse_runtime()


def export_parser_state() -> dict[str, Any]:
    import parser as parser_mod

    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as tmp:
        path = Path(tmp.name)
    old_path = parser_mod.CANVAS_GRAPH_PATH
    try:
        parser_mod.CANVAS_GRAPH_PATH = path
        parser_mod.write_state_impl()
        return json.loads(path.read_text(encoding='utf-8'))
    finally:
        parser_mod.CANVAS_GRAPH_PATH = old_path
        path.unlink(missing_ok=True)


def hydrate_parser_seed(seed: dict[str, Any] | None) -> None:
    """Load a partial graph fragment into the current parser session."""
    if not seed:
        return
    import parser as parser_mod

    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as tmp:
        path = Path(tmp.name)
    old_path = parser_mod.CANVAS_GRAPH_PATH
    try:
        path.write_text(json.dumps(seed), encoding='utf-8')
        parser_mod.CANVAS_GRAPH_PATH = path
        parser_mod.load_state_from_disk()
    finally:
        parser_mod.CANVAS_GRAPH_PATH = old_path
        path.unlink(missing_ok=True)


async def process_single_item(
    batch_type: str,
    item: dict[str, Any],
    *,
    placement: str,
    phase: str | None = None,
    canvasfiles_dir: Path | None = None,
    production: bool | None = None,
    seed_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    async with _PARSER_STATE_LOCK:
        return await _process_single_item_locked(
            batch_type,
            item,
            placement=placement,
            phase=phase,
            canvasfiles_dir=canvasfiles_dir,
            production=production,
            seed_state=seed_state,
        )


async def _process_single_item_locked(
    batch_type: str,
    item: dict[str, Any],
    *,
    placement: str,
    phase: str | None = None,
    canvasfiles_dir: Path | None = None,
    production: bool | None = None,
    seed_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    target = canvasfiles_dir or Path(os.getenv('PARSER_CANVASFILES_DIR', '/tmp/canvasfiles'))
    os.environ['PARSER_CANVASFILES_DIR'] = str(target)
    os.environ.setdefault('PARSER_OUTSIDE_SOURCES_DIR', '/tmp/nucleus-outside-sources')
    from canvas_parser.parse.parse_item_log import log_worker_item_done, log_worker_item_start
    from canvas_parser.parse.parse_pass_overrides import pass_plan_enabled

    reset_parser_state()
    configure_runtime(
        placement=placement,
        phase=phase,
        canvasfiles_dir=canvasfiles_dir,
        production=production,
    )
    # After configure_runtime (which clears env); concurrent workers use pass plan by default.
    os.environ.setdefault('PARSER_PASS_PLAN', '1')
    hydrate_parser_seed(seed_state)
    import parser as parser_mod

    course_id = str(item.get('courseid') or '')
    item_id = str(item.get('id') or '')
    filename = str(item.get('name') or '')
    use_production = production if production is not None else is_production_parse()
    log_worker_item_start(
        batch_type=batch_type,
        course_id=course_id,
        item_id=item_id,
        filename=filename,
        placement=placement,
        production=use_production,
        pass_plan=pass_plan_enabled(),
        has_seed=bool(seed_state),
    )

    started = time.perf_counter()
    stdout_buf = io.StringIO()
    with redirect_stdout(stdout_buf):
        await parser_mod.process_parse_item(item, batch_type)
    parser_lines = stdout_buf.getvalue().splitlines()
    thread_lines = list(getattr(parser_mod, 'parser_thread_log_lines', []) or [])
    parser_skip_lines = collect_parser_skip_lines(parser_lines + thread_lines)
    fragment = export_parser_state()
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    skip_info = infer_fragment_skip(fragment, item, batch_type, parser_skip_lines)
    calls = fragment.get('completed_model_calls') or {}
    deepseek_passes = len(calls.get('deepseek_file_passes') or [])
    course_id = str(item.get('courseid') or '')
    item_id = str(item.get('id') or '')
    fragment['_meta'] = {
        'batch_type': batch_type,
        'item_id': item.get('id'),
        'courseid': item.get('courseid'),
        'elapsed_ms': elapsed_ms,
        'parser_skip_lines': parser_skip_lines,
        'deepseek_passes': deepseek_passes,
        'pass_plan': item.get('passPlan'),
        'pass_plan_enabled': pass_plan_enabled(),
    }
    if skip_info:
        fragment['_meta']['skip_reason'] = skip_info.get('reason')
        log_worker_skip(
            run_id=os.getenv('PARSER_WORKER_RUN_ID', ''),
            placement=placement,
            course_id=course_id,
            item_id=item_id,
            batch_type=batch_type,
            item_name=str(item.get('name') or ''),
            reason=str(skip_info.get('reason') or ''),
            parser_skip_lines=parser_skip_lines,
            deepseek_passes=deepseek_passes,
            elapsed_ms=elapsed_ms,
            url=str(item.get('url') or ''),
            extra={
                'has_file_node': skip_info.get('has_file_node'),
                'marked_parsed': skip_info.get('marked_parsed'),
            },
        )
    log_worker_item_done(
        batch_type=batch_type,
        course_id=course_id,
        item_id=item_id,
        filename=filename,
        elapsed_ms=elapsed_ms,
        deepseek_passes=deepseek_passes,
        skip_reason=str((fragment.get('_meta') or {}).get('skip_reason') or ''),
        pass_plan=item.get('passPlan') if isinstance(item.get('passPlan'), dict) else None,
    )
    for line in parser_lines:
        print(line, flush=True)
    return fragment


def _extend_list(target: list, rows: Iterable[Any]) -> None:
    for row in rows:
        if row is not None:
            target.append(row)


def _merge_dict_of_lists(target: dict, source: dict) -> None:
    for key, value in (source or {}).items():
        if key not in target:
            target[key] = value
            continue
        if isinstance(target[key], dict) and isinstance(value, dict):
            _merge_dict_of_lists(target[key], value)
        elif isinstance(target[key], list) and isinstance(value, list):
            target[key].extend(value)


def _syllabus_richness(syllabus: dict | None) -> int:
    if not isinstance(syllabus, dict):
        return 0
    score = len(syllabus.get('assignments') or []) * 3
    score += len(syllabus.get('filechildren') or [])
    score += len(str(syllabus.get('other') or '')) // 200
    return score


def _merge_syllabus_course(existing: Any, incoming: Any) -> Any:
    """Prefer richer syllabus fragment; avoid last-write-wins data loss under concurrency."""
    if not existing:
        return incoming
    if not incoming:
        return existing
    if not isinstance(existing, dict):
        return incoming
    if not isinstance(incoming, dict):
        return existing
    if _syllabus_richness(incoming) > _syllabus_richness(existing):
        return incoming
    return existing


def merge_graph_fragments(fragments: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = {
        'concepts': [],
        'problems': [],
        'events': [],
        'syllabi': {},
        'files': {},
        'edges': [],
        'learningBlocks': {},
        'moduleOrderHints': {},
        'external_platforms': {},
        'logged_details': {},
        'logged_examples': {},
        'logged_problems': {},
        'logged_assignments': {},
        'logged_events': {},
        'looking_for_files': {},
        'looking_for_in_canvas': {},
        'url_to_node': {},
        'assignment_resource_nodes': {},
        'external_resources': {},
        'external_crawl_state': {},
        'completed_model_calls': {
            'local_assignment_summaries': [],
            'deepseek_file_passes': [],
            'deepseek_classifications': [],
            'parse_file_stats': [],
            'parse_session_summary': {},
        },
        'parsed_items': {
            'assignment': [],
            'file': [],
            'external': [],
            'page': [],
            'module_item': [],
            'external_submission': [],
        },
    }
    for fragment in fragments:
        if not fragment:
            continue
        _extend_list(merged['concepts'], fragment.get('concepts') or [])
        _extend_list(merged['problems'], fragment.get('problems') or [])
        _extend_list(merged['events'], fragment.get('events') or [])
        _extend_list(merged['edges'], fragment.get('edges') or [])
        for key in ('syllabi', 'files', 'learningBlocks', 'moduleOrderHints', 'external_platforms'):
            bucket = merged[key]
            for cid, value in (fragment.get(key) or {}).items():
                if key == 'files':
                    bucket.setdefault(cid, {})
                    if isinstance(value, dict):
                        bucket[cid].update(value)
                elif key == 'syllabi':
                    bucket[cid] = _merge_syllabus_course(bucket.get(cid), value)
                else:
                    bucket[cid] = value
        for key in (
            'logged_details', 'logged_examples', 'logged_problems', 'logged_assignments',
            'logged_events', 'looking_for_files', 'looking_for_in_canvas', 'url_to_node',
            'assignment_resource_nodes', 'external_resources', 'external_crawl_state',
        ):
            _merge_dict_of_lists(merged[key], fragment.get(key) or {})
        calls = fragment.get('completed_model_calls') or {}
        for subkey in merged['completed_model_calls']:
            _extend_list(merged['completed_model_calls'][subkey], calls.get(subkey) or [])
        parsed = fragment.get('parsed_items') or {}
        for subkey, rows in parsed.items():
            merged['parsed_items'].setdefault(subkey, [])
            _extend_list(merged['parsed_items'][subkey], rows or [])

    return upgrade_graph_state(merged)


def finalize_merged_graph(merged: dict[str, Any], *, production: bool = False) -> dict[str, Any]:
    import parser as parser_mod

    reset_parser_state()
    configure_runtime(placement='local_download_parse', production=production)
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as tmp:
        path = Path(tmp.name)
    old_path = parser_mod.CANVAS_GRAPH_PATH
    try:
        path.write_text(json.dumps(merged), encoding='utf-8')
        parser_mod.CANVAS_GRAPH_PATH = path
        parser_mod.load_state_from_disk()
        if production:
            parser_mod.finalize_graph_processing()
        else:
            parser_mod.finalize_graph_processing_trial()
        return export_parser_state()
    finally:
        parser_mod.CANVAS_GRAPH_PATH = old_path
        path.unlink(missing_ok=True)


async def run_items_concurrent(
    batches: list[dict[str, Any]],
    *,
    placement: str,
    phase: str | None = None,
    canvasfiles_dir: Path | None = None,
    max_concurrent: int = 28,
    progress=None,
    production: bool = False,
) -> dict[str, Any]:
    items = iter_batch_items(batches)
    total = len(items)
    semaphore = asyncio.Semaphore(max(1, max_concurrent))
    done = 0
    lock = asyncio.Lock()

    async def _run_one(batch_type: str, item: dict[str, Any]) -> dict[str, Any]:
        nonlocal done
        async with semaphore:
            result = await process_single_item(
                batch_type,
                item,
                placement=placement,
                phase=phase,
                canvasfiles_dir=canvasfiles_dir,
                production=production,
            )
        async with lock:
            done += 1
            if progress:
                progress.tick(done, phase='parse_items')
        return result

    if progress:
        progress.set_phase('parse_items', done=0)

    fragments = await asyncio.gather(*[
        _run_one(batch_type, item) for batch_type, item, _key in items
    ])
    if progress:
        progress.set_phase('merging', done=total)
    merged = merge_graph_fragments(list(fragments))
    if progress:
        progress.set_phase('dedup_finalize', done=total)
    return finalize_merged_graph(merged, production=production)


async def run_deterministic_course_items(
    course_items: list[tuple[str, dict[str, Any], str]],
    *,
    placement: str,
    production: bool = False,
    seed_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Process assignments/pages/module_items in one session (no per-item reset)."""
    if not course_items:
        return {}
    async with _PARSER_STATE_LOCK:
        configure_runtime(placement=placement, production=production)
        reset_parser_state()
        hydrate_parser_seed(seed_state)
        import parser as parser_mod

        for batch_type, item, _key in course_items:
            await parser_mod.process_parse_item(item, batch_type)
        return export_parser_state()
