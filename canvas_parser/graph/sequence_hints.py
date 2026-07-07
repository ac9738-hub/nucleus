"""Confident document-order and heading-based sequence hints for parser concepts."""
from __future__ import annotations

import re
from typing import Any, Callable

LECTURE_HEADING = re.compile(r'\b(?:lecture|lec|class|session)\s*[#.]?\s*(\d+)\b', re.I)
WEEK_HEADING = re.compile(r'\bweek\s*(\d+)\b', re.I)
CHAPTER_HEADING = re.compile(r'\b(?:chapter|ch\.?)\s*(\d+)\b', re.I)
SECTION_NUMBER = re.compile(r'^(\d+(?:\.\d+)+)\s+')
UNIT_HEADING = re.compile(r'\bunit\s*(\d+)\b', re.I)
PROBLEM_HEADING = re.compile(r'\b(?:problem|exercise|question|ex\.?|q\.?)\s*[#.]?\s*(\d+[\w.]*)', re.I)


def parse_heading_numbers(name: str) -> dict[str, float]:
    """Extract structural numbers from a teaching-unit title when unambiguous."""
    text = str(name or '').strip()
    if not text:
        return {}

    numbers: dict[str, float] = {}
    section_match = SECTION_NUMBER.match(text)
    if section_match:
        parts = section_match.group(1).split('.')
        numbers['sectionMajor'] = float(parts[0])
        if len(parts) > 1:
            numbers['sectionMinor'] = float(parts[1])
        numbers['sectionPath'] = float(section_match.group(1).replace('.', ''))
    else:
        embedded = re.search(r'\b(\d+)\.(\d+)\b', text)
        if embedded:
            numbers['sectionMajor'] = float(embedded.group(1))
            numbers['sectionMinor'] = float(embedded.group(2))
            numbers['sectionPath'] = float(f"{embedded.group(1)}{embedded.group(2)}")

    for pattern, key in (
        (LECTURE_HEADING, 'lecture'),
        (WEEK_HEADING, 'week'),
        (CHAPTER_HEADING, 'chapter'),
        (UNIT_HEADING, 'unit'),
    ):
        match = pattern.search(text)
        if match:
            numbers[key] = float(match.group(1))

    problem_match = PROBLEM_HEADING.search(text)
    if problem_match:
        raw = str(problem_match.group(1) or '')
        num_match = re.search(r'(\d+(?:\.\d+)?)', raw)
        if num_match:
            numbers['problem'] = float(num_match.group(1))

    return numbers


def build_document_order(unit: dict, *, file_id: str = '', sequence_index: int = 0) -> dict:
    page_number = unit.get('pageNumber')
    try:
        page_value = float(page_number)
    except (TypeError, ValueError):
        page_value = 0.0
    y_ratio = unit.get('yRatio0')
    try:
        y_value = float(y_ratio)
    except (TypeError, ValueError):
        y_value = 0.0

    heading = parse_heading_numbers(str(unit.get('name') or ''))
    return {
        'fileId': str(file_id or ''),
        'sequenceIndex': int(sequence_index),
        'pageNumber': page_value,
        'yRatio0': y_value,
        'heading': heading,
    }


def document_order_sort_key(document_order: dict | None) -> tuple:
    order = document_order if isinstance(document_order, dict) else {}
    heading = order.get('heading') if isinstance(order.get('heading'), dict) else {}
    return (
        str(order.get('fileId') or ''),
        float(order.get('pageNumber') or 0),
        float(order.get('yRatio0') or 0),
        float(heading.get('lecture') or heading.get('week') or heading.get('chapter') or heading.get('unit') or 0),
        float(heading.get('sectionMajor') or 0),
        float(heading.get('sectionMinor') or 0),
        float(heading.get('problem') or 0),
        int(order.get('sequenceIndex') or 0),
    )


