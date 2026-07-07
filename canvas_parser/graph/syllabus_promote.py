"""Promote logged syllabus week rows into lightweight concept nodes for QA recall."""

from __future__ import annotations

from canvas_parser.weekly_iteration.match_utils import names_match, normalize_name


def _syllabus_week_rows(file_node) -> list[dict]:
    if isinstance(file_node, dict):
        store = file_node.get('typeExtractions') or {}
    else:
        store = getattr(file_node, 'typeExtractions', None) or {}
    syllabus = store.get('syllabus') if isinstance(store, dict) else {}
    rows = syllabus.get('weeks') if isinstance(syllabus, dict) else []
    return [row for row in (rows or []) if isinstance(row, dict)]


def _week_concept_title(row: dict) -> str:
    week_number = row.get('weekNumber')
    topic = str(row.get('topic') or '').strip()
    if week_number is None and not topic:
        return ''
    prefix = f'week {week_number}' if week_number is not None else 'week'
    if topic:
        return f'{prefix} {topic}'.strip().lower()
    return prefix.lower()


def _title_exists(concepts, title: str) -> bool:
    target = normalize_name(title)
    if not target:
        return True
    for concept in concepts or []:
        name = normalize_name(str((concept or {}).get('name') or ''))
        if name == target or names_match(title, str((concept or {}).get('name') or '')):
            return True
    return False


def _exact_title_exists(concepts, title: str) -> bool:
    target = normalize_name(title)
    if not target:
        return True
    for concept in concepts or []:
        if normalize_name(str((concept or {}).get('name') or '')) == target:
            return True
    return False


def promote_syllabus_week_concepts_dict(state: dict) -> int:
    """Add one concept per logged syllabus week (deduped by title)."""
    concepts = list(state.get('concepts') or [])
    promoted = 0
    seen_titles: set[str] = set()

    for course_id, course_files in (state.get('files') or {}).items():
        if not isinstance(course_files, dict):
            continue
        course_concepts = [
            concept for concept in concepts
            if str(concept.get('courseid') or '') == str(course_id)
        ]
        for file_id, file_node in course_files.items():
            for index, row in enumerate(_syllabus_week_rows(file_node)):
                title = _week_concept_title(row)
                if not title:
                    continue
                normalized = normalize_name(title)
                if normalized in seen_titles:
                    continue
                if _title_exists(course_concepts, title):
                    seen_titles.add(normalized)
                    continue
                concept_id = f'syllabus-week-{course_id}-{file_id}-{index + 1}'
                concepts.append({
                    'courseid': str(course_id),
                    'conceptid': concept_id,
                    'name': title,
                    'description': str(row.get('topic') or '').strip(),
                    'details': [],
                    'examples': [],
                    'problems': [],
                    'aliases': [],
                    'prerequisiteConceptIds': [],
                    'moduleOrderHints': [],
                    'documentOrder': {
                        'fileId': str(file_id),
                        'sequenceIndex': int(row.get('weekNumber') or index),
                    },
                    'embedded': {},
                    'sourcePages': [],
                })
                course_concepts.append(concepts[-1])
                seen_titles.add(normalized)
                promoted += 1

    state['concepts'] = concepts
    return promoted
