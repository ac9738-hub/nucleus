"""Offline multi-pass template ground truth for parse eval (no LLM).

Each pool PDF is reviewed in several deterministic passes — page extract,
heuristic classify, teaching structure, type-specific rows, concept candidates,
problem scan, detail attach, reconcile — then merged into a GT record that
``compare_file_to_gt`` can score against.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from canvas_parser.content.page_blocks import compact_block_text
from canvas_parser.content.teaching_blocks import (
    classify_teaching_block,
    extract_teaching_units_from_pages,
)
from canvas_parser.parse.file_types import (
    HEURISTIC_CONFIDENCE_THRESHOLD,
    build_classification_snippet,
    heuristic_classify,
    normalize_file_type_id,
)
from canvas_parser.parse.heuristic_concepts import (
    build_heuristic_type_extractions,
    extract_heuristic_concept_titles,
    extract_lecture_slide_rows_from_pages,
)
from canvas_parser.parse.heuristic_guardrails import (
    FILE_TYPE_CAP_OVERRIDES,
    HEURISTIC_MAX_PER_FILE,
)
from canvas_parser.parse.parse_pass_plan import audit_fragment_passes, plan_passes_for_file
from canvas_parser.weekly_iteration.match_utils import normalize_name
from parser import build_pdf_pages, folder, normalize_file_pages

TEMPLATE_GT_PASSES = (
    'extract_pages',
    'heuristic_classify',
    'teaching_units',
    'type_structure',
    'concept_candidates',
    'problem_scan',
    'detail_attach',
    'reconcile',
)

_DETAIL_SKIP_PATTERN = re.compile(
    r'^(?:click|image|figure|slide|page\s+\d+|copyright|all rights reserved)\b',
    re.I,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


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


def load_pdf_pages(file_id: str) -> tuple[list[dict], Path | None]:
    pdf_path = local_pdf_path(file_id)
    if not pdf_path:
        return [], None
    pages = normalize_file_pages(build_pdf_pages(str(pdf_path), str(file_id)), str(file_id))
    return pages, pdf_path


def _iter_block_texts(pages: list[dict]) -> list[tuple[str, dict]]:
    rows: list[tuple[str, dict]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        blocks = page.get('blocks') if isinstance(page.get('blocks'), list) else []
        if blocks:
            for block in blocks:
                if isinstance(block, dict):
                    text = str(block.get('text') or '').strip()
                    if text:
                        rows.append((text, page))
        else:
            raw = compact_block_text(page.get('text', ''), 4000)
            for part in re.split(r'\n+', raw):
                part = part.strip()
                if part:
                    rows.append((part, page))
    return rows


def _resolve_expected_file_type(
    *,
    filename: str,
    pages: list[dict],
    pool_hint: str = '',
) -> tuple[str, str, float]:
    snippet = build_classification_snippet(pages=pages) if pages else ''
    heur_type, heur_conf = heuristic_classify(filename=filename, snippet=snippet, pages=pages)
    heur_type = normalize_file_type_id(heur_type)
    pool_type = normalize_file_type_id(pool_hint)
    if heur_conf >= HEURISTIC_CONFIDENCE_THRESHOLD and heur_type:
        return heur_type, 'heuristic_high', heur_conf
    if (
        pool_type == 'generic_content'
        and heur_type != 'generic_content'
        and heur_conf >= 0.65
    ):
        return heur_type, 'heuristic_typed', heur_conf
    if pool_type:
        return pool_type, 'pool_manifest', max(heur_conf, 0.0)
    if heur_type:
        return heur_type, 'heuristic_low', heur_conf
    return 'generic_content', 'fallback', 0.0


def _teaching_unit_labels(pages: list[dict]) -> list[str]:
    labels: list[str] = []
    seen: set[str] = set()
    for unit in extract_teaching_units_from_pages(pages):
        label = str(unit.get('label') or unit.get('name') or '').strip()
        key = normalize_name(label)
        if label and key and key not in seen:
            seen.add(key)
            labels.append(label)
    return labels


def _extract_problem_names(pages: list[dict]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for text, _page in _iter_block_texts(pages):
        classified = classify_teaching_block(text)
        if not classified or classified.get('type') != 'problem':
            continue
        name = str(classified.get('name') or '').strip()
        key = normalize_name(name)
        if name and key and key not in seen:
            seen.add(key)
            names.append(name)
    for unit in extract_teaching_units_from_pages(pages):
        if unit.get('type') != 'problem':
            continue
        name = str(unit.get('name') or unit.get('label') or '').strip()
        key = normalize_name(name)
        if name and key and key not in seen:
            seen.add(key)
            names.append(name)
    return names[:60]


def _detail_candidates(pages: list[dict], *, filename: str) -> dict[str, list[str]]:
    """Map normalized concept title → detail strings from slide summaries / snippets."""
    detail_map: dict[str, list[str]] = {}
    slide_rows = extract_lecture_slide_rows_from_pages(pages, filename=filename)
    for row in slide_rows:
        title = str(row.get('title') or '').strip()
        summary = compact_block_text(str(row.get('summary') or ''), 180)
        if not title or not summary:
            continue
        if normalize_name(summary) == normalize_name(title):
            continue
        if _DETAIL_SKIP_PATTERN.match(summary) or len(summary.split()) < 3:
            continue
        key = normalize_name(title)
        bucket = detail_map.setdefault(key, [])
        if summary not in bucket and len(bucket) < 3:
            bucket.append(summary)

    for text, _page in _iter_block_texts(pages):
        classified = classify_teaching_block(text)
        if not classified or classified.get('type') not in {'concept', 'section'}:
            continue
        name = str(classified.get('name') or '').strip()
        snippet = compact_block_text(str(classified.get('snippet') or ''), 160)
        if not name or not snippet:
            continue
        if normalize_name(snippet) == normalize_name(name):
            continue
        key = normalize_name(name)
        bucket = detail_map.setdefault(key, [])
        if snippet not in bucket and len(bucket) < 2:
            bucket.append(snippet)
    return detail_map


def _reconcile_concepts(
    titles: list[str],
    detail_map: dict[str, list[str]],
    *,
    file_type: str,
) -> tuple[list[dict[str, Any]], dict]:
    cap = FILE_TYPE_CAP_OVERRIDES.get(file_type, HEURISTIC_MAX_PER_FILE)
    seen: set[str] = set()
    accepted: list[str] = []
    capped = 0
    for title in titles:
        key = normalize_name(title)
        if not key or key in seen:
            continue
        if len(accepted) >= cap:
            capped += 1
            break
        seen.add(key)
        accepted.append(title)
    concepts: list[dict[str, Any]] = []
    for title in accepted:
        details = detail_map.get(normalize_name(title), [])[:3]
        concepts.append({'name': title, 'details': details})
    stats = {
        'inputTitles': len(titles),
        'accepted': len(accepted),
        'capped': capped,
        'detailAttached': sum(1 for c in concepts if c.get('details')),
    }
    return concepts, stats


def build_template_gt_from_pdf(
    *,
    course_id: str,
    file_id: str,
    filename: str = '',
    pool_file_type_hint: str = '',
) -> dict[str, Any]:
    """Build template GT by running multiple offline passes over a local PDF."""
    filename = str(filename or file_id)
    pass_audit: dict[str, Any] = {}

    pages, pdf_path = load_pdf_pages(file_id)
    pass_audit['extract_pages'] = {
        'localPdf': bool(pdf_path),
        'pageCount': len(pages),
        'pdfPath': str(pdf_path) if pdf_path else '',
    }
    if not pages:
        expected_type = normalize_file_type_id(pool_file_type_hint) or 'generic_content'
        return _empty_gt_record(
            course_id=course_id,
            file_id=file_id,
            filename=filename,
            expected_file_type=expected_type,
            pass_audit=pass_audit,
            error='missing_local_pdf',
        )

    expected_type, type_source, type_conf = _resolve_expected_file_type(
        filename=filename,
        pages=pages,
        pool_hint=pool_file_type_hint,
    )
    pass_audit['heuristic_classify'] = {
        'expectedFileType': expected_type,
        'source': type_source,
        'confidence': round(type_conf, 4),
    }

    sections = _teaching_unit_labels(pages)
    pass_audit['teaching_units'] = {'sectionCount': len(sections)}

    type_store = build_heuristic_type_extractions(
        filename=filename,
        pages=pages,
        file_type=expected_type,
    )
    slide_count = len((type_store.get('lecture') or {}).get('slides') or [])
    reading_count = len((type_store.get('reading') or {}).get('sections') or [])
    week_count = len((type_store.get('syllabus') or {}).get('weeks') or [])
    pass_audit['type_structure'] = {
        'slideRows': slide_count,
        'readingSections': reading_count,
        'syllabusWeeks': week_count,
    }

    concept_titles = extract_heuristic_concept_titles(
        filename=filename,
        pages=pages,
        file_type=expected_type,
    )
    pass_audit['concept_candidates'] = {'candidateCount': len(concept_titles)}

    problems = _extract_problem_names(pages)
    pass_audit['problem_scan'] = {'problemCount': len(problems)}

    detail_map = _detail_candidates(pages, filename=filename)
    detail_total = sum(len(v) for v in detail_map.values())
    pass_audit['detail_attach'] = {
        'conceptKeysWithDetails': len(detail_map),
        'detailCount': detail_total,
    }

    concepts, reconcile_stats = _reconcile_concepts(
        concept_titles,
        detail_map,
        file_type=expected_type,
    )
    pass_audit['reconcile'] = reconcile_stats

    plan = plan_passes_for_file(
        course_id=course_id,
        file_id=file_id,
        filename=filename,
        file_type_hint=expected_type,
    )

    # Minimal fragment so pass audit reflects planned eval passes (no LLM ran).
    stub_fragment: dict[str, Any] = {
        'concepts': [
            {
                'courseid': course_id,
                'name': c['name'],
                'sourceFiles': [file_id],
                'details': [{'name': d} for d in c.get('details') or []],
            }
            for c in concepts
        ],
        'problems': [
            {'courseid': course_id, 'fileid': file_id, 'name': name}
            for name in problems
        ],
        'files': {
            course_id: {
                file_id: {
                    'fileid': file_id,
                    'name': filename,
                    'academicFileType': expected_type,
                    'pages': pages,
                    'typeExtractions': type_store,
                },
            },
        },
        '_meta': {'deepseek_passes': 1},
    }
    pass_plan_audit = audit_fragment_passes(
        stub_fragment,
        course_id=course_id,
        file_id=file_id,
        filename=filename,
        file_type_hint=expected_type,
        plan=plan,
    )

    return {
        'version': 1,
        'courseId': str(course_id),
        'fileId': str(file_id),
        'filename': filename,
        'expectedFileType': expected_type,
        'passPlan': plan.to_dict(),
        'passAudit': pass_plan_audit,
        'passes': list(TEMPLATE_GT_PASSES),
        'buildMode': 'template_multi_pass_offline',
        'builtAt': _utc_now(),
        'concepts': concepts,
        'conceptCount': len(concepts),
        'detailCount': sum(len(c.get('details') or []) for c in concepts),
        'events': [],
        'problems': problems,
        'sections': sections[:40],
        'deepseekPasses': 1,
        'expectsPass2': False,
        'gtProvenance': {
            'typeSource': type_source,
            'typeConfidence': round(type_conf, 4),
            'offlinePassAudit': pass_audit,
            'reconcileStats': reconcile_stats,
        },
    }


def build_template_gt_for_pool_entry(entry: dict[str, Any]) -> dict[str, Any]:
    return build_template_gt_from_pdf(
        course_id=str(entry.get('courseId') or ''),
        file_id=str(entry.get('fileId') or ''),
        filename=str(entry.get('filename') or entry.get('fileId') or ''),
        pool_file_type_hint=str(entry.get('fileType') or entry.get('expectedFileType') or ''),
    )


def template_gt_to_eval_fragment(record: dict[str, Any]) -> dict[str, Any]:
    """Parser-shaped fragment from a template GT record (simulates skip-pass1 output)."""
    course_id = str(record.get('courseId') or '')
    file_id = str(record.get('fileId') or '')
    return {
        'concepts': [
            {
                'courseid': course_id,
                'name': c['name'],
                'sourceFiles': [file_id],
                'details': [{'name': d} for d in c.get('details') or []],
            }
            for c in (record.get('concepts') or [])
            if isinstance(c, dict) and c.get('name')
        ],
        'problems': [
            {'courseid': course_id, 'fileid': file_id, 'name': name}
            for name in (record.get('problems') or [])
            if name
        ],
        'files': {
            course_id: {
                file_id: {
                    'fileid': file_id,
                    'name': record.get('filename') or file_id,
                    'academicFileType': record.get('expectedFileType') or '',
                },
            },
        },
        '_meta': {'deepseek_passes': 0},
    }


def _empty_gt_record(
    *,
    course_id: str,
    file_id: str,
    filename: str,
    expected_file_type: str,
    pass_audit: dict[str, Any],
    error: str,
) -> dict[str, Any]:
    plan = plan_passes_for_file(
        course_id=course_id,
        file_id=file_id,
        filename=filename,
        file_type_hint=expected_file_type,
    )
    return {
        'version': 1,
        'courseId': str(course_id),
        'fileId': str(file_id),
        'filename': filename,
        'expectedFileType': expected_file_type,
        'passPlan': plan.to_dict(),
        'passAudit': {'error': error},
        'passes': list(TEMPLATE_GT_PASSES),
        'buildMode': 'template_multi_pass_offline',
        'builtAt': _utc_now(),
        'concepts': [],
        'conceptCount': 0,
        'detailCount': 0,
        'events': [],
        'problems': [],
        'sections': [],
        'deepseekPasses': 0,
        'expectsPass2': False,
        'gtProvenance': {'offlinePassAudit': pass_audit, 'error': error},
    }
