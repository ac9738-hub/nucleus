#!/usr/bin/env python3
"""Benchmark fast vs quality parse on 3 GT courses and evaluate graph quality."""
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

from canvas_parser.parse.balance_guard import preflight_deepseek_api  # noqa: E402
from canvas_parser.parse.course_scope import summarize_batch_scope  # noqa: E402
from canvas_parser.weekly_iteration.auth import load_auth_from_env  # noqa: E402
from canvas_parser.weekly_iteration.llm_parse import (  # noqa: E402
    build_parser_batches,
    chunk_parser_batches,
    merge_parser_batches_by_type,
    run_parser_batches,
)
from scripts.eval_graph_parse import DEFAULT_COURSES, evaluate_graphs, extract_course_subgraph  # noqa: E402
from scripts.eval_parse_quality import eval_against_manifest, load_manifest  # noqa: E402
from scripts.postprocess_parse_graph import postprocess_graph  # noqa: E402
from canvas_parser.parse.parse_modes import (  # noqa: E402
    apply_fast_reparse_env,
    apply_llm_mode,
    apply_parse_mode,
    apply_quality_reparse_env,
    print_active_parse_mode,
)

PARSER_ENV_KEYS = (
    'PARSER_BULK_MODE',
    'PARSER_SKIP_PASS2',
    'PARSER_DEFER_FILE_EMBED',
    'PARSER_DEFER_CHECKPOINT',
    'PARSER_SKIP_ASSIGNMENT_SUMMARY',
    'PARSER_SKIP_SYLLABUS_FINAL_PASS',
    'PARSER_SKIP_EXTERNAL',
    'PARSER_SKIP_PAGE_LLM',
    'PARSER_DEFER_PER_FILE_FINALIZE',
    'PARSER_DEFER_FILE_INDEX',
    'PARSER_DEFER_BATCH_FINALIZE',
    'PARSER_SKIP_LLM_CLASSIFY',
    'PARSER_SKIP_DOWNLOAD_IF_CACHED',
    'PARSER_SKIP_PDF_BLOCKS',
    'PARSER_LINKED_FILE_MODE',
    'PARSER_KEYWORD_EXTRACT',
    'PARSER_SKIP_PAGE_LINK_HUB',
    'PARSE_MAX_CONCURRENT',
    'DEEPSEEK_MAX_CONCURRENT',
    'DEEPSEEK_MAX_TURNS_PASS',
    'PARSER_MAX_BATCH_ITEMS',
    'WRITE_DEBOUNCE_SECONDS',
)


def clear_parser_env() -> None:
    for key in PARSER_ENV_KEYS:
        os.environ.pop(key, None)

FIXTURE_MANIFEST = ROOT / 'fixtures' / 'parse_quality' / 'benchmark_baseline.json'
CACHE = ROOT / '.cache' / 'graph_eval'
QUALITY_META_PATH = CACHE / 'quality_3course.meta.json'
DEFAULT_SNAPSHOTS = ROOT / 'fixtures' / 'weekly_iteration' / 'snapshots_gt.json'


def write_quality_meta(stats: dict) -> None:
    QUALITY_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    QUALITY_META_PATH.write_text(json.dumps(stats, indent=2), encoding='utf-8')


def load_quality_meta() -> dict | None:
    if not QUALITY_META_PATH.is_file():
        return None
    return json.loads(QUALITY_META_PATH.read_text(encoding='utf-8'))


def load_snapshots(path: Path, course_ids: list[int]) -> list[dict]:
    snapshots = json.loads(path.read_text(encoding='utf-8'))
    allowed = {str(course_id) for course_id in course_ids}
    return [
        snapshot for snapshot in snapshots
        if str((snapshot.get('course') or {}).get('id') or '') in allowed
    ]


