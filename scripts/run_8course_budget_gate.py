#!/usr/bin/env python3
"""Evaluate the 8-course parser budget gate (time, cost, 3-course quality)."""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.extract.validate import assess_graph_retrieval_completeness  # noqa: E402
from canvas_parser.parse.parse_cost import assess_completed_model_calls  # noqa: E402
from scripts.eval_graph_parse import extract_course_subgraph  # noqa: E402
from scripts.eval_parse_quality import eval_against_manifest, load_manifest  # noqa: E402
from scripts.postprocess_parse_graph import postprocess_graph  # noqa: E402

BUDGET_8_COURSE_IDS = [18857, 15160, 19971, 15222, 14788, 17581, 17239, 20640]
BENCHMARK_3_COURSE_IDS = [18857, 15160, 19971]
FIXTURE_MANIFEST = ROOT / 'fixtures' / 'parse_quality' / 'benchmark_baseline.json'
DEFAULT_GRAPH = ROOT / 'canvas_graph.json'
DEFAULT_REPORT = ROOT / '.cache' / 'graph_eval' / 'budget_8course_report.json'

TIME_LIMIT_SEC = 3600
COST_LIMIT_USD = 3.0


def load_graph(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def parse_wall_seconds(graph: dict) -> float | None:
    completed = graph.get('completed_model_calls') or {}
    session = completed.get('parse_session_summary') or {}
    wall_ms = session.get('wall_ms')
    if wall_ms is not None:
        return float(wall_ms) / 1000.0
    wall_sec = session.get('wall_sec')
    if wall_sec is not None:
        return float(wall_sec)
    return None


def evaluate_gate(
    graph_path: Path,
    *,
    elapsed_sec: float | None = None,
    repostprocess: bool = False,
) -> dict:
    graph = load_graph(graph_path)
    if repostprocess or not (graph.get('meta') or {}).get('postprocess'):
        graph = postprocess_graph(graph)

    wall_sec = elapsed_sec if elapsed_sec is not None else parse_wall_seconds(graph)
    cost_report = assess_completed_model_calls(graph.get('completed_model_calls') or {})
    total_cost = float(cost_report.get('total_cost_usd') or 0.0)

    benchmark_ids = [str(course_id) for course_id in BENCHMARK_3_COURSE_IDS]
    fixture_report = None
    if FIXTURE_MANIFEST.is_file():
        fixture_report = eval_against_manifest(
            graph,
            load_manifest(FIXTURE_MANIFEST),
            course_ids=benchmark_ids,
        )

    scoped = extract_course_subgraph(graph, [str(course_id) for course_id in BUDGET_8_COURSE_IDS])
    completeness = assess_graph_retrieval_completeness(scoped)

    time_pass = wall_sec is None or wall_sec < TIME_LIMIT_SEC
    cost_pass = total_cost < COST_LIMIT_USD
    quality_pass = bool(fixture_report and fixture_report.get('benchmarkPassed'))
    passed = time_pass and cost_pass and quality_pass

    return {
        'courseIds': BUDGET_8_COURSE_IDS,
        'benchmarkCourseIds': BENCHMARK_3_COURSE_IDS,
        'graphPath': str(graph_path),
        'wallSec': round(wall_sec, 1) if wall_sec is not None else None,
        'wallMin': round(wall_sec / 60.0, 2) if wall_sec is not None else None,
        'totalCostUsd': round(total_cost, 4),
        'timePass': time_pass,
        'costPass': cost_pass,
        'qualityPass': quality_pass,
        'passed': passed,
        'limits': {
            'wallSec': TIME_LIMIT_SEC,
            'costUsd': COST_LIMIT_USD,
        },
        'fixtureEval': fixture_report,
        'completeness8': completeness,
        'cost': {
            'fileCount': cost_report.get('file_count'),
            'totalCostUsd': cost_report.get('total_cost_usd'),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=DEFAULT_GRAPH)
    parser.add_argument('--report', type=Path, default=DEFAULT_REPORT)
    parser.add_argument('--elapsed-sec', type=float, default=None, help='Override wall time when graph lacks session meta')
    parser.add_argument('--repostprocess', action='store_true')
    args = parser.parse_args()

    if not args.graph.is_file():
        print(f'Missing graph: {args.graph}', file=sys.stderr)
        return 1

    started = time.perf_counter()
    report = evaluate_gate(
        args.graph,
        elapsed_sec=args.elapsed_sec,
        repostprocess=args.repostprocess,
    )
    report['evalElapsedSec'] = round(time.perf_counter() - started, 1)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding='utf-8')

    print(f"8-course budget gate: {'PASS' if report['passed'] else 'FAIL'}")
    if report['wallMin'] is not None:
        print(f"  wall time: {report['wallMin']} min (limit {TIME_LIMIT_SEC / 60:.0f} min)")
    print(f"  cost: ${report['totalCostUsd']:.4f} (limit ${COST_LIMIT_USD:.2f})")
    if report.get('fixtureEval'):
        print(f"  3-course quality: {'PASS' if report['qualityPass'] else 'FAIL'}")
        for row in report['fixtureEval'].get('courses') or []:
            print(
                f"    course {row['courseId']}: "
                f"{'PASS' if row['passed'] else 'FAIL'} "
                f"recall={row.get('conceptTitleRecall', 0):.1%} "
                f"concepts={row.get('ratios', {}).get('concepts', 0):.2f}x"
            )
    print(f'Report: {args.report}')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
