#!/usr/bin/env python3
"""Full reparse of Princeton courses from app canvas_data.json.

Use --mode heuristic for rules-only (no LLM) or --mode llm for full DeepSeek parse.
Default --mode llm-fast keeps bulk throughput for day-to-day app refreshes.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.course_scope import (  # noqa: E402
    filter_course_records,
    load_canvas_data,
    summarize_batch_scope,
)
from canvas_parser.parse.parse_modes import (  # noqa: E402
    apply_parse_mode,
    normalize_parse_mode,
    print_active_parse_mode,
)
from canvas_parser.weekly_iteration.auth import load_auth_from_env  # noqa: E402
from canvas_parser.weekly_iteration.llm_parse import (  # noqa: E402
    build_parser_batches,
    merge_parser_batches_by_type,
    run_parser_batches,
)
from scripts.build_harvard_snapshots_from_canvas_data import build_snapshot  # noqa: E402

DEFAULT_OUT = {
    'heuristic': ROOT / '.cache' / 'reparse' / 'princeton_heuristic.json',
    'llm': ROOT / '.cache' / 'reparse' / 'princeton_llm.json',
    'llm-fast': ROOT / '.cache' / 'reparse' / 'princeton_llm_fast.json',
}


def print_parse_stats_report(root: Path) -> None:
    graph_path = root / 'canvas_graph.json'
    if not graph_path.is_file():
        return
    try:
        from canvas_parser.parse.parse_stats import (  # noqa: WPS433
            assess_from_completed_model_calls,
            format_session_efficiency_report,
            write_parse_stats_report,
        )

        state = json.loads(graph_path.read_text(encoding='utf-8'))
        completed = state.get('completed_model_calls') or {}
        session_meta = completed.get('parse_session_summary') or {}
        summary = assess_from_completed_model_calls(
            completed,
            parse_file_stats=completed.get('parse_file_stats') or [],
            phase_timings=session_meta.get('phase_timings_ms') or {},
            wall_ms=float(session_meta.get('wall_ms') or 0.0),
        )
        print(format_session_efficiency_report(summary))
        report_path = write_parse_stats_report(
            summary,
            root / '.cache' / 'parse_stats' / 'report.json',
        )
        print(f'Parse stats report: {report_path}')
    except Exception as error:
        print(f'Could not write parse stats report: {error}', file=sys.stderr)


def backup_graph(root: Path, label: str = 'pre_full_reparse') -> Path | None:
    graph_path = root / 'canvas_graph.json'
    if not graph_path.is_file():
        return None
    backup_path = root / f'canvas_graph.json.{label}.bak'
    shutil.copy2(graph_path, backup_path)
    return backup_path


def load_batches(
    root: Path,
    *,
    princeton_only: bool = True,
    course_ids: list[int] | None = None,
) -> tuple[list[dict], list[int]]:
    data = load_canvas_data(root)
    auth = load_auth_from_env(root)
    courses = filter_course_records(
        data.get('courses') or [],
        princeton_only=princeton_only,
        course_ids=course_ids,
    )
    selected_ids = [int(course['id']) for course in courses]
    batches: list[dict] = []
    base_url = auth.base_url or 'https://princeton.instructure.com'
    for course_id in selected_ids:
        snapshot = build_snapshot(data, course_id)
        batches.extend(build_parser_batches(snapshot, base_url))
    if os.getenv('PARSER_BULK_MODE') == '1':
        batches = merge_parser_batches_by_type(batches)
    return batches, selected_ids


def postprocess_graph_file(graph_path: Path) -> None:
    graph = json.loads(graph_path.read_text(encoding='utf-8'))
    from scripts.postprocess_parse_graph import postprocess_graph  # noqa: WPS433

    graph = postprocess_graph(graph)
    session = graph.setdefault('completed_model_calls', {}).setdefault('parse_session_summary', {})
    session['parseMode'] = os.environ.get('PARSER_PARSE_MODE', '')
    graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')
    print('Applied postprocess_graph to canvas_graph.json')


def copy_graph(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    print(f'Saved graph copy: {dest}')


def run_reparse_once(
    root: Path,
    *,
    mode: str,
    timeout_seconds: int,
    princeton_only: bool,
    course_ids: list[int] | None,
    out_graph: Path | None,
    skip_preflight: bool,
    dry_run: bool,
) -> int:
    normalized = apply_parse_mode(mode)
    print_active_parse_mode()

    canvas_data = root / 'canvas_data.json'
    if not canvas_data.is_file():
        print(f'Missing {canvas_data}', file=sys.stderr)
        return 1

    batches, selected_ids = load_batches(
        root,
        princeton_only=princeton_only,
        course_ids=course_ids,
    )
    scope = summarize_batch_scope(batches)
    if princeton_only:
        all_count = len([c for c in load_canvas_data(root).get('courses') or [] if c.get('id')])
        print(f'Princeton-only scope: {len(selected_ids)}/{all_count} courses')
    print(f'Courses: {len(selected_ids)} {sorted(str(cid) for cid in selected_ids)}')
    print(f'Parser batches: {len(batches)} ({scope.get("total", 0)} items) scope={scope}')

    if normalized == 'heuristic':
        print('Heuristic mode: no DeepSeek calls; preflight skipped.')
    elif not skip_preflight and not dry_run:
        from canvas_parser.parse.balance_guard import preflight_deepseek_api  # noqa: WPS433

        preflight_deepseek_api(root)

    if dry_run:
        print('Dry run — no parser subprocess started.')
        return 0

    backup = backup_graph(root)
    if backup:
        print(f'Backed up graph to {backup.name}')

    auth = load_auth_from_env(root)
    started = time.perf_counter()
    try:
        run_parser_batches(batches, root, auth, timeout_seconds=timeout_seconds, keep_graph=True)
    except Exception as error:
        print(f'Full reparse failed: {error}', file=sys.stderr)
        return 1

    elapsed = time.perf_counter() - started
    print(f'Reparse ({normalized}) finished in {elapsed / 60:.1f} min.')

    graph_path = root / 'canvas_graph.json'
    if graph_path.is_file():
        try:
            postprocess_graph_file(graph_path)
        except Exception as error:
            print(f'Postprocess on write failed: {error}', file=sys.stderr)

        target = out_graph or DEFAULT_OUT.get(normalized)
        if target:
            copy_graph(graph_path, target)

    print_parse_stats_report(root)
    if os.getenv('PARSER_DEFER_FILE_EMBED') == '1':
        print('Per-file embed was deferred — run: python scripts/reembed_graph.py')
    if normalized != 'heuristic':
        try:
            from scripts.post_parse_graph_quality import main as post_parse_quality  # noqa: WPS433

            print('Running post-parse graph quality pass...')
            post_parse_quality()
        except Exception as error:
            print(f'Post-parse quality pass failed: {error}', file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=int, default=3600, help='Parser timeout seconds (default 1h)')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument(
        '--skip-preflight',
        action='store_true',
        help='Skip DeepSeek balance preflight',
    )
    parser.add_argument(
        '--all-courses',
        action='store_true',
        help='Include non-Princeton Canvas accounts (default: Princeton only)',
    )
    parser.add_argument('--courses', type=int, nargs='*', help='Optional subset of course IDs')
    parser.add_argument(
        '--mode',
        choices=['heuristic', 'llm', 'llm-fast'],
        default='llm-fast',
        help='Parse mode: heuristic (no LLM), llm (full quality), llm-fast (bulk default)',
    )
    parser.add_argument(
        '--quality',
        action='store_true',
        help='Alias for --mode llm (deprecated)',
    )
    parser.add_argument(
        '--out-graph',
        type=Path,
        default=None,
        help='Copy finished canvas_graph.json here (default: .cache/reparse/princeton_<mode>.json)',
    )
    parser.add_argument(
        '--compare',
        action='store_true',
        help='Run heuristic then llm back-to-back and write mode comparison report',
    )
    args = parser.parse_args()

    mode = 'llm' if args.quality else args.mode
    try:
        normalize_parse_mode(mode)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2

    if args.compare:
        if args.dry_run:
            for compare_mode in ('heuristic', 'llm'):
                print(f'\n=== Dry run: {compare_mode} ===')
                code = run_reparse_once(
                    ROOT,
                    mode=compare_mode,
                    timeout_seconds=args.timeout,
                    princeton_only=not args.all_courses,
                    course_ids=args.courses,
                    out_graph=DEFAULT_OUT[compare_mode],
                    skip_preflight=True,
                    dry_run=True,
                )
                if code:
                    return code
            return 0

        for compare_mode in ('heuristic', 'llm'):
            print(f'\n=== Compare run: {compare_mode} ===')
            code = run_reparse_once(
                ROOT,
                mode=compare_mode,
                timeout_seconds=args.timeout,
                princeton_only=not args.all_courses,
                course_ids=args.courses,
                out_graph=DEFAULT_OUT[compare_mode],
                skip_preflight=args.skip_preflight,
                dry_run=False,
            )
            if code:
                return code

        try:
            from scripts.compare_parse_modes import compare, load_graph  # noqa: WPS433

            report = compare(load_graph(DEFAULT_OUT['heuristic']), load_graph(DEFAULT_OUT['llm']))
            report_path = ROOT / '.cache' / 'reparse' / 'mode_comparison.json'
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(f'\nComparison report: {report_path}')
            for key, value in report['delta_llm_minus_heuristic'].items():
                print(f'  {key}: {value:+d}')
        except Exception as error:
            print(f'Comparison report failed: {error}', file=sys.stderr)
            return 1
        return 0

    return run_reparse_once(
        ROOT,
        mode=mode,
        timeout_seconds=args.timeout,
        princeton_only=not args.all_courses,
        course_ids=args.courses,
        out_graph=args.out_graph,
        skip_preflight=args.skip_preflight,
        dry_run=args.dry_run,
    )


if __name__ == '__main__':
    raise SystemExit(main())