def build_batches(snapshots: list[dict], base_url: str, *, merge_by_type: bool = False) -> list[dict]:
    batches: list[dict] = []
    for snapshot in snapshots:
        batches.extend(build_parser_batches(snapshot, base_url))
    if merge_by_type:
        batches = merge_parser_batches_by_type(batches)
    return batches


def run_parse(
    batches: list[dict],
    *,
    fast: bool,
    timeout_seconds: int,
    out_path: Path,
) -> dict:
    clear_parser_env()
    if fast:
        apply_fast_reparse_env()
    else:
        apply_llm_mode()
        # Benchmark baseline: defer embed/checkpoint; skip external (matches fast bulk scope).
        os.environ['PARSER_DEFER_FILE_EMBED'] = '1'
        os.environ['PARSER_DEFER_CHECKPOINT'] = '1'
        os.environ['PARSER_SKIP_EXTERNAL'] = '1'
    print_active_parse_mode()

    auth = load_auth_from_env(ROOT)
    started = time.perf_counter()
    graph = run_parser_batches(
        batches,
        ROOT,
        auth,
        timeout_seconds=timeout_seconds,
        keep_graph=True,
    )
    elapsed = time.perf_counter() - started
    if not graph:
        raise RuntimeError('Parser returned empty graph')

    graph = postprocess_graph(graph)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')
    return {
        'elapsed_sec': round(elapsed, 1),
        'elapsed_min': round(elapsed / 60.0, 2),
        'graph_path': str(out_path),
        'scope': summarize_batch_scope(batches),
    }


