#!/usr/bin/env python3
"""Build parse-eval file pool with per-course syllabus seeds from the production graph."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_eval_concurrency import DEFAULT_EVAL_CONCURRENCY  # noqa: E402
from scripts.eval_graph_parse import extract_course_subgraph  # noqa: E402

FIXTURE_ROOT = ROOT / 'fixtures' / 'parse_eval'
HEURISTIC_MANIFEST = ROOT / 'fixtures' / 'heuristic_parse' / 'insample' / 'manifest.json'
DEFAULT_GRAPH = ROOT / 'canvas_graph.json'


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def extract_syllabus_seed(graph: dict, course_id: str) -> dict:
    """Per-course subgraph containing syllabus + syllabus-derived concepts/events."""
    base = extract_course_subgraph(graph, [course_id])
    syllabus = (base.get('syllabi') or {}).get(str(course_id))
    if not syllabus:
        return {}
    # Keep syllabus-linked concepts (names only in seed) and dated events.
    concepts = []
    for row in base.get('concepts') or []:
        if not isinstance(row, dict):
            continue
        if str(row.get('courseid') or '') != str(course_id):
            continue
        source = str(row.get('source') or row.get('origin') or '').lower()
        if 'syllabus' in source or row.get('fromSyllabus'):
            concepts.append(row)
    events = [
        row for row in (base.get('events') or [])
        if isinstance(row, dict) and str(row.get('courseid') or '') == str(course_id)
    ]
    return {
        'courseId': str(course_id),
        'syllabi': {str(course_id): syllabus},
        'concepts': concepts[:80],
        'events': events[:40],
        'problems': [],
        'files': {},
    }


from canvas_parser.parse.parse_pass_overrides import eval_stratum  # noqa: E402


def representative_reason(entry: dict) -> str:
    exp = str(entry.get('expectedFileType') or entry.get('heuristicFileType') or '')
    if entry.get('labelSource') not in ('unlabeled', '', None):
        return f'labeled_{exp or "file"}'
    conf = float(entry.get('heuristicConfidence') or 0)
    if conf >= 0.85:
        return f'high_conf_{exp or "heuristic"}'
    pages = int(entry.get('pageCount') or 0)
    if pages >= 20:
        return 'long_document'
    return 'representative_sample'


def file_download_url(graph: dict, course_id: str, file_id: str) -> str:
    node = ((graph.get('files') or {}).get(str(course_id)) or {}).get(str(file_id))
    if not isinstance(node, dict):
        return ''
    return str(node.get('downloadurl') or node.get('downloadUrl') or node.get('url') or '')


def build_pool(
    heuristic_manifest: dict,
    graph: dict,
    *,
    require_local_pdf: bool = True,
    max_files: int | None = None,
) -> dict:
    course_ids = sorted({str(row.get('courseId') or '') for row in heuristic_manifest.get('files') or []})
    syllabi_dir = FIXTURE_ROOT / 'syllabi'
    syllabi_dir.mkdir(parents=True, exist_ok=True)
    syllabus_by_course: dict[str, str] = {}
    for course_id in course_ids:
        if not course_id:
            continue
        seed = extract_syllabus_seed(graph, course_id)
        if seed:
            rel = f'syllabi/{course_id}.json'
            out_path = FIXTURE_ROOT / rel
            out_path.write_text(json.dumps(seed, indent=2, ensure_ascii=False), encoding='utf-8')
            syllabus_by_course[course_id] = rel

    files_out: list[dict] = []
    for entry in heuristic_manifest.get('files') or []:
        if not isinstance(entry, dict):
            continue
        if require_local_pdf and not entry.get('localPdf'):
            continue
        course_id = str(entry.get('courseId') or '')
        file_id = str(entry.get('fileId') or '')
        if not course_id or not file_id:
            continue
        gt_rel = f'gt/{course_id}/{file_id}.json'
        files_out.append({
            'courseId': course_id,
            'fileId': file_id,
            'filename': entry.get('filename'),
            'fileType': entry.get('expectedFileType') or entry.get('heuristicFileType') or '',
            'pageCount': entry.get('pageCount'),
            'localPdf': bool(entry.get('localPdf')),
            'syllabusSeedPath': syllabus_by_course.get(course_id, f'syllabi/{course_id}.json'),
            'gtPath': gt_rel,
            'representativeReason': representative_reason(entry),
            'evalStratum': eval_stratum(entry),
            'downloadUrl': file_download_url(graph, course_id, file_id),
        })
        if max_files and len(files_out) >= max_files:
            break

    return {
        'version': 1,
        'createdAt': _utc_now(),
        'root': str(FIXTURE_ROOT.relative_to(ROOT)).replace('\\', '/'),
        'concurrency': DEFAULT_EVAL_CONCURRENCY,
        'sourceManifest': str(HEURISTIC_MANIFEST.relative_to(ROOT)).replace('\\', '/'),
        'sourceGraph': 'canvas_graph.json',
        'courseIds': course_ids,
        'fileCount': len(files_out),
        'syllabusCourseCount': len(syllabus_by_course),
        'files': files_out,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=DEFAULT_GRAPH)
    parser.add_argument('--manifest', type=Path, default=HEURISTIC_MANIFEST)
    parser.add_argument('--out', type=Path, default=FIXTURE_ROOT / 'pool.json')
    parser.add_argument('--max-files', type=int, default=0, help='0 = all eligible files')
    parser.add_argument('--include-missing-pdf', action='store_true')
    args = parser.parse_args()

    if not args.graph.is_file():
        print(f'Graph not found: {args.graph}', file=sys.stderr)
        return 1
    if not args.manifest.is_file():
        print(f'Manifest not found: {args.manifest}', file=sys.stderr)
        return 1

    graph = load_json(args.graph)
    manifest = load_json(args.manifest)
    pool = build_pool(
        manifest,
        graph,
        require_local_pdf=not args.include_missing_pdf,
        max_files=args.max_files or None,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(pool, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Wrote pool: {args.out} ({pool["fileCount"]} files, {pool["syllabusCourseCount"]} syllabi)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
