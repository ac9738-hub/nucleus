#!/usr/bin/env python3
"""Compare parse graphs (baseline vs fast) on per-course quality metrics."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.extract.validate import (  # noqa: E402
    assess_graph_retrieval_completeness,
    validate_graph_state,
)
from canvas_parser.weekly_iteration.match_utils import names_match, normalize_name  # noqa: E402

DEFAULT_COURSES = (18857, 15160, 19971)  # ART102, CHM201, ASA344 GT fixtures


def load_graph(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def _course_rows(state: dict, course_id: str, key: str) -> list[dict]:
    rows = []
    for row in state.get(key) or []:
        if isinstance(row, dict) and str(row.get('courseid') or '') == course_id:
            rows.append(row)
    return rows


def _concept_titles(concepts: list[dict]) -> set[str]:
    titles: set[str] = set()
    for concept in concepts:
        for field in ('name',):
            value = normalize_name(str(concept.get(field) or ''))
            if value:
                titles.add(value)
        for detail in concept.get('details') or []:
            if isinstance(detail, dict):
                name = normalize_name(str(detail.get('name') or ''))
                if name:
                    titles.add(name)
    return titles


def _dated_test_events(events: list[dict]) -> list[dict]:
    dated = []
    for event in events:
        if not event.get('startdate') and not event.get('enddate'):
            continue
        name = str(event.get('name') or '')
        etype = str(event.get('type') or '').lower()
        if etype == 'test' or re.search(r'\b(exam|midterm|final|quiz)\b', name, re.I):
            dated.append(event)
    return dated


def _course_file_nodes(state: dict, course_id: str) -> list[dict]:
    files = (state.get('files') or {}).get(course_id) or {}
    nodes = [node for node in files.values() if isinstance(node, dict)]
    # External crawl nodes are optional in bulk/fast mode; exclude from file coverage metrics.
    return [
        node for node in nodes
        if not str(node.get('fileid') or '').startswith('external-site-')
    ]


def course_metrics(state: dict, course_id: str) -> dict:
    concepts = _course_rows(state, course_id, 'concepts')
    events = _course_rows(state, course_id, 'events')
    problems = _course_rows(state, course_id, 'problems')
    file_nodes = _course_file_nodes(state, course_id)
    details = sum(len(c.get('details') or []) for c in concepts)
    examples = sum(len(c.get('examples') or []) for c in concepts)
    parsed_files = sum(1 for node in file_nodes if node.get('pages') or node.get('textChunks'))
    return {
        'concepts': len(concepts),
        'details': details,
        'examples': examples,
        'problems': len(problems),
        'events': len(events),
        'datedTestEvents': len(_dated_test_events(events)),
        'files': len(file_nodes),
        'parsedFiles': parsed_files,
        'conceptTitles': sorted(_concept_titles(concepts)),
    }


def _title_overlap(base_titles: set[str], cand_titles: set[str]) -> tuple[int, int, int]:
    matched_base: set[str] = set()
    matched_cand: set[str] = set()
    for base_title in base_titles:
        for cand_title in cand_titles:
            if cand_title in matched_cand:
                continue
            if base_title == cand_title or names_match(base_title, cand_title):
                matched_base.add(base_title)
                matched_cand.add(cand_title)
                break
    return len(matched_base), len(base_titles), len(cand_titles)


def compare_course(baseline: dict, candidate: dict, course_id: str) -> dict:
    base = course_metrics(baseline, course_id)
    cand = course_metrics(candidate, course_id)
    base_titles = set(base.pop('conceptTitles'))
    cand_titles = set(cand.pop('conceptTitles'))
    overlap_count, base_count, cand_count = _title_overlap(base_titles, cand_titles)
    recall = overlap_count / base_count if base_count else 1.0
    precision = overlap_count / cand_count if cand_count else 1.0
    ratios = {
        'concepts': _ratio(cand['concepts'], base['concepts']),
        'details': _ratio(cand['details'], base['details']),
        'datedTestEvents': _ratio(cand['datedTestEvents'], base['datedTestEvents']),
        'parsedFiles': _ratio(cand['parsedFiles'], base['parsedFiles']),
    }
    structural = (
        0.85 <= ratios['concepts'] <= 1.25
        and ratios['details'] >= 0.75
        and ratios['details'] <= 1.50
        and ratios['datedTestEvents'] >= 0.90
        and ratios['parsedFiles'] >= 0.95
    )
    concept_close = 0.85 <= ratios['concepts'] <= 1.25
    titles = (
        recall >= 0.85
        or (structural and recall >= 0.25)
        or (concept_close and recall >= 0.25)
    )
    passed = structural and titles
    return {
        'courseId': course_id,
        'baseline': base,
        'candidate': cand,
        'conceptTitleRecall': round(recall, 4),
        'conceptTitlePrecision': round(precision, 4),
        'ratios': {key: round(value, 4) for key, value in ratios.items()},
        'passed': passed,
        'missingTitlesSample': sorted(
            title for title in base_titles
            if not any(names_match(title, cand) for cand in cand_titles)
        )[:8],
    }


def _ratio(candidate: int, baseline: int) -> float:
    if baseline <= 0:
        return 1.0 if candidate <= 0 else float(candidate)
    return candidate / baseline


def extract_course_subgraph(state: dict, course_ids: list[str]) -> dict:
    allowed = {str(course_id) for course_id in course_ids}
    out = dict(state)
    out['concepts'] = [
        row for row in state.get('concepts') or []
        if str(row.get('courseid') or '') in allowed
    ]
    out['events'] = [
        row for row in state.get('events') or []
        if str(row.get('courseid') or '') in allowed
    ]
    out['problems'] = [
        row for row in state.get('problems') or []
        if str(row.get('courseid') or '') in allowed
    ]
    out['files'] = {
        cid: files for cid, files in (state.get('files') or {}).items()
        if str(cid) in allowed
    }
    out['syllabi'] = {
        cid: syllabus for cid, syllabus in (state.get('syllabi') or {}).items()
        if str(cid) in allowed
    }
    out['learningBlocks'] = {
        cid: blocks for cid, blocks in (state.get('learningBlocks') or {}).items()
        if str(cid) in allowed
    }
    return out


def compare_course_to_manifest_row(baseline_row: dict, candidate: dict, course_id: str) -> dict:
    """Compare candidate graph to a frozen per-course manifest row (no subgraph JSON required)."""
    base_metrics = dict(baseline_row.get('metrics') or {})
    base_titles = set(baseline_row.get('conceptTitles') or [])
    cand = course_metrics(candidate, course_id)
    cand_titles = set(cand.pop('conceptTitles', []))
    overlap_count, base_count, cand_count = _title_overlap(base_titles, cand_titles)
    recall = overlap_count / base_count if base_count else 1.0
    precision = overlap_count / cand_count if cand_count else 1.0
    ratios = {
        'concepts': _ratio(cand['concepts'], base_metrics.get('concepts', 0)),
        'details': _ratio(cand['details'], base_metrics.get('details', 0)),
        'datedTestEvents': _ratio(cand['datedTestEvents'], base_metrics.get('datedTestEvents', 0)),
        'parsedFiles': _ratio(cand['parsedFiles'], base_metrics.get('parsedFiles', 0)),
    }
    structural = (
        0.85 <= ratios['concepts'] <= 1.25
        and ratios['details'] >= 0.75
        and ratios['details'] <= 1.50
        and ratios['datedTestEvents'] >= 0.90
        and ratios['parsedFiles'] >= 0.95
    )
    concept_close = 0.85 <= ratios['concepts'] <= 1.25
    titles = (
        recall >= 0.85
        or (structural and recall >= 0.25)
        or (concept_close and recall >= 0.25)
    )
    passed = structural and titles
    return {
        'courseId': course_id,
        'baseline': base_metrics,
        'candidate': cand,
        'conceptTitleRecall': round(recall, 4),
        'conceptTitlePrecision': round(precision, 4),
        'ratios': {key: round(value, 4) for key, value in ratios.items()},
        'passed': passed,
        'missingTitlesSample': sorted(
            title for title in base_titles
            if not any(names_match(title, other) for other in cand_titles)
        )[:8],
    }


def evaluate_graphs(
    baseline: dict,
    candidate: dict,
    course_ids: list[str],
) -> dict:
    per_course = [compare_course(baseline, candidate, cid) for cid in course_ids]
    completeness = assess_graph_retrieval_completeness(candidate)
    warnings = validate_graph_state(candidate)
    passed = all(row['passed'] for row in per_course)
    return {
        'courseIds': course_ids,
        'passed': passed,
        'courses': per_course,
        'completeness': completeness,
        'validationWarningCount': len(warnings),
        'validationWarningsSample': warnings[:20],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--courses', type=int, nargs='*', default=list(DEFAULT_COURSES))
    parser.add_argument('--out', type=Path, default=ROOT / '.cache' / 'graph_eval' / 'report.json')
    args = parser.parse_args()

    course_ids = [str(course_id) for course_id in args.courses]
    baseline = load_graph(args.baseline)
    candidate = load_graph(args.candidate)
    report = evaluate_graphs(baseline, candidate, course_ids)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding='utf-8')

    print('=== Graph parse eval ===')
    print(f"  overall: {'PASS' if report['passed'] else 'FAIL'}")
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
    print(f"  validation warnings: {report['validationWarningCount']}")
    print(f'  report: {args.out}')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
