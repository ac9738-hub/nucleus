#!/usr/bin/env python3
"""Evaluate a parse graph against the frozen parse-quality baseline."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.extract.validate import assess_graph_retrieval_completeness  # noqa: E402
from scripts.eval_graph_parse import (  # noqa: E402
    compare_course_to_manifest_row,
    evaluate_graphs,
    extract_course_subgraph,
)

DEFAULT_MANIFEST = ROOT / 'fixtures' / 'parse_quality' / 'baseline.json'


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def load_graph(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def baseline_graph_from_manifest(manifest: dict, root: Path) -> dict:
    course_ids = [str(course_id) for course_id in manifest.get('courseIds') or []]
    if manifest.get('includeSubgraphs') and (root / 'fixtures' / 'parse_quality' / 'courses').is_dir():
        merged = {
            'concepts': [],
            'events': [],
            'problems': [],
            'files': {},
            'syllabi': {},
            'learningBlocks': {},
        }
        courses_dir = root / 'fixtures' / 'parse_quality' / 'courses'
        for course_id in course_ids:
            path = courses_dir / f'{course_id}.json'
            if not path.is_file():
                continue
            subgraph = load_graph(path)
            merged['concepts'].extend(subgraph.get('concepts') or [])
            merged['events'].extend(subgraph.get('events') or [])
            merged['problems'].extend(subgraph.get('problems') or [])
            merged['files'].update(subgraph.get('files') or {})
            merged['syllabi'].update(subgraph.get('syllabi') or {})
            merged['learningBlocks'].update(subgraph.get('learningBlocks') or {})
        if merged['concepts'] or merged['files']:
            return merged
    source = Path(str(manifest.get('sourceGraph') or ''))
    if source.is_file():
        state = load_graph(source)
        return extract_course_subgraph(state, course_ids)
    raise FileNotFoundError('Baseline subgraphs missing and sourceGraph not available')


def eval_against_manifest(
    candidate: dict,
    manifest: dict,
    *,
    course_ids: list[str] | None = None,
) -> dict:
    thresholds = dict(manifest.get('thresholds') or {})
    eval_course_ids = course_ids or [str(course_id) for course_id in manifest.get('courseIds') or []]
    manifest_rows = {
        str(row.get('courseId') or ''): row
        for row in (manifest.get('courses') or [])
    }
    use_manifest_rows = not manifest.get('includeSubgraphs', True)
    courses_dir = ROOT / 'fixtures' / 'parse_quality' / 'courses'
    if not use_manifest_rows and courses_dir.is_dir():
        sample = courses_dir / f'{eval_course_ids[0]}.json' if eval_course_ids else None
        use_manifest_rows = not (sample and sample.is_file())

    if use_manifest_rows:
        per_course = [
            compare_course_to_manifest_row(manifest_rows[course_id], candidate, course_id)
            for course_id in eval_course_ids
            if course_id in manifest_rows
        ]
        scoped = extract_course_subgraph(candidate, eval_course_ids)
        completeness = assess_graph_retrieval_completeness(scoped)
        from canvas_parser.extract.validate import validate_graph_state
        warnings = validate_graph_state(scoped)
        passed = all(row['passed'] for row in per_course)
        report = {
            'courseIds': eval_course_ids,
            'passed': passed,
            'courses': per_course,
            'completeness': completeness,
            'validationWarningCount': len(warnings),
            'validationWarningsSample': warnings[:20],
            'baselineMode': 'manifest',
        }
    else:
        baseline = baseline_graph_from_manifest(manifest, ROOT)
        report = evaluate_graphs(baseline, candidate, eval_course_ids)
        report['baselineMode'] = 'subgraph'

    benchmark_ids = [str(course_id) for course_id in manifest.get('benchmarkCourseIds') or []]
    benchmark_rows = [row for row in report['courses'] if row['courseId'] in benchmark_ids]
    benchmark_passed = all(row['passed'] for row in benchmark_rows) if benchmark_rows else report['passed']

    report['manifest'] = {
        'path': str(manifest.get('sourceGraph') or ''),
        'createdAt': manifest.get('createdAt'),
        'thresholds': thresholds,
    }
    report['benchmarkCourseIds'] = benchmark_ids
    report['benchmarkPassed'] = benchmark_passed
    report['passed'] = benchmark_passed if benchmark_ids else report['passed']
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, default=ROOT / 'canvas_graph.json')
    parser.add_argument('--manifest', type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument('--courses', type=int, nargs='*', help='Limit eval to course IDs')
    parser.add_argument('--benchmark-only', action='store_true')
    parser.add_argument('--out', type=Path, default=ROOT / '.cache' / 'parse_quality' / 'report.json')
    args = parser.parse_args()

    if not args.manifest.is_file():
        print(
            f'Missing baseline manifest: {args.manifest}\n'
            'Run: python scripts/build_parse_quality_baseline.py',
            file=sys.stderr,
        )
        return 1
    if not args.candidate.is_file():
        print(f'Missing candidate graph: {args.candidate}', file=sys.stderr)
        return 1

    manifest = load_manifest(args.manifest)
    candidate = load_graph(args.candidate)
    if args.benchmark_only:
        course_ids = [str(course_id) for course_id in manifest.get('benchmarkCourseIds') or []]
    elif args.courses:
        course_ids = [str(course_id) for course_id in args.courses]
    else:
        course_ids = None

    report = eval_against_manifest(candidate, manifest, course_ids=course_ids)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')

    print('=== Parse quality eval ===')
    print(f"  overall: {'PASS' if report['passed'] else 'FAIL'}")
    if report.get('benchmarkCourseIds'):
        print(f"  benchmark ({len(report['benchmarkCourseIds'])} courses): "
              f"{'PASS' if report['benchmarkPassed'] else 'FAIL'}")
    for row in report['courses']:
        status = 'PASS' if row['passed'] else 'FAIL'
        print(
            f"  course {row['courseId']}: {status} "
            f"recall={row['conceptTitleRecall']:.1%} "
            f"concepts={row['ratios']['concepts']:.2f} "
            f"details={row['ratios']['details']:.2f} "
            f"events={row['ratios']['datedTestEvents']:.2f} "
            f"files={row['ratios']['parsedFiles']:.2f}"
        )
    print(f'  report: {args.out}')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