def extract_baseline_from_production(course_ids: list[int], out_path: Path) -> None:
    graph_path = ROOT / 'canvas_graph.json'
    if not graph_path.is_file():
        raise FileNotFoundError(f'Missing production graph: {graph_path}')
    state = json.loads(graph_path.read_text(encoding='utf-8'))
    subset = extract_course_subgraph(state, [str(course_id) for course_id in course_ids])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(subset, ensure_ascii=False), encoding='utf-8')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--courses', type=int, nargs='*', default=list(DEFAULT_COURSES))
    parser.add_argument('--snapshots', type=Path, default=DEFAULT_SNAPSHOTS)
    parser.add_argument('--timeout', type=int, default=7200)
    parser.add_argument('--extract-baseline-from-graph', action='store_true')
    parser.add_argument('--baseline', action='store_true', help='Run quality/slow parse baseline')
    parser.add_argument('--fast', action='store_true', help='Run fast parse candidate')
    parser.add_argument('--eval', action='store_true', help='Compare baseline vs fast graphs')
    parser.add_argument('--all', action='store_true', help='baseline + fast + eval')
    parser.add_argument('--eval-only', action='store_true', help='Compare existing baseline vs fast graphs')
    parser.add_argument('--repostprocess', action='store_true', help='Re-run postprocess before eval-only')
    parser.add_argument('--extract-baseline', action='store_true', help='Extract baseline subgraph from production graph')
    parser.add_argument('--dry-run', action='store_true', help='Print batch plan and tuning; no API calls')
    args = parser.parse_args()

    course_ids = list(args.courses)
    quality_baseline_path = CACHE / 'quality_3course.json'
    baseline_path = quality_baseline_path if quality_baseline_path.is_file() else CACHE / 'baseline_3course.json'
    fast_path = CACHE / 'fast_3course.json'
    report_path = CACHE / 'benchmark_report.json'

    if args.extract_baseline:
        print('Extracting baseline subgraph from production canvas_graph.json...')
        extract_baseline_from_production(course_ids, CACHE / 'baseline_3course.json')
        return 0

    if args.eval_only:
        if not fast_path.is_file():
            print(f'Need {fast_path.name}. Run: python scripts/run_parse_speed_benchmark.py --fast', file=sys.stderr)
            return 1
        candidate = json.loads(fast_path.read_text(encoding='utf-8'))
        if args.repostprocess or not (candidate.get('meta') or {}).get('postprocess'):
            candidate = postprocess_graph(candidate)
            fast_path.write_text(json.dumps(candidate, ensure_ascii=False), encoding='utf-8')
        course_id_strs = [str(course_id) for course_id in course_ids]
        results: dict = {'courses': course_ids}
        if FIXTURE_MANIFEST.is_file():
            fixture_report = eval_against_manifest(
                candidate,
                load_manifest(FIXTURE_MANIFEST),
                course_ids=course_id_strs,
            )
            results['fixtureEval'] = fixture_report
            eval_report = fixture_report
            print(f"Fixture eval ({FIXTURE_MANIFEST.name}): {'PASS' if fixture_report['passed'] else 'FAIL'}")
            if baseline_path.is_file():
                baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
                quality_report = evaluate_graphs(baseline, candidate, course_id_strs)
                results['eval'] = quality_report
                print(f"Quality baseline eval: {'PASS' if quality_report['passed'] else 'FAIL'}")
        else:
            if not baseline_path.is_file():
                print('Need fixture manifest or baseline graph for eval.', file=sys.stderr)
                return 1
            baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
            eval_report = evaluate_graphs(baseline, candidate, course_id_strs)
            results['eval'] = eval_report
        report = {}
        if report_path.is_file():
            report = json.loads(report_path.read_text(encoding='utf-8'))
        report.update(results)
        quality_meta = load_quality_meta()
        if report.get('fast') and quality_meta and quality_meta.get('elapsed_min'):
            base_min = float(quality_meta['elapsed_min'])
            fast_min = float(report['fast']['elapsed_min'])
            report['speedup'] = round(base_min / fast_min, 2) if fast_min else None
            print(f"Speedup vs quality baseline: {report['speedup']}x ({base_min:.1f}m -> {fast_min:.1f}m)")
        report_path.write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')
        for row in (results.get('eval') or results.get('fixtureEval') or eval_report)['courses']:
            status = 'PASS' if row['passed'] else 'FAIL'
            print(
                f"  course {row['courseId']}: {status} "
                f"recall={row['conceptTitleRecall']:.1%} "
                f"concepts={row['ratios']['concepts']:.2f}"
            )
        gate = results.get('eval') or eval_report
        passed = gate['passed']
        print(f'Report: {report_path}')
        return 0 if passed else 1

    snapshots = load_snapshots(args.snapshots, course_ids)
    if not snapshots:
        print(f'No snapshots for courses {course_ids} in {args.snapshots}', file=sys.stderr)
        return 1

    if args.dry_run:
        clear_parser_env()
        apply_fast_reparse_env()
        print_active_parser_tuning()
        auth = load_auth_from_env(ROOT)
        per_course = build_batches(snapshots, auth.base_url or 'https://princeton.instructure.com')
        merged = merge_parser_batches_by_type(per_course)
        chunked = chunk_parser_batches(merged)
        print(f'Benchmark courses: {course_ids}')
        print(f'Batch scope: {summarize_batch_scope(per_course)}')
        print(f'Per-course stdin lines: {len(per_course)}')
        print(f'Merged-by-type lines: {len(merged)}')
        print(f'After chunk (PARSER_MAX_BATCH_ITEMS={os.environ.get("PARSER_MAX_BATCH_ITEMS")}): {len(chunked)}')
        for line in chunked:
            print(f"  {line.get('type')}: {len(line.get('content') or [])} items")
        quality_meta = load_quality_meta()
        if quality_meta:
            print(f"Quality baseline timing: {quality_meta.get('elapsed_min')} min")
        return 0

    run_baseline = args.baseline or args.all
    run_fast = args.fast or args.all
    run_eval = args.eval or args.all

    auth = load_auth_from_env(ROOT)
    batches = build_batches(snapshots, auth.base_url or 'https://princeton.instructure.com')
    fast_batches = merge_parser_batches_by_type(batches)
    scope = summarize_batch_scope(batches)
    print(f'Benchmark courses: {course_ids}')
    print(f'Batch scope: {scope}')
    if run_fast:
        print(
            f'Fast batch lines: {len(batches)} course-wise -> {len(fast_batches)} merged-by-type '
            f'(files={sum(len(b.get("content") or []) for b in fast_batches if b.get("type") == "file")})'
        )
    print(f'Eval baseline: {quality_baseline_path.name if quality_baseline_path.is_file() else "run --baseline first"}')

    results: dict = {'courses': course_ids, 'scope': scope}
    if run_baseline:
        print('Running quality baseline parse (same GT snapshots as fast)...')
        preflight_deepseek_api(ROOT)
        results['baseline'] = run_parse(
            batches,
            fast=False,
            timeout_seconds=args.timeout,
            out_path=quality_baseline_path,
        )
        print(f"Baseline finished in {results['baseline']['elapsed_min']} min")
        write_quality_meta({
            'elapsed_sec': results['baseline']['elapsed_sec'],
            'elapsed_min': results['baseline']['elapsed_min'],
            'graph_path': str(quality_baseline_path),
        })

    if run_fast:
        print('Running fast parse...')
        preflight_deepseek_api(ROOT)
        results['fast'] = run_parse(
            fast_batches,
            fast=True,
            timeout_seconds=args.timeout,
            out_path=fast_path,
        )
        print(f"Fast finished in {results['fast']['elapsed_min']} min")
        if os.getenv('PARSER_DEFER_FILE_EMBED') == '1':
            print('Deferred embed — run: python scripts/reembed_graph.py')

    if run_eval:
        if not fast_path.is_file():
            print('Need fast graph for eval. Run: python scripts/run_parse_speed_benchmark.py --fast', file=sys.stderr)
            return 1
        candidate = json.loads(fast_path.read_text(encoding='utf-8'))
        course_id_strs = [str(course_id) for course_id in course_ids]
        if FIXTURE_MANIFEST.is_file():
            fixture_report = eval_against_manifest(
                candidate,
                load_manifest(FIXTURE_MANIFEST),
                course_ids=course_id_strs,
            )
            results['fixtureEval'] = fixture_report
            eval_baseline_path = quality_baseline_path if quality_baseline_path.is_file() else baseline_path
            if eval_baseline_path.is_file():
                baseline = json.loads(eval_baseline_path.read_text(encoding='utf-8'))
                quality_report = evaluate_graphs(baseline, candidate, course_id_strs)
                results['eval'] = quality_report
                eval_report = quality_report
                print(f"Quality baseline eval: {'PASS' if quality_report['passed'] else 'FAIL'}")
            else:
                eval_report = fixture_report
            print(f"Fixture eval ({FIXTURE_MANIFEST.name}): {'PASS' if fixture_report['passed'] else 'FAIL'}")
        else:
            eval_baseline_path = quality_baseline_path if quality_baseline_path.is_file() else baseline_path
            if not eval_baseline_path.is_file():
                print('Need fixture manifest or baseline graph for eval.', file=sys.stderr)
                return 1
            baseline = json.loads(eval_baseline_path.read_text(encoding='utf-8'))
            eval_report = evaluate_graphs(baseline, candidate, course_id_strs)
        results['eval'] = eval_report
        if results.get('baseline') and results.get('fast'):
            base_min = results['baseline']['elapsed_min']
            fast_min = results['fast']['elapsed_min']
            results['speedup'] = round(base_min / fast_min, 2) if fast_min else None
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(results, indent=2, default=str), encoding='utf-8')
        print(f"Eval: {'PASS' if eval_report['passed'] else 'FAIL'}")
        if results.get('speedup'):
            print(f"Speedup: {results['speedup']}x ({base_min:.1f}m -> {fast_min:.1f}m)")
        print(f'Report: {report_path}')
        return 0 if eval_report['passed'] else 1

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(results, indent=2, default=str), encoding='utf-8')
    print(f'Report: {report_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