def merge_document_order(existing: dict | None, incoming: dict | None) -> dict:
    if not isinstance(incoming, dict) or not incoming:
        return existing if isinstance(existing, dict) else {}
    if not isinstance(existing, dict) or not existing:
        return dict(incoming)
    merged = dict(existing)
    for key in ('fileId', 'sequenceIndex', 'pageNumber', 'yRatio0'):
        if key in incoming and incoming[key] not in (None, '', 0):
            merged[key] = incoming[key]
    old_heading = merged.get('heading') if isinstance(merged.get('heading'), dict) else {}
    new_heading = incoming.get('heading') if isinstance(incoming.get('heading'), dict) else {}
    merged['heading'] = {**old_heading, **new_heading}
    return merged


def attach_module_hint_from_file(
    course_id: str,
    concept_id: str,
    file_id: str,
    module_order_hints: dict,
    record_hint: Callable[[str, str, str, int], None],
) -> None:
    hint = (module_order_hints or {}).get(str(file_id))
    if not isinstance(hint, dict):
        return
    module_id = hint.get('moduleId')
    if not module_id:
        return
    record_hint(course_id, concept_id, str(module_id), int(hint.get('position') or 0))


def apply_outline_sequence_edges(
    course_id: str,
    outline_rows: list[dict],
    find_concept: Callable[[str, str], Any],
    add_prerequisite: Callable[[str, str, str, str, float], dict],
    *,
    min_confidence: float = 0.8,
) -> int:
    """Link adjacent outline concepts from the same file when order is monotonic."""
    if len(outline_rows) < 2:
        return 0

    rows = sorted(outline_rows, key=lambda row: document_order_sort_key(row.get('documentOrder')))
    added = 0
    prior: dict | None = None
    prior_concept = None

    for row in rows:
        concept = find_concept(course_id, row.get('conceptId') or row.get('name') or '')
        if not concept:
            continue
        order = row.get('documentOrder') if isinstance(row.get('documentOrder'), dict) else {}
        if prior and prior_concept:
            same_file = str(prior.get('documentOrder', {}).get('fileId') or '') == str(order.get('fileId') or '')
            if same_file and _confident_follows(prior.get('documentOrder'), order):
                result = add_prerequisite(
                    course_id,
                    prior_concept.conceptid,
                    concept.conceptid,
                    'document_order',
                    min_confidence,
                )
                if result.get('status') == 'SUCCESS':
                    added += 1
        prior = row
        prior_concept = concept
    return added


def _confident_follows(left: dict | None, right: dict | None) -> bool:
    left = left if isinstance(left, dict) else {}
    right = right if isinstance(right, dict) else {}
    left_heading = left.get('heading') if isinstance(left.get('heading'), dict) else {}
    right_heading = right.get('heading') if isinstance(right.get('heading'), dict) else {}

    for key in ('sectionMajor', 'sectionMinor', 'lecture', 'week', 'chapter', 'unit', 'problem'):
        left_val = left_heading.get(key)
        right_val = right_heading.get(key)
        if left_val is None or right_val is None:
            continue
        if right_val > left_val:
            return True
        if right_val < left_val:
            return False

    left_page = float(left.get('pageNumber') or 0)
    right_page = float(right.get('pageNumber') or 0)
    if left_page and right_page and right_page >= left_page:
        left_seq = int(left.get('sequenceIndex') or 0)
        right_seq = int(right.get('sequenceIndex') or 0)
        if right_seq > left_seq:
            return True
    return False


def sort_concepts_by_document_order(concepts: list[dict]) -> list[str]:
    """Return concept IDs sorted by documentOrder hints."""
    rows = []
    for concept in concepts:
        concept_id = concept.get('conceptid')
        if not concept_id:
            continue
        rows.append((document_order_sort_key(concept.get('documentOrder')), str(concept_id)))
    rows.sort(key=lambda pair: pair[0])
    return [concept_id for _, concept_id in rows]
