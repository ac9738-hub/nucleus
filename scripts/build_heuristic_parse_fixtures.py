#!/usr/bin/env python3
"""Build heuristic-parse benchmark manifests from local canvasfiles + graph labels."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.content.teaching_blocks import extract_teaching_units_from_pages  # noqa: E402
from canvas_parser.parse.file_types import (  # noqa: E402
    build_classification_snippet,
    heuristic_classify,
)
from parser import build_pdf_pages, folder, normalize_file_pages  # noqa: E402

FIXTURE_ROOT = ROOT / 'fixtures' / 'heuristic_parse'
PROFILE_PATH = FIXTURE_ROOT / 'profile.json'
HIGH_CONF = 0.90


def load_graph(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def load_profile() -> dict:
    return json.loads(PROFILE_PATH.read_text(encoding='utf-8'))


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


def graph_file_rows(graph: dict, course_ids: set[str]) -> list[tuple[str, str, dict]]:
    rows: list[tuple[str, str, dict]] = []
    for course_id, course_files in (graph.get('files') or {}).items():
        cid = str(course_id)
        if cid not in course_ids:
            continue
        if not isinstance(course_files, dict):
            continue
        for file_id, node in course_files.items():
            if isinstance(node, dict):
                rows.append((cid, str(file_id), node))
    return rows


def expected_file_type(node: dict) -> tuple[str, str, float]:
    """Return (type_id, label_source, confidence)."""
    ft = str(
        node.get('academicFileType')
        or node.get('parserFileType')
        or node.get('fileType')
        or ''
    ).strip()
    conf = float(node.get('academicFileTypeConfidence') or 0.0)
    source = str(node.get('academicFileTypeSource') or '').strip()
    if ft and source == 'heuristic' and conf >= HIGH_CONF:
        return ft, 'graph_heuristic', conf
    if ft and source == 'llm':
        return ft, 'graph_llm', conf
    if ft:
        return ft, 'graph_unknown', conf
    return '', 'unlabeled', 0.0


def expected_sections_from_node(node: dict) -> list[str]:
    sections: list[str] = []
    seen: set[str] = set()
    for detail in node.get('details') or []:
        if isinstance(detail, dict):
            name = str(detail.get('name') or '').strip()
            if name and name.lower() not in seen:
                seen.add(name.lower())
                sections.append(name)
    store = node.get('typeExtractions') or {}
    if isinstance(store, dict):
        for bucket in store.values():
            if not isinstance(bucket, dict):
                continue
            for key in ('sections', 'slides'):
                for row in bucket.get(key) or []:
                    if not isinstance(row, dict):
                        continue
                    label = str(row.get('title') or row.get('term') or row.get('name') or '').strip()
                    if label and label.lower() not in seen:
                        seen.add(label.lower())
                        sections.append(label)
    return sections[:40]


def load_pages(file_id: str, node: dict) -> list[dict]:
    pages = node.get('pages') or []
    if pages:
        return normalize_file_pages(pages, str(file_id))
    pdf_path = local_pdf_path(file_id)
    if not pdf_path:
        return []
    try:
        return normalize_file_pages(build_pdf_pages(str(pdf_path), str(file_id)), str(file_id))
    except Exception:
        return []


def heuristic_sections(pages: list[dict]) -> list[str]:
    if not pages:
        return []
    units = extract_teaching_units_from_pages(pages)
    return [str(unit.get('label') or '').strip() for unit in units if unit.get('label')]


def build_manifest(
    graph: dict,
    course_ids: list[str],
    *,
    source_graph: Path,
    split: str,
) -> dict:
    allowed = {str(course_id) for course_id in course_ids}
    entries = []
    for course_id, file_id, node in graph_file_rows(graph, allowed):
        filename = str(node.get('name') or node.get('filename') or file_id)
        exp_type, label_source, label_conf = expected_file_type(node)
        pdf = local_pdf_path(file_id)
        pages = load_pages(file_id, node)
        snippet = build_classification_snippet(pages=pages) if pages else ''
        heur_type, heur_conf = heuristic_classify(filename=filename, snippet=snippet)
        if not exp_type and heur_conf >= HIGH_CONF:
            exp_type = heur_type
            label_source = 'high_confidence_heuristic_only'
            label_conf = heur_conf
        entries.append({
            'courseId': course_id,
            'fileId': file_id,
            'filename': filename,
            'expectedFileType': exp_type,
            'labelSource': label_source,
            'labelConfidence': round(label_conf, 4),
            'localPdf': bool(pdf),
            'pageCount': len(pages),
            'heuristicFileType': heur_type,
            'heuristicConfidence': round(heur_conf, 4),
            'expectedSections': expected_sections_from_node(node),
            'heuristicSectionsSample': heuristic_sections(pages)[:12],
        })
    entries.sort(key=lambda row: (row['courseId'], row['filename']))
    labeled = sum(1 for row in entries if row['expectedFileType'])
    local = sum(1 for row in entries if row['localPdf'])
    return {
        'version': 1,
        'split': split,
        'createdAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'sourceGraph': str(source_graph),
        'courseIds': course_ids,
        'fileCount': len(entries),
        'labeledFileCount': labeled,
        'localPdfCount': local,
        'files': entries,
    }


def write_textbook_manifest() -> dict:
    textbook_dir = FIXTURE_ROOT / 'textbook'
    textbook_dir.mkdir(parents=True, exist_ok=True)
    chapters = []
    for path in sorted(textbook_dir.glob('*.txt')):
        text = path.read_text(encoding='utf-8').strip()
        chapters.append({
            'chapterId': path.stem,
            'path': str(path.relative_to(ROOT)).replace('\\', '/'),
            'charCount': len(text),
            'ready': 'PASTE_CHAPTER_TEXT_HERE' not in text and len(text) > 200,
            'expectedSections': [],
            'notes': 'Add expectedSections after pasting chapter text (e.g. 1.1 Introduction, 1.2 ...).',
        })
    manifest = {
        'version': 1,
        'courseId': 'textbook_manual',
        'chapters': chapters,
    }
    out = textbook_dir / 'manifest.json'
    out.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--graph',
        type=Path,
        default=ROOT / '.cache' / 'graph_eval' / 'fast_3course_iter8.json',
        help='Source graph for labels (falls back to canvas_graph.json)',
    )
    parser.add_argument('--all-courses', action='store_true', help='Include every course in graph')
    args = parser.parse_args()

    graph_path = args.graph
    if not graph_path.is_file():
        fallback = ROOT / 'canvas_graph.json'
        if fallback.is_file():
            graph_path = fallback
        else:
            print(f'No graph at {args.graph} or canvas_graph.json', file=sys.stderr)
            return 1

    profile = load_profile()
    graph = load_graph(graph_path)
    if args.all_courses:
        course_ids = sorted(
            str(cid) for cid in (graph.get('files') or {})
            if str(cid).strip()
        )
    else:
        course_ids = profile['insampleCourseIds'] + profile['holdoutCourseIds']

    insample = build_manifest(
        graph,
        profile['insampleCourseIds'],
        source_graph=graph_path,
        split='insample',
    )
    holdout = build_manifest(
        graph,
        profile['holdoutCourseIds'],
        source_graph=graph_path,
        split='holdout',
    )

    insample_dir = FIXTURE_ROOT / 'insample'
    holdout_dir = FIXTURE_ROOT / 'holdout'
    insample_dir.mkdir(parents=True, exist_ok=True)
    holdout_dir.mkdir(parents=True, exist_ok=True)
    insample_path = insample_dir / 'manifest.json'
    holdout_path = holdout_dir / 'manifest.json'
    insample_path.write_text(json.dumps(insample, indent=2), encoding='utf-8')
    holdout_path.write_text(json.dumps(holdout, indent=2), encoding='utf-8')
    textbook = write_textbook_manifest()

    print(f'Graph: {graph_path}')
    print(f'In-sample: {insample_path} ({insample["fileCount"]} files, {insample["localPdfCount"]} local PDFs, {insample["labeledFileCount"]} labeled)')
    print(f'Holdout:   {holdout_path} ({holdout["fileCount"]} files, {holdout["localPdfCount"]} local PDFs, {holdout["labeledFileCount"]} labeled)')
    print(f'Textbook chapters: {len(textbook["chapters"])} (paste text into fixtures/heuristic_parse/textbook/*.txt)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
