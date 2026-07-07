#!/usr/bin/env python3
"""Resilient multi-course reparse: per-course batches, retries, guardrails, checkpoints."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.balance_guard import preflight_deepseek_api  # noqa: E402
from canvas_parser.parse.parse_health import validate_graph_checkpoint  # noqa: E402
from canvas_parser.weekly_iteration.auth import load_auth_from_env  # noqa: E402
from canvas_parser.weekly_iteration.llm_parse import run_parser_batches  # noqa: E402
from canvas_parser.parse.parse_modes import apply_llm_mode, print_active_parse_mode  # noqa: E402
from scripts.run_full_reparse_canvas_data import (  # noqa: E402
    backup_graph,
    load_batches,
    print_parse_stats_report,
)

DEFAULT_8_COURSES = [18857, 15160, 19971, 15222, 14788, 17581, 17239, 20640]
BENCHMARK_3_COURSE_IDS = [18857, 15160, 19971]
REPORT_PATH = ROOT / '.cache' / 'graph_eval' / 'resilient_reparse_report.json'

# Slow / linked-heavy courses need longer subprocess timeouts.
COURSE_TIMEOUT_OVERRIDES: dict[int, int] = {
    15222: 5400,
    20640: 3600,
    15160: 3600,
}

RETRY_CONCURRENCY = {
    'PARSE_MAX_CONCURRENT': '12',
    'DEEPSEEK_MAX_CONCURRENT': '14',
}


def kill_parser_processes() -> int:
    """Terminate stray parser.py subprocesses (Windows-safe)."""
    script = (
        "Get-CimInstance Win32_Process -Filter \"name='python.exe'\" | "
        "Where-Object { $_.CommandLine -like '*parser.py*' } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }"
    )
    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command', script],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        pids = [line.strip() for line in (result.stdout or '').splitlines() if line.strip().isdigit()]
        return len(pids)
    except Exception as error:
        print(f'Could not kill parser processes: {error}', file=sys.stderr)
        return 0


def apply_resilient_env(*, retry: bool = False) -> None:
    apply_llm_mode()
    os.environ.setdefault('PARSER_HEURISTIC_CONCEPTS', '0')
    os.environ.setdefault('PARSER_HEURISTIC_MAX_PER_FILE', '80')
    os.environ.setdefault('PARSER_FILE_TIMEOUT_SEC', '480')
    os.environ.setdefault('PARSER_LLM_RETRY_DELAYS_SEC', '2,5,15')
    os.environ.setdefault('DEEPSEEK_TIMEOUT_SECONDS', '120')
    os.environ.setdefault('PARSER_ABORT_ON_BALANCE', '1')
    if retry:
        os.environ.update(RETRY_CONCURRENCY)
    else:
        os.environ.setdefault('PARSE_MAX_CONCURRENT', '16')
        os.environ.setdefault('DEEPSEEK_MAX_CONCURRENT', '18')


def linked_mode_for_batches(_batches) -> str:
    return 'full'


def seed_graph_from(path: Path) -> None:
    graph_path = ROOT / 'canvas_graph.json'
    if not path.is_file():
        raise FileNotFoundError(f'Seed graph not found: {path}')
    if path.resolve() == graph_path.resolve():
        print(f'Resuming existing graph at {graph_path}')
        return
    shutil.copy2(path, graph_path)
    print(f'Seeded graph from {path}')


def course_timeout(course_id: int, default: int) -> int:
    return COURSE_TIMEOUT_OVERRIDES.get(int(course_id), default)


def run_single_course(
    course_id: int,
    *,
    timeout_seconds: int,
    resume: bool,
    auth,
) -> dict:
    batches, _ = load_batches(ROOT, course_ids=[course_id])
    linked_mode = linked_mode_for_batches(batches)
    os.environ['PARSER_LINKED_FILE_MODE'] = linked_mode
    started = time.perf_counter()
    run_parser_batches(
        batches,
        ROOT,
        auth,
        timeout_seconds=timeout_seconds,
        keep_graph=True,
        resume_graph=resume,
        restore_on_failure=False,
    )
    elapsed = time.perf_counter() - started
    graph_path = ROOT / 'canvas_graph.json'
    health = validate_graph_checkpoint(graph_path)
    return {
        'courseId': course_id,
        'status': 'ok',
        'elapsedSec': round(elapsed, 1),
        'linkedMode': linked_mode,
        'health': health,
    }


def run_heuristic_evals() -> dict:
    out: dict = {}
    for label, args in (
        ('benchmark3', ['--manifest', 'fixtures/parse_quality/benchmark_baseline.json']),
        ('newBase', ['--new-base']),
    ):
        try:
            result = subprocess.run(
                [sys.executable, str(ROOT / 'scripts' / 'eval_heuristic_concepts.py'), *args],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
                timeout=3600,
            )
            out[label] = {
                'exitCode': result.returncode,
                'stdout': (result.stdout or '')[-2000:],
                'stderr': (result.stderr or '')[-1000:],
            }
        except Exception as error:
            out[label] = {'exitCode': -1, 'error': str(error)}
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--courses',
        type=int,
        nargs='*',
        default=DEFAULT_8_COURSES,
        help='Course IDs to parse one-at-a-time',
    )
    parser.add_argument(
        '--timeout-per-course',
        type=int,
        default=2700,
        help='Default parser subprocess timeout per course (seconds)',
    )
    parser.add_argument('--max-retries', type=int, default=2, help='Attempts per course on failure')
    parser.add_argument('--skip-preflight', action='store_true')
    parser.add_argument('--skip-kill', action='store_true')
    parser.add_argument('--skip-heuristic-eval', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument(
        '--require-all',
        action='store_true',
        help='Exit 1 unless every course completes successfully',
    )
    parser.add_argument(
        '--resume',
        action='store_true',
        help='Resume from existing canvas_graph.json (no wipe; skip seed copy)',
    )
    parser.add_argument(
        '--seed-graph',
        type=Path,
        default=None,
        help='Start from an existing graph (resume all courses; no wipe on course 1)',
    )
    args = parser.parse_args()

    apply_resilient_env()
    print_active_parse_mode()

    if not args.skip_kill:
        killed = kill_parser_processes()
        if killed:
            print(f'Killed {killed} stray parser.py process(es)')
        time.sleep(2)

    course_ids = list(args.courses)
    print(f'Resilient reparse courses ({len(course_ids)}): {course_ids}')

    if args.dry_run:
        from canvas_parser.parse.course_scope import summarize_batch_scope

        for cid in course_ids:
            batches, _ = load_batches(ROOT, course_ids=[cid])
            print(f'  course {cid}: {summarize_batch_scope(batches)} timeout={course_timeout(cid, args.timeout_per_course)}s')
        return 0

    if not args.skip_preflight:
        preflight_deepseek_api(ROOT)

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    seeded = False
    if args.seed_graph and not args.resume:
        seed_graph_from(args.seed_graph.resolve())
        seeded = True
    elif args.resume and (ROOT / 'canvas_graph.json').is_file():
        print('Resume mode: keeping existing canvas_graph.json')
        seeded = True
    backup = backup_graph(ROOT, label='pre_resilient_reparse')
    if backup:
        print(f'Backed up graph to {backup.name}')

    auth = load_auth_from_env(ROOT)
    started = time.perf_counter()
    results: list[dict] = []
    aborted_balance = False
    graph_path = ROOT / 'canvas_graph.json'

    for index, course_id in enumerate(course_ids):
        timeout = course_timeout(course_id, args.timeout_per_course)
        resume = (seeded or index > 0 or bool(args.seed_graph) or args.resume) and graph_path.is_file()
        print(f'\n=== Course {course_id} ({index + 1}/{len(course_ids)}) resume={resume} timeout={timeout}s ===')

        last_error = ''
        for attempt in range(args.max_retries):
            if attempt:
                print(f'Retry {attempt + 1}/{args.max_retries} for course {course_id}')
                apply_resilient_env(retry=True)
                if not args.skip_kill:
                    kill_parser_processes()
                    time.sleep(3)
            try:
                row = run_single_course(
                    course_id,
                    timeout_seconds=timeout,
                    resume=resume,
                    auth=auth,
                )
                row['attempts'] = attempt + 1
                results.append(row)
                print(f'Course {course_id} finished in {row["elapsedSec"] / 60:.1f} min health={row["health"]}')
                course_backup = backup_graph(ROOT, label=f'post_course_{course_id}')
                if course_backup:
                    print(f'Checkpoint: {course_backup.name}')
                break
            except RuntimeError as error:
                last_error = str(error)
                status = 'balance_abort' if '402' in last_error or 'balance' in last_error.casefold() else 'failed'
                if status == 'balance_abort':
                    results.append({
                        'courseId': course_id,
                        'status': status,
                        'error': last_error,
                        'attempts': attempt + 1,
                    })
                    aborted_balance = True
                    break
                if attempt + 1 >= args.max_retries:
                    results.append({
                        'courseId': course_id,
                        'status': status,
                        'error': last_error,
                        'attempts': attempt + 1,
                    })
                    print(f'Course {course_id} failed after {args.max_retries} attempts: {last_error}', file=sys.stderr)
            except (ValueError, FileNotFoundError, json.JSONDecodeError) as error:
                last_error = str(error)
                results.append({
                    'courseId': course_id,
                    'status': 'corrupt_graph',
                    'error': last_error,
                    'attempts': attempt + 1,
                })
                print(f'Course {course_id} checkpoint invalid: {last_error}', file=sys.stderr)
                break
        if aborted_balance:
            break

    total_elapsed = time.perf_counter() - started
    if graph_path.is_file():
        try:
            from scripts.postprocess_parse_graph import postprocess_graph  # noqa: WPS433

            graph = json.loads(graph_path.read_text(encoding='utf-8'))
            graph = postprocess_graph(graph)
            graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')
            final_health = validate_graph_checkpoint(graph_path)
            print(f'Applied postprocess_graph health={final_health}')
        except Exception as error:
            print(f'Postprocess failed: {error}', file=sys.stderr)
            final_health = None
    else:
        final_health = None

    ok_count = sum(1 for row in results if row.get('status') == 'ok')
    failed_ids = [row['courseId'] for row in results if row.get('status') != 'ok']

    report = {
        'courses': course_ids,
        'results': results,
        'elapsedSec': round(total_elapsed, 1),
        'elapsedMin': round(total_elapsed / 60, 2),
        'abortedBalance': aborted_balance,
        'okCount': ok_count,
        'failedCourseIds': failed_ids,
        'graphPath': str(graph_path) if graph_path.is_file() else None,
        'finalHealth': final_health,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f'\nResilient reparse report: {REPORT_PATH}')
    print_parse_stats_report(ROOT)
    print(f'Completed {ok_count}/{len(course_ids)} courses in {total_elapsed / 60:.1f} min')
    if failed_ids:
        print(f'Failed courses (retry manually): {failed_ids}')

    if graph_path.is_file() and ok_count >= len(BENCHMARK_3_COURSE_IDS):
        try:
            gate = subprocess.run(
                [sys.executable, str(ROOT / 'scripts' / 'run_8course_budget_gate.py'), '--repostprocess'],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
                timeout=300,
            )
            print(gate.stdout or '', end='')
            if gate.stderr:
                print(gate.stderr, file=sys.stderr, end='')
            report['gateExitCode'] = gate.returncode
            gate_report_path = ROOT / '.cache' / 'graph_eval' / 'budget_8course_report.json'
            if gate_report_path.is_file():
                report['gate'] = json.loads(gate_report_path.read_text(encoding='utf-8'))
        except Exception as error:
            print(f'Gate eval failed: {error}', file=sys.stderr)

    if not args.skip_heuristic_eval and graph_path.is_file():
        print('\n=== Heuristic concept eval (guardrailed) ===')
        report['heuristicEval'] = run_heuristic_evals()
        REPORT_PATH.write_text(json.dumps(report, indent=2), encoding='utf-8')

    if args.require_all:
        success = ok_count == len(course_ids) and not aborted_balance
    else:
        success = ok_count > 0 and not aborted_balance
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
