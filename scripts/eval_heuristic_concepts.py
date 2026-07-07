#!/usr/bin/env python3
"""Evaluate deterministic heuristic concept extraction against parse-quality baseline."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.file_types import (  # noqa: E402
    build_classification_snippet,
    heuristic_classify,
    normalize_file_type_id,
)
from canvas_parser.parse.heuristic_concepts import (  # noqa: E402
    build_heuristic_type_extractions,
    concept_dicts_from_titles,
    extract_heuristic_concept_titles,
)
from canvas_parser.weekly_iteration.match_utils import names_match, normalize_name  # noqa: E402
from parser import build_pdf_pages, folder, normalize_file_pages  # noqa: E402
from scripts.eval_graph_parse import compare_course_to_manifest_row, extract_course_subgraph  # noqa: E402
from scripts.eval_parse_quality import baseline_graph_from_manifest, load_manifest  # noqa: E402
from scripts.postprocess_parse_graph import postprocess_graph  # noqa: E402

DEFAULT_MANIFEST = ROOT / 'fixtures' / 'parse_quality' / 'benchmark_baseline.json'
NEW_BASE_MANIFEST = ROOT / 'fixtures' / 'parse_quality' / 'new_base_baseline.json'
DEFAULT_REPORT = ROOT / '.cache' / 'heuristic_concepts' / 'report.json'
NEW_BASE_REPORT = ROOT / '.cache' / 'heuristic_concepts' / 'new_base_report.json'
DEFAULT_SOURCE_GRAPH = ROOT / '.cache' / 'graph_eval' / 'fast_3course_iter8.json'
COURSE_SUBGRAPHS_DIR = ROOT / 'fixtures' / 'parse_quality' / 'courses'
TARGET_RECALL = 0.50
MIN_PRECISION = 0.08  # reject runaway false-positive seeding


def merge_course_subgraphs(course_ids: list[str]) -> dict:
    merged = {
        'concepts': [],
        'events': [],
        'problems': [],
        'files': {},
        'syllabi': {},
        'learningBlocks': {},
    }
    for course_id in course_ids:
        path = COURSE_SUBGRAPHS_DIR / f'{course_id}.json'
        if not path.is_file():
            continue
        subgraph = json.loads(path.read_text(encoding='utf-8'))
        merged['concepts'].extend(subgraph.get('concepts') or [])
        merged['events'].extend(subgraph.get('events') or [])
        merged['problems'].extend(subgraph.get('problems') or [])
        merged['files'].update(subgraph.get('files') or {})
        merged['syllabi'].update(subgraph.get('syllabi') or {})
        merged['learningBlocks'].update(subgraph.get('learningBlocks') or {})
    return merged


def resolve_source_graph(manifest: dict, course_ids: list[str]) -> dict:
    if manifest.get('sourceSubgraphsDir'):
        merged = merge_course_subgraphs(course_ids)
        if merged.get('files'):
            return merged
    candidates = [
        DEFAULT_SOURCE_GRAPH,
        ROOT / str(manifest.get('sourceGraph') or ''),
    ]
    for path in candidates:
        if path.is_file() and '{' not in str(path):
            return json.loads(path.read_text(encoding='utf-8'))
    return baseline_graph_from_manifest(manifest, ROOT)


def local_pdf_path(file_id: str) -> Path | None:
    fid = str(file_id)
    direct = folder / fid
    if direct.is_file():
        return direct
    for suffix in ('.pdf', '.PDF'):
        candidate = folder / f'{fid}{suffix}'
        if candidate.is_file():
            return candidate
    return None


def load_pages(file_id: str, fallback_pages: list | None = None, searchtext: str = '') -> list[dict]:
    pdf_path = local_pdf_path(file_id)
    if pdf_path:
        try:
            return normalize_file_pages(build_pdf_pages(str(pdf_path), file_id), file_id)
        except Exception:
            pass
    if fallback_pages:
        return list(fallback_pages)
    text = str(searchtext or '').strip()
    if text and not text.startswith('{'):
        return [{'pageNumber': 1, 'text': text[:50000], 'blocks': []}]
    return []


def build_heuristic_graph(source_graph: dict, course_ids: list[str]) -> dict:
    state = {
        'concepts': [],
        'events': [],
        'problems': [],
        'files': {},
        'syllabi': {},
        'learningBlocks': {},
    }
    for course_id in course_ids:
        course_files = (source_graph.get('files') or {}).get(course_id) or {}
        state['files'][course_id] = {}
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            if str(file_id).startswith('external-site-'):
                continue
            pages = load_pages(
                str(file_id),
                file_node.get('pages') or [],
                searchtext=str(file_node.get('searchtext') or ''),
            )
            filename = str(file_node.get('name') or '')
            file_type = normalize_file_type_id(str(file_node.get('academicFileType') or ''))
            if not file_type and pages:
                snippet = build_classification_snippet(pages=pages)
                file_type = normalize_file_type_id(heuristic_classify(filename=filename, snippet=snippet)[0])
            titles = extract_heuristic_concept_titles(
                filename=filename,
                pages=pages,
                file_type=file_type,
            )
            state['concepts'].extend(
                concept_dicts_from_titles(course_id, str(file_id), titles)
            )
            extractions = build_heuristic_type_extractions(
                filename=filename,
                pages=pages,
                file_type=file_type,
            )
            payload = dict(file_node)
            payload['pages'] = pages
            payload['academicFileType'] = file_type
            payload['typeExtractions'] = extractions
            state['files'][course_id][str(file_id)] = payload
    return postprocess_graph(state, skip_volume_caps=True)


def aggregate_recall(report_courses: list[dict]) -> float:
    matched = 0
    total = 0
    for row in report_courses:
        base_count = int(row.get('baseline', {}).get('concepts') or 0)
        recall = float(row.get('conceptTitleRecall') or 0.0)
        total += base_count
        matched += int(round(recall * base_count))
    return matched / total if total else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--new-base',
        action='store_true',
        help='Use fixtures/parse_quality/new_base_baseline.json (NEU/COS core)',
    )
    parser.add_argument(
        '--include-stretch',
        action='store_true',
        help='Include optionalStretchCourseIds from manifest (e.g. MAT202 textbook)',
    )
    parser.add_argument('--manifest', type=Path, default=None)
    parser.add_argument('-o', '--output', type=Path, default=None)
    parser.add_argument('--source-graph', type=Path, default=None)
    parser.add_argument('--target-recall', type=float, default=TARGET_RECALL)
    parser.add_argument('--courses', type=int, nargs='*')
    args = parser.parse_args()

    if args.new_base:
        args.manifest = args.manifest or NEW_BASE_MANIFEST
        args.output = args.output or NEW_BASE_REPORT
    args.manifest = args.manifest or DEFAULT_MANIFEST
    args.output = args.output or DEFAULT_REPORT

    manifest = load_manifest(args.manifest)
    if args.courses:
        course_ids = [str(course_id) for course_id in args.courses]
    else:
        course_ids = [str(course_id) for course_id in (manifest.get('courseIds') or [])]
        if args.include_stretch:
            for course_id in manifest.get('optionalStretchCourseIds') or []:
                cid = str(course_id)
                if cid not in course_ids:
                    course_ids.append(cid)
    if args.source_graph and args.source_graph.is_file():
        source = json.loads(args.source_graph.read_text(encoding='utf-8'))
    else:
        source = resolve_source_graph(manifest, course_ids)
    source = extract_course_subgraph(source, course_ids)

    candidate = build_heuristic_graph(source, course_ids)
    manifest_rows = {
        str(row.get('courseId') or ''): row
        for row in (manifest.get('courses') or [])
    }
    per_course = [
        compare_course_to_manifest_row(manifest_rows[course_id], candidate, course_id)
        for course_id in course_ids
        if course_id in manifest_rows
    ]
    aggregate = aggregate_recall(per_course)
    precisions = [float(row.get('conceptTitlePrecision') or 0.0) for row in per_course]
    aggregate_precision = sum(precisions) / len(precisions) if precisions else 0.0
    passed = aggregate >= args.target_recall and aggregate_precision >= MIN_PRECISION

    report = {
        'courseIds': course_ids,
        'targetRecall': args.target_recall,
        'minPrecision': MIN_PRECISION,
        'aggregateConceptRecall': round(aggregate, 4),
        'aggregateConceptPrecision': round(aggregate_precision, 4),
        'passed': passed,
        'courses': per_course,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')

    for row in per_course:
        print(
            f"{row['courseId']}: recall={row['conceptTitleRecall']:.1%} "
            f"precision={row['conceptTitlePrecision']:.1%} "
            f"concepts={row['candidate']['concepts']} "
            f"missing={row.get('missingTitlesSample', [])[:3]}"
        )
    print(
        f'Aggregate recall={aggregate:.1%} precision={aggregate_precision:.1%} '
        f'target={args.target_recall:.0%} PASS={passed}'
    )
    print(f'Report: {args.output}')
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
