"""Ground-truth extraction and multi-pass quality parse for file-level eval."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from canvas_parser.content.teaching_blocks import extract_teaching_units_from_pages
from canvas_parser.parse.file_types import normalize_file_type_id
from canvas_parser.parse.parse_pass_plan import audit_fragment_passes, plan_passes_for_file
from canvas_parser.weekly_iteration.match_utils import names_match, normalize_name


GT_PASSES = (
    'extract_pages',
    'heuristic_classify',
    'llm_classify',
    'llm_pass1',
    'llm_pass2',
    'finalize',
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _course_file_node(fragment: dict[str, Any], course_id: str, file_id: str) -> dict[str, Any] | None:
    files = (fragment.get('files') or {}).get(str(course_id)) or {}
    node = files.get(str(file_id))
    return node if isinstance(node, dict) else None


def _concepts_for_file(fragment: dict[str, Any], course_id: str, file_id: str) -> list[dict[str, Any]]:
    fid = str(file_id)
    rows: list[dict[str, Any]] = []
    for concept in fragment.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        if str(concept.get('courseid') or '') != str(course_id):
            continue
        source_files = concept.get('sourceFiles') or concept.get('sourcefiles') or []
        linked = str(concept.get('fileid') or concept.get('sourceFileId') or '')
        if linked == fid or fid in {str(x) for x in source_files}:
            details = [
                str(d.get('name') or '').strip()
                for d in (concept.get('details') or [])
                if isinstance(d, dict) and str(d.get('name') or '').strip()
            ]
            rows.append({
                'name': str(concept.get('name') or '').strip(),
                'details': details[:40],
            })
    # Fallback: concepts logged for this file via file node children
    node = _course_file_node(fragment, course_id, file_id)
    if node:
        for child in node.get('conceptChildren') or node.get('conceptchildren') or []:
            if isinstance(child, dict):
                name = str(child.get('name') or child.get('conceptName') or '').strip()
                if name and not any(r['name'] == name for r in rows):
                    rows.append({'name': name, 'details': []})
    return [row for row in rows if row.get('name')]


def _events_for_file(fragment: dict[str, Any], course_id: str, file_id: str) -> list[str]:
    names: list[str] = []
    for event in fragment.get('events') or []:
        if not isinstance(event, dict):
            continue
        if str(event.get('courseid') or '') != str(course_id):
            continue
        source = str(event.get('fileid') or event.get('sourceFileId') or '')
        if source == str(file_id):
            name = str(event.get('name') or '').strip()
            if name:
                names.append(name)
    return names


def _problems_for_file(fragment: dict[str, Any], course_id: str, file_id: str) -> list[str]:
    names: list[str] = []
    for problem in fragment.get('problems') or []:
        if not isinstance(problem, dict):
            continue
        if str(problem.get('courseid') or '') != str(course_id):
            continue
        source = str(problem.get('fileid') or problem.get('sourceFileId') or '')
        if source == str(file_id):
            name = str(problem.get('name') or problem.get('title') or '').strip()
            if name:
                names.append(name)
    return names


def _sections_from_node(node: dict[str, Any] | None) -> list[str]:
    if not node:
        return []
    pages = node.get('pages') or []
    if pages:
        units = extract_teaching_units_from_pages(pages)
        return [str(u.get('label') or '').strip() for u in units if u.get('label')]
    sections: list[str] = []
    store = node.get('typeExtractions') or {}
    if isinstance(store, dict):
        for bucket in store.values():
            if not isinstance(bucket, dict):
                continue
            for key in ('sections', 'slides'):
                for row in bucket.get(key) or []:
                    if isinstance(row, dict):
                        label = str(row.get('title') or row.get('term') or row.get('name') or '').strip()
                        if label:
                            sections.append(label)
    return sections[:40]


def extract_file_gt_from_fragment(
    fragment: dict[str, Any],
    *,
    course_id: str,
    file_id: str,
    filename: str = '',
    passes_completed: list[str] | None = None,
    build_mode: str = 'quality_multi_pass',
) -> dict[str, Any]:
    """Build a GT record from a parsed file fragment."""
    node = _course_file_node(fragment, course_id, file_id)
    file_type_hint = normalize_file_type_id(
        str(
            (node or {}).get('academicFileType')
            or (node or {}).get('parserFileType')
            or (node or {}).get('fileType')
            or ''
        )
    )
    concepts = _concepts_for_file(fragment, course_id, file_id)
    plan = plan_passes_for_file(
        course_id=course_id,
        file_id=file_id,
        filename=filename or str((node or {}).get('name') or file_id),
        file_type_hint=file_type_hint,
    )
    pass_audit = audit_fragment_passes(
        fragment,
        course_id=course_id,
        file_id=file_id,
        filename=filename or str((node or {}).get('name') or file_id),
        file_type_hint=file_type_hint,
        plan=plan,
    )
    return {
        'version': 1,
        'courseId': str(course_id),
        'fileId': str(file_id),
        'filename': filename or str((node or {}).get('name') or file_id),
        'expectedFileType': file_type_hint,
        'passPlan': plan.to_dict(),
        'passAudit': pass_audit,
        'passes': list(passes_completed or GT_PASSES),
        'buildMode': build_mode,
        'builtAt': _utc_now(),
        'concepts': concepts,
        'conceptCount': len(concepts),
        'detailCount': sum(len(c.get('details') or []) for c in concepts),
        'events': _events_for_file(fragment, course_id, file_id),
        'problems': _problems_for_file(fragment, course_id, file_id),
        'sections': _sections_from_node(node),
        'deepseekPasses': int((fragment.get('_meta') or {}).get('deepseek_passes') or 0),
        'expectsPass2': 'llm_pass2' in plan.needed_pass_ids(),
    }


def save_file_gt(path: Path, record: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding='utf-8')
    return path


def load_file_gt(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding='utf-8'))


def _concept_titles(concepts: list[dict[str, Any]]) -> set[str]:
    titles: set[str] = set()
    for concept in concepts:
        name = normalize_name(str(concept.get('name') or ''))
        if name:
            titles.add(name)
        for detail in concept.get('details') or []:
            if isinstance(detail, str):
                dname = normalize_name(detail)
            elif isinstance(detail, dict):
                dname = normalize_name(str(detail.get('name') or ''))
            else:
                dname = ''
            if dname:
                titles.add(dname)
    return titles


def compare_file_to_gt(candidate: dict[str, Any], gt: dict[str, Any]) -> dict[str, Any]:
    """Score a candidate file fragment against a GT record."""
    course_id = str(gt.get('courseId') or '')
    file_id = str(gt.get('fileId') or '')
    cand = extract_file_gt_from_fragment(
        candidate,
        course_id=course_id,
        file_id=file_id,
        filename=str(gt.get('filename') or ''),
        build_mode='concurrent_eval',
    )
    base_titles = _concept_titles(gt.get('concepts') or [])
    cand_titles = _concept_titles(cand.get('concepts') or [])
    matched = 0
    used: set[str] = set()
    for base in base_titles:
        for cand_title in cand_titles:
            if cand_title in used:
                continue
            if base == cand_title or names_match(base, cand_title):
                matched += 1
                used.add(cand_title)
                break
    recall = matched / len(base_titles) if base_titles else 1.0
    precision = matched / len(cand_titles) if cand_titles else 1.0
    base_details = int(gt.get('detailCount') or 0)
    cand_details = int(cand.get('detailCount') or 0)
    detail_ratio = cand_details / base_details if base_details else 1.0
    type_ok = (
        not gt.get('expectedFileType')
        or cand.get('expectedFileType') == gt.get('expectedFileType')
    )
    cand_audit = audit_fragment_passes(
        candidate,
        course_id=course_id,
        file_id=file_id,
        filename=str(gt.get('filename') or ''),
        file_type_hint=str(gt.get('expectedFileType') or ''),
    )
    pass2_step = next(
        (s for s in (cand_audit.get('steps') or []) if s.get('pass') == 'llm_pass2'),
        {},
    )
    pass2_ok = (
        not gt.get('expectsPass2')
        or int(cand.get('deepseekPasses') or 0) >= 2
        or pass2_step.get('verdict') == 'skipped_ok'
    )
    passed = recall >= 0.80 and detail_ratio >= 0.65 and type_ok and pass2_ok
    missing = sorted(
        title for title in base_titles
        if not any(names_match(title, cand) for cand in cand_titles)
    )[:12]
    return {
        'courseId': course_id,
        'fileId': file_id,
        'filename': gt.get('filename'),
        'passed': passed,
        'conceptRecall': round(recall, 4),
        'conceptPrecision': round(precision, 4),
        'detailRatio': round(detail_ratio, 4),
        'fileTypeMatch': type_ok,
        'pass2Complete': pass2_ok,
        'passAudit': cand_audit,
        'expectedFileType': gt.get('expectedFileType'),
        'actualFileType': cand.get('expectedFileType'),
        'deepseekPasses': cand.get('deepseekPasses'),
        'expectedDeepseekPasses': 2 if gt.get('expectsPass2') else 1,
        'missingConceptsSample': missing,
        'candidate': cand,
    }
