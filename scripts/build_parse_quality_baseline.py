#!/usr/bin/env python3
"""Freeze parse-quality metrics from the current canvas_graph.json for regression eval."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.extract.validate import assess_graph_retrieval_completeness  # noqa: E402
from scripts.eval_graph_parse import (  # noqa: E402
    DEFAULT_COURSES,
    course_metrics,
    extract_course_subgraph,
)

FIXTURE_DIR = ROOT / 'fixtures' / 'parse_quality'
MANIFEST_PATH = FIXTURE_DIR / 'baseline.json'
COURSES_DIR = FIXTURE_DIR / 'courses'


def discover_course_ids(state: dict, *, course_ids: list[str] | None = None) -> list[str]:
    if course_ids:
        return [str(course_id) for course_id in course_ids]
    found: set[str] = set()
    for row in state.get('concepts') or []:
        cid = str(row.get('courseid') or '').strip()
        if cid:
            found.add(cid)
    for cid in (state.get('files') or {}):
        if str(cid).strip():
            found.add(str(cid))
    for row in state.get('events') or []:
        cid = str(row.get('courseid') or '').strip()
        if cid:
            found.add(cid)
    return sorted(found)


def build_course_baseline(state: dict, course_id: str) -> dict:
    metrics = course_metrics(state, course_id)
    titles = metrics.pop('conceptTitles', [])
    return {
        'courseId': course_id,
        'metrics': metrics,
        'conceptTitles': titles,
        'conceptTitleCount': len(titles),
    }


def build_manifest(
    state: dict,
    *,
    course_ids: list[str],
    source_graph: Path,
    include_subgraphs: bool,
) -> dict:
    per_course = [build_course_baseline(state, course_id) for course_id in course_ids]
    scoped = extract_course_subgraph(state, course_ids)
    completeness = assess_graph_retrieval_completeness(scoped)
    session = ((state.get('completed_model_calls') or {}).get('parse_session_summary') or {})
    return {
        'version': 1,
        'createdAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'sourceGraph': str(source_graph),
        'courseIds': course_ids,
        'benchmarkCourseIds': [str(course_id) for course_id in DEFAULT_COURSES],
        'global': {
            'concepts': len(scoped.get('concepts') or []),
            'events': len(scoped.get('events') or []),
            'problems': len(scoped.get('problems') or []),
            'files': sum(len(files or {}) for files in (scoped.get('files') or {}).values()),
            'completeness': completeness,
            'parseSession': {
                'wall_ms': session.get('wall_ms'),
                'wall_minutes': session.get('wall_minutes'),
            },
        },
        'courses': per_course,
        'thresholds': {
            'conceptTitleRecall': 0.85,
            'conceptRatioMin': 0.85,
            'conceptRatioMax': 1.25,
            'detailsRatioMin': 0.75,
            'datedTestEventsRatioMin': 0.90,
            'parsedFilesRatioMin': 0.95,
        },
        'includeSubgraphs': include_subgraphs,
    }


def write_subgraphs(state: dict, course_ids: list[str]) -> list[str]:
    written: list[str] = []
    COURSES_DIR.mkdir(parents=True, exist_ok=True)
    for course_id in course_ids:
        subgraph = extract_course_subgraph(state, [course_id])
        out_path = COURSES_DIR / f'{course_id}.json'
        out_path.write_text(json.dumps(subgraph, ensure_ascii=False), encoding='utf-8')
        written.append(str(out_path.relative_to(ROOT)))
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=ROOT / 'canvas_graph.json')
    parser.add_argument(
        '--from-graph',
        type=Path,
        help='Source graph for baseline (e.g. .cache/graph_eval/quality_3course.json)',
    )
    parser.add_argument('--courses', type=int, nargs='*', help='Limit to specific course IDs')
    parser.add_argument('--benchmark-only', action='store_true', help='Only freeze DEFAULT_COURSES GT set')
    parser.add_argument('--no-subgraphs', action='store_true', help='Skip per-course graph JSON snapshots')
    parser.add_argument('--out', type=Path, default=MANIFEST_PATH)
    args = parser.parse_args()

    graph_path = Path(args.from_graph) if args.from_graph else Path(args.graph)
    if not graph_path.is_file():
        print(f'Missing graph: {graph_path}', file=sys.stderr)
        return 1

    state = json.loads(graph_path.read_text(encoding='utf-8'))
    if args.benchmark_only:
        course_ids = [str(course_id) for course_id in DEFAULT_COURSES]
    elif args.courses:
        course_ids = [str(course_id) for course_id in args.courses]
    else:
        course_ids = discover_course_ids(state)

    if not course_ids:
        print('No courses found in graph.', file=sys.stderr)
        return 1

    include_subgraphs = not args.no_subgraphs
    manifest = build_manifest(
        state,
        course_ids=course_ids,
        source_graph=graph_path,
        include_subgraphs=include_subgraphs,
    )
    if include_subgraphs:
        manifest['subgraphPaths'] = write_subgraphs(state, course_ids)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')

    print('=== Parse quality baseline ===')
    print(f'  courses: {len(course_ids)}')
    print(f'  concepts: {manifest["global"]["concepts"]}')
    print(f'  benchmark courses: {manifest["benchmarkCourseIds"]}')
    print(f'  manifest: {args.out}')
    if include_subgraphs:
        print(f'  subgraphs: {COURSES_DIR} ({len(course_ids)} files)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
