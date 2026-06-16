"""Evaluate weekly schedule parsing and emit a structured miss report for cloud agent iteration."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from .auth import load_auth_from_env, load_env_file
from .course_match import find_snapshot_for_ground_truth, iter_ground_truth_files, parse_ground_truth_filename
from .evaluate import evaluate_snapshots
from .fetch import load_snapshots
from .llm_parse import run_parser_for_snapshots
from .paths import (
    default_report_path,
    default_snapshot_path,
)
from .students import StudentProfile, get_profile, holdout_profile


def _ground_truth_snapshots(snapshots: list[dict], gt_dir: Path) -> list[dict]:
    selected = []
    for gt_path in iter_ground_truth_files(gt_dir):
        spec = parse_ground_truth_filename(gt_path.name)
        snapshot = find_snapshot_for_ground_truth(snapshots, spec)
        if snapshot:
            selected.append(snapshot)
    return selected


def _resolve_snapshot_path(root: Path, snapshot_arg: str, profile: StudentProfile) -> Path:
    snapshot_path = Path(snapshot_arg)
    if not snapshot_path.is_absolute():
        snapshot_path = root / snapshot_path
    if snapshot_path.is_file():
        return snapshot_path
    fixture_path = profile.fixture_snapshot_path
    if fixture_path.is_file():
        print(f'Using committed fixture snapshot: {fixture_path}')
        return fixture_path
    raise FileNotFoundError(snapshot_path)


def _parser_keys_available(root: Path) -> bool:
    env_values = load_env_file(root / '.env')
    return bool(
        os.getenv('DEEP_SEEK_API_KEY') or env_values.get('DEEP_SEEK_API_KEY')
    )


def _build_graph_cache(
    root: Path,
    snapshot_path: Path,
    ground_truth_dir: Path,
    graph_path: Path,
    *,
    profile_name: str,
) -> dict:
    profile_obj = get_profile(root, profile_name)
    auth = load_auth_from_env(root, profile=profile_name)
    if not auth.is_valid:
        raise SystemExit(
            f'Canvas auth for profile {profile_name!r} is missing. '
            f'Set {profile_obj.auth_cookie_env} and {profile_obj.base_url_env} in .env.'
        )
    snapshots = load_snapshots(snapshot_path)
    gt_snapshots = _ground_truth_snapshots(snapshots, ground_truth_dir)
    if not gt_snapshots:
        raise SystemExit('No ground-truth courses matched in snapshots.')
    print(f'Running parser.py for {len(gt_snapshots)} ground-truth course(s) [{profile_name}]...')
    graph = run_parser_for_snapshots(gt_snapshots, root, auth)
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text(json.dumps(graph, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Wrote parser graph to {graph_path}')
    return graph


def _load_graph(
    root: Path,
    args: argparse.Namespace,
    snapshot_path: Path,
    profile: StudentProfile,
) -> dict:
    if args.graph_cache:
        graph_path = Path(args.graph_cache)
        if not graph_path.is_absolute():
            graph_path = root / graph_path
        return json.loads(graph_path.read_text(encoding='utf-8'))

    if not args.llm:
        return {}

    graph_path = profile.graph_cache_path
    if graph_path.is_file() and not args.refresh_graph:
        print(f'Using cached parser graph: {graph_path}')
        return json.loads(graph_path.read_text(encoding='utf-8'))

    should_build = args.refresh_graph or args.ensure_graph
    if not should_build:
        print(
            'Parser graph cache missing; continuing with heuristics only '
            '(pass --ensure-graph or --refresh-graph; needs DEEP_SEEK_API_KEY).',
            file=sys.stderr,
        )
        return {}

    if not _parser_keys_available(root):
        print(
            'DEEP_SEEK_API_KEY is not set; cannot build parser graph cache.',
            file=sys.stderr,
        )
        return {}

    return _build_graph_cache(
        root,
        snapshot_path,
        profile.ground_truth_dir,
        graph_path,
        profile_name=profile.name,
    )


def _build_report(results, aggregate: float, *, mode: str, target: float, label: str = 'weekly') -> dict:
    courses = []
    for result in results:
        weekly = result.sections.get('weekly_schedule')
        courses.append({
            'ground_truth_file': result.ground_truth_file,
            'course_label': result.course_label,
            'accuracy': round(result.accuracy, 4),
            'weekly_accuracy': round(weekly.accuracy, 4) if weekly and weekly.total else None,
            'weekly_matched': weekly.matched if weekly else 0,
            'weekly_total': weekly.total if weekly else 0,
            'weekly_misses': weekly.misses if weekly else [],
            'sections': {
                name: {
                    'matched': section.matched,
                    'total': section.total,
                    'accuracy': round(section.accuracy, 4),
                    'misses': section.misses,
                }
                for name, section in result.sections.items()
            },
        })
    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'mode': mode,
        'label': label,
        'aggregate_weekly_accuracy': round(aggregate, 4),
        'target': target,
        'passed': aggregate >= target,
        'courses': courses,
    }


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]

    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')

    parser = argparse.ArgumentParser(description='Weekly schedule iteration harness.')
    parser.add_argument('--root', default=str(root))
    parser.add_argument('--ground-truth-dir', default='ground-truth')
    parser.add_argument('--snapshot', default=str(default_snapshot_path(root)))
    parser.add_argument('--report', default=str(default_report_path(root)))
    parser.add_argument('--target', type=float, default=0.97)
    parser.add_argument('--llm', action='store_true', help='Enrich weekly events from parser graph')
    parser.add_argument('--graph-cache', help='Use cached parser graph instead of re-running parser.py')
    parser.add_argument('--refresh-graph', action='store_true', help='Re-run parser.py even if cache exists')
    parser.add_argument(
        '--ensure-graph',
        action='store_true',
        help='Build parser graph cache when missing (needs DEEP_SEEK_API_KEY)',
    )
    parser.add_argument(
        '--holdout',
        action='store_true',
        help='Evaluate holdout ground truth (ground-truth/holdout/) without affecting main score',
    )
    args = parser.parse_args(argv)

    root = Path(args.root)
    profile = holdout_profile(root) if args.holdout else get_profile(root, 'primary')
    gt_dir = profile.ground_truth_dir
    default_snapshot = profile.snapshot_path
    default_report = profile.report_path
    report_label = profile.name if profile.name != 'primary' else 'weekly'

    snapshot_arg = (
        args.snapshot
        if args.snapshot != str(default_snapshot_path(root))
        else str(default_snapshot)
    )
    report_arg = (
        args.report
        if args.report != str(default_report_path(root))
        else str(default_report)
    )
    try:
        snapshot_path = _resolve_snapshot_path(root, snapshot_arg, profile)
    except FileNotFoundError:
        if args.holdout:
            fixture = profile.fixture_snapshot_path
            if fixture.is_file():
                snapshot_path = fixture
            else:
                course_ids = ' '.join(f'--course-id {cid}' for cid in profile.canvas_course_ids)
                print(f'Holdout snapshot not found: {root / snapshot_arg}', file=sys.stderr)
                print(
                    'Fetch with: python -m canvas_parser.weekly_iteration.fetch_snapshots '
                    f'--holdout {course_ids} --enrich-pages',
                    file=sys.stderr,
                )
                print(
                    f'Set {profile.auth_cookie_env} (and optional {profile.auth_csrf_env}) in .env.',
                    file=sys.stderr,
                )
                return 2
        else:
            print(f'Snapshot not found: {root / snapshot_arg}', file=sys.stderr)
            print(
                'Fetch once with: python -m canvas_parser.weekly_iteration.fetch_snapshots --enrich-pages',
                file=sys.stderr,
            )
            return 2

    snapshots = load_snapshots(snapshot_path)
    graph = _load_graph(root, args, snapshot_path, profile)
    mode = 'heuristic+parser_graph' if args.llm else 'heuristic_only'

    results = evaluate_snapshots(
        snapshots,
        gt_dir,
        graph=graph,
        root_dir=root,
        use_llm_weekly=args.llm,
        weekly_only=True,
        strict_weekly=args.holdout,
    )

    weekly_results = [
        result for result in results
        if (result.sections.get('weekly_schedule') and result.sections['weekly_schedule'].total > 0)
    ]
    aggregate = (
        sum(result.accuracy for result in weekly_results) / len(weekly_results)
        if weekly_results else 0.0
    )
    report = _build_report(results, aggregate, mode=mode, target=args.target, label=report_label)

    report_path = Path(report_arg)
    if not report_path.is_absolute():
        report_path = root / report_path
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')

    print(f'\n{report_label.title()} schedule accuracy: {aggregate * 100:.1f}% (target {args.target * 100:.0f}%)')
    print(f'Report: {report_path}')
    for course in report['courses']:
        weekly_accuracy = course.get('weekly_accuracy')
        if weekly_accuracy is None:
            print(f"  {course['ground_truth_file']}: n/a")
            continue
        print(
            f"  {course['ground_truth_file']}: {weekly_accuracy * 100:.1f}% "
            f"({course['weekly_matched']}/{course['weekly_total']})"
        )
    return 0 if report['passed'] else 1
