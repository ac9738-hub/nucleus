#!/usr/bin/env python3
"""Freeze a new heuristic-eval base set from parse_quality course subgraphs."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.extract.validate import assess_graph_retrieval_completeness  # noqa: E402
from scripts.eval_graph_parse import course_metrics, extract_course_subgraph  # noqa: E402

# PDF-backed insample core (local canvasfiles/ required for heuristic eval).
# MAT202 (19097) GT is textbook-only — use --courses 19097 after syncing PDF.
# Excludes legacy benchmark trio (18857, 15160, 19971) and holdout (15222, 14788, 17239).
DEFAULT_NEW_BASE_COURSE_IDS = [15237, 17581, 20690]
OPTIONAL_STRETCH_COURSE_IDS = [19097]
COURSES_DIR = ROOT / 'fixtures' / 'parse_quality' / 'courses'
DEFAULT_OUT = ROOT / 'fixtures' / 'parse_quality' / 'new_base_baseline.json'


def merge_subgraphs(course_ids: list[str]) -> dict:
    merged = {
        'concepts': [],
        'events': [],
        'problems': [],
        'files': {},
        'syllabi': {},
        'learningBlocks': {},
    }
    for course_id in course_ids:
        path = COURSES_DIR / f'{course_id}.json'
        if not path.is_file():
            raise FileNotFoundError(f'Missing subgraph: {path}')
        subgraph = json.loads(path.read_text(encoding='utf-8'))
        merged['concepts'].extend(subgraph.get('concepts') or [])
        merged['events'].extend(subgraph.get('events') or [])
        merged['problems'].extend(subgraph.get('problems') or [])
        merged['files'].update(subgraph.get('files') or {})
        merged['syllabi'].update(subgraph.get('syllabi') or {})
        merged['learningBlocks'].update(subgraph.get('learningBlocks') or {})
    return merged


def build_manifest(state: dict, course_ids: list[str]) -> dict:
    per_course = []
    for course_id in course_ids:
        metrics = course_metrics(state, course_id)
        titles = metrics.pop('conceptTitles', [])
        per_course.append({
            'courseId': course_id,
            'metrics': metrics,
            'conceptTitles': titles,
            'conceptTitleCount': len(titles),
        })
    scoped = extract_course_subgraph(state, course_ids)
    completeness = assess_graph_retrieval_completeness(scoped)
    return {
        'version': 1,
        'createdAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'sourceGraph': 'fixtures/parse_quality/courses/{courseId}.json',
        'sourceSubgraphsDir': 'fixtures/parse_quality/courses',
        'courseIds': course_ids,
        'benchmarkCourseIds': ['18857', '15160', '19971'],
        'global': {
            'concepts': len(scoped.get('concepts') or []),
            'events': len(scoped.get('events') or []),
            'problems': len(scoped.get('problems') or []),
            'files': sum(len(files or {}) for files in (scoped.get('files') or {}).values()),
            'completeness': completeness,
        },
        'courses': per_course,
        'thresholds': {
            'conceptTitleRecall': 0.50,
            'heuristicTargetRecall': 0.50,
        },
        'includeSubgraphs': True,
        'notes': {
            '15237': 'NEU201 neuroscience lecture slides',
            '17581': 'NEU202/PSY259 neuro/psych',
            '20690': 'COS217 ARM / systems (numbered sections)',
            '19097': 'MAT202 stretch — needs textbook PDF in canvasfiles/',
        },
        'optionalStretchCourseIds': [str(course_id) for course_id in OPTIONAL_STRETCH_COURSE_IDS],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--courses',
        type=int,
        nargs='*',
        default=DEFAULT_NEW_BASE_COURSE_IDS,
    )
    parser.add_argument('-o', '--out', type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    course_ids = [str(course_id) for course_id in args.courses]
    state = merge_subgraphs(course_ids)
    manifest = build_manifest(state, course_ids)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')

    print('=== New base heuristic eval set ===')
    for row in manifest['courses']:
        metrics = row['metrics']
        print(
            f"  {row['courseId']}: {row['conceptTitleCount']} titles, "
            f"{metrics.get('parsedFiles', 0)}/{metrics.get('files', 0)} parsed files"
        )
    print(f'  aggregate concepts: {manifest["global"]["concepts"]}')
    print(f'  manifest: {args.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
