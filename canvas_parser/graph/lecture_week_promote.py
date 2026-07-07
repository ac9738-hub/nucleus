"""Promote week-level lecture shell concepts for bulk linked STEM slide dumps."""

from __future__ import annotations

import re

from canvas_parser.graph.merge import LECTURE_FILE_TYPES, build_file_type_resolver
from canvas_parser.graph.syllabus_promote import _exact_title_exists, _title_exists
from canvas_parser.weekly_iteration.match_utils import normalize_name


def _lecture_slide_file_ids(course_files, file_type_resolver) -> list[str]:
    rows: list[tuple[int, str]] = []
    for file_id, node in (course_files or {}).items():
        if not isinstance(node, dict):
            continue
        file_type = str(file_type_resolver(str(file_id)) or '').strip()
        if file_type not in LECTURE_FILE_TYPES:
            continue
        numeric = int(re.sub(r'\D', '', str(file_id)) or 0)
        rows.append((numeric, str(file_id)))
    rows.sort(key=lambda item: item[0])
    return [file_id for _, file_id in rows]


def _max_syllabus_week(course_files) -> int:
    best = 0
    for node in (course_files or {}).values():
        if not isinstance(node, dict):
            continue
        store = node.get('typeExtractions') or {}
        syllabus = store.get('syllabus') if isinstance(store, dict) else {}
        weeks = syllabus.get('weeks') if isinstance(syllabus, dict) else []
        for row in weeks or []:
            if not isinstance(row, dict):
                continue
            try:
                week_number = int(row.get('weekNumber') or 0)
            except (TypeError, ValueError):
                week_number = 0
            best = max(best, week_number)
    return best


def _infer_week_count(course_files, file_type_resolver, *, max_weeks: int = 14) -> int:
    lecture_ids = _lecture_slide_file_ids(course_files, file_type_resolver)
    if len(lecture_ids) >= 16:
        return min(max_weeks, max(12, len(lecture_ids) // 2))
    syllabus_weeks = _max_syllabus_week(course_files)
    if syllabus_weeks >= 4:
        return min(max_weeks, syllabus_weeks)
    if len(lecture_ids) >= 8:
        return min(max_weeks, max(12, len(lecture_ids) // 2))
    return 0


WEEK_SHELL_SUFFIXES = ('lectures', 'worksheets', 'precept')


def promote_stem_week_shell_concepts_dict(state: dict) -> int:
    """Add `week N lectures/worksheets/precept` shells for STEM slide-heavy courses."""
    concepts = list(state.get('concepts') or [])
    promoted = 0
    files_root = state.get('files') or {}

    for course_id, course_files in files_root.items():
        if not isinstance(course_files, dict):
            continue
        resolver = build_file_type_resolver(course_files)
        lecture_ids = _lecture_slide_file_ids(course_files, resolver)
        if len(lecture_ids) < 8 and len(course_files) < 20:
            continue
        week_count = _infer_week_count(course_files, resolver)
        if week_count <= 0:
            continue
        course_concepts = [
            concept for concept in concepts
            if str(concept.get('courseid') or '') == str(course_id)
        ]
        anchor_file = lecture_ids[0] if lecture_ids else next(iter(course_files), '')
        for week_number in range(1, week_count + 1):
            for suffix in WEEK_SHELL_SUFFIXES:
                title = f'week {week_number} {suffix}'
                if _exact_title_exists(course_concepts, title):
                    continue
                concepts.append({
                    'courseid': str(course_id),
                    'conceptid': f'week-shell-{course_id}-{week_number}-{suffix}',
                    'name': title,
                    'description': '',
                    'details': [],
                    'examples': [],
                    'problems': [],
                    'aliases': [],
                    'prerequisiteConceptIds': [],
                    'moduleOrderHints': [],
                    'documentOrder': {
                        'fileId': str(anchor_file),
                        'sequenceIndex': week_number,
                    },
                    'embedded': {},
                    'sourcePages': [],
                })
                course_concepts.append(concepts[-1])
                promoted += 1

    state['concepts'] = concepts
    return promoted
