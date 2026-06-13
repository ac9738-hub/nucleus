"""Evaluate weekly schedule parsing and emit a structured miss report for cloud agent iteration."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .auth import load_auth_from_env
from .course_match import find_snapshot_for_ground_truth, parse_ground_truth_filename
from .evaluate import evaluate_snapshots
from .fetch import load_snapshots
from .llm_parse import run_parser_for_snapshots
from .paths import default_graph_cache_path, default_report_path, default_snapshot_path


def _ground_truth_snapshots(snapshots: list[dict], gt_dir: Path) -> list[dict]:
    selected = []
    for gt_path in sorted(gt_dir.glob('*.json')):
        spec = parse_ground_truth_filename(gt_path.name)
        snapshot = find_snapshot_for_ground_truth(snapshots, spec)
        if snapshot:
            selected.append(snapshot)
    return selected


def _load_graph(root: Path, args: argparse.Namespace) -> dict:
    if args.graph_cache:
        graph_path = Path(args.graph_cache)
        if not graph_path.is_absolute():
            graph_path = root / graph_path
        return json.loads(graph_path.read_text(encoding='utf-8'))

    if not args.llm:
        return {}

    graph_path = default_graph_cache_path(root)
    if graph_path.is_file() and not args.refresh_graph:
        print(f'Using cached parser graph: {graph_path}')
        return json.loads(graph_path.read_text(encoding='utf-8'))

    auth = load_auth_from_env(root)
    snapshot_path = Path(args.snapshot)
    if not snapshot_path.is_absolute():
        snapshot_path = root / snapshot_path
    snapshots = load_snapshots(snapshot_path)
    gt_snapshots = _ground_truth_snapshots(snapshots, root / args.ground_truth_dir)
    if not gt_snapshots:
        raise SystemExit('No ground-truth courses matched in snapshots.')
    print(f'Running parser.py for {len(gt_snapshots)} ground-truth course(s)...')
    graph = run_parser_for_snapshots(gt_snapshots, root, auth)
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text(json.dumps(graph, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Wrote parser graph to {graph_path}')
    return graph


def _build_report(results, aggregate: float, *, mode: str, target: float) -> dict:
    courses = []
    for result in results:
        weekly = result.sections.get('weekly_schedule')
        courses.append({
            'ground_truth_file': result.ground_truth_file,
            'course_label': result.course_label,
            'accuracy': round(result.accuracy, 4),
            'weekly_accuracy': round(weekly.accuracy, 4) if weekly else None,
            'weekly_matched': weekly.matched if weekly else 0,
            'weekly_total': weekly.total if weekly else 0,
            'misses': weekly.misses if weekly else [],
        })
    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'mode': mode,
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
    parser.add_argument('--target', type=float, default=0.90)
    parser.add_argument('--llm', action='store_true', help='Enrich weekly events from parser graph')
    parser.add_argument('--graph-cache', help='Use cached parser graph instead of re-running parser.py')
    parser.add_argument('--refresh-graph', action='store_true', help='Re-run parser.py even if cache exists')
    args = parser.parse_args(argv)

    root = Path(args.root)
    gt_dir = root / args.ground_truth_dir
    snapshot_path = Path(args.snapshot)
    if not snapshot_path.is_absolute():
        snapshot_path = root / snapshot_path
    if not snapshot_path.is_file():
        print(f'Snapshot not found: {snapshot_path}', file=sys.stderr)
        print(
            'Fetch once with: python -m canvas_parser.weekly_iteration.fetch_snapshots --enrich-pages',
            file=sys.stderr,
        )
        return 2

    snapshots = load_snapshots(snapshot_path)
    graph = _load_graph(root, args)
    mode = 'heuristic+parser_graph' if args.llm else 'heuristic_only'

    results = evaluate_snapshots(
        snapshots,
        gt_dir,
        graph=graph,
        root_dir=root,
        use_llm_weekly=args.llm,
        weekly_only=True,
    )

    aggregate = sum(result.accuracy for result in results) / len(results) if results else 0.0
    report = _build_report(results, aggregate, mode=mode, target=args.target)

    report_path = Path(args.report)
    if not report_path.is_absolute():
        report_path = root / report_path
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')

    print(f'\nWeekly schedule accuracy: {aggregate * 100:.1f}% (target {args.target * 100:.0f}%)')
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
