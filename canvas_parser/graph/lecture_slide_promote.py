"""Promote logged lecture slide rows into concept nodes."""

from __future__ import annotations

import re

from canvas_parser.graph.merge import LECTURE_FILE_TYPES, build_file_type_resolver
from canvas_parser.graph.syllabus_promote import _exact_title_exists, _title_exists
from canvas_parser.weekly_iteration.match_utils import normalize_name


GENERIC_SLIDE_TITLES = frozenset({
    'title slide',
    'synthesis question',
    'scale bar note',
    'agricultural landscape image',
    'villa emo interior image',
    'villa emo landscape image',
    'villa barbaro fresco detail',
    'temple of heaven - interior details',
})

_IMAGE_SUFFIX_PATTERN = re.compile(
    r'\b(?:image|detail|view|exterior|interior|aerial view|3d model)\s*$',
    re.I,
)


def _lecture_slide_rows(file_node) -> list[dict]:
    if isinstance(file_node, dict):
        store = file_node.get('typeExtractions') or {}
    else:
        store = getattr(file_node, 'typeExtractions', None) or {}
    lecture = store.get('lecture') if isinstance(store, dict) else {}
    rows = lecture.get('slides') if isinstance(lecture, dict) else []
    return [row for row in (rows or []) if isinstance(row, dict)]


def _slide_detail_rows(summary: str) -> list[dict]:
    text = str(summary or '').strip()
    if not text:
        return []
    return [{
        'name': 'Slide summary',
        'description': f'Excerpt: {text[:480]}',
        'embedded': {},
        'sourcePages': [],
    }]


def _slide_concept_names(title: str) -> list[str]:
    text = str(title or '').strip()
    names = [text]
    if ' - ' in text:
        head = text.split(' - ', 1)[0].strip()
        if head and len(head.split()) <= 10:
            if normalize_name(head) != normalize_name(text):
                names.append(head)
    if ':' in text:
        tail = text.split(':', 1)[1].strip()
        if tail and len(tail.split()) <= 12:
            if normalize_name(tail) != normalize_name(text):
                names.append(tail)
    return names


def _is_bulk_stem_slide_candidate(title: str) -> bool:
    text = str(title or '').strip()
    if not text or normalize_name(text) in GENERIC_SLIDE_TITLES:
        return False
    if _IMAGE_SUFFIX_PATTERN.search(text):
        return False
    if len(text.split()) > 14:
        return False
    if ' - ' in text and len(text.split(' - ', 1)[0].split()) <= 8:
        return True
    if re.search(r'\([A-Za-z]{1,3}\)\s*$', text):
        return True
    if len(text.split()) <= 5:
        return True
    return _is_promotable_slide_title(text)


def _bulk_stem_slide_names(title: str) -> list[str]:
    """Recall-oriented short labels from linked-lecture STEM slide titles."""
    text = str(title or '').strip()
    names: list[str] = []
    seen: set[str] = set()

    def add(name: str) -> None:
        cleaned = str(name or '').strip()
        normalized = normalize_name(cleaned)
        if not cleaned or not normalized or normalized in seen:
            return
        seen.add(normalized)
        names.append(cleaned)

    if len(text.split()) <= 5:
        add(text)
    for name in _slide_concept_names(text):
        if len(name.split()) <= 10:
            add(name)
    return names


def _is_selective_bulk_stem_name(name: str) -> bool:
    """Keep recall-oriented short labels; skip long slide titles that flood the cap."""
    text = str(name or '').strip()
    if not text:
        return False
    word_count = len(text.split())
    if word_count > 8:
        return False
    if word_count <= 6:
        return True
    if re.search(r'\([A-Za-z]{1,3}\)\s*$', text):
        return True
    return False


def _bulk_stem_recall_names(title: str) -> list[str]:
    """Short recall labels only — dash heads, element symbols, and ≤5-word titles."""
    text = str(title or '').strip()
    names: list[str] = []
    seen: set[str] = set()

    def add(name: str) -> None:
        cleaned = str(name or '').strip()
        normalized = normalize_name(cleaned)
        if not cleaned or not normalized or normalized in seen:
            return
        if not _is_selective_bulk_stem_name(cleaned):
            return
        seen.add(normalized)
        names.append(cleaned)

    if ' - ' in text:
        add(text.split(' - ', 1)[0].strip())
    elif re.search(r'\([A-Za-z]{1,3}\)\s*$', text):
        add(text)
    elif len(text.split()) <= 5:
        add(text)
    return names


_MAX_BULK_STEM_RECALL_BOOST = 6


def promote_bulk_stem_recall_boost_dict(state: dict) -> int:
    """Post-cap recall boost: a few short slide labels for bulk STEM dumps."""
    from canvas_parser.graph.merge import _course_is_bulk_linked_lecture_stem

    concepts = list(state.get('concepts') or [])
    promoted = 0

    for course_id, course_files in (state.get('files') or {}).items():
        if not isinstance(course_files, dict):
            continue
        resolver = build_file_type_resolver(course_files)
        if not _course_is_bulk_linked_lecture_stem(course_files, resolver):
            continue
        course_concepts = [
            concept for concept in concepts
            if str(concept.get('courseid') or '') == str(course_id)
        ]
        course_promoted = 0
        for file_id, file_node in course_files.items():
            if course_promoted >= _MAX_BULK_STEM_RECALL_BOOST:
                break
            if not isinstance(file_node, dict):
                continue
            if str(resolver(str(file_id)) or '').strip() not in LECTURE_FILE_TYPES:
                continue
            for index, row in enumerate(_lecture_slide_rows(file_node)):
                if course_promoted >= _MAX_BULK_STEM_RECALL_BOOST:
                    break
                raw_title = str(row.get('title') or '').strip()
                if not _is_bulk_stem_slide_candidate(raw_title):
                    continue
                for name_index, title in enumerate(_bulk_stem_recall_names(raw_title)):
                    if _exact_title_exists(course_concepts, title):
                        continue
                    concepts.append({
                        'courseid': str(course_id),
                        'conceptid': f'lecture-recall-{course_id}-{file_id}-{index + 1}-{name_index + 1}',
                        'name': title,
                        'description': '',
                        'details': [],
                        'examples': [],
                        'problems': [],
                        'aliases': [],
                        'prerequisiteConceptIds': [],
                        'moduleOrderHints': [],
                        'documentOrder': {
                            'fileId': str(file_id),
                            'sequenceIndex': int(row.get('slideOrder') or index + 1),
                        },
                        'embedded': {},
                        'sourcePages': [],
                    })
                    course_concepts.append(concepts[-1])
                    promoted += 1
                    course_promoted += 1
                    if course_promoted >= _MAX_BULK_STEM_RECALL_BOOST:
                        break

    state['concepts'] = concepts
    return promoted


def promote_bulk_stem_slide_concepts_dict(state: dict) -> int:
    """Deprecated pre-cap bulk promote — retained for tests; use recall boost after cap."""
    return 0


def _is_promotable_slide_title(title: str) -> bool:
    text = str(title or '').strip()
    if not text:
        return False
    normalized = normalize_name(text)
    if normalized in GENERIC_SLIDE_TITLES:
        return False
    if len(text.split()) > 14:
        return False
    if len(text.split()) <= 2 and re.match(r'^\d', text):
        return True
    if _IMAGE_SUFFIX_PATTERN.search(text):
        return False
    return True


def _numbered_heading_titles(title: str) -> list[str]:
    """Synthesize quality-style outline labels from lecture slide titles."""
    text = str(title or '').strip()
    if not text:
        return []
    names: list[str] = []
    match = re.match(r'^(\d+)\s*:\s*(.+)$', text, re.I)
    if match and len(match.group(2).split()) >= 2:
        names.append(f"{match.group(1)} {match.group(2).strip().lower()}")
    match = re.search(r'(?:^Title:\s*)?ART\s*102\s*(\d+)\.(\d+)\s*:\s*(.+)$', text, re.I)
    if match:
        names.append(f"{match.group(1)} {match.group(2)} {match.group(3).strip().lower()}")
    if ':' in text:
        tail = text.split(':', 1)[1].strip()
        if tail and 2 <= len(tail.split()) <= 12:
            lowered = tail.lower()
            if all(normalize_name(lowered) != normalize_name(name) for name in names):
                names.append(lowered)
    return names


def promote_numbered_slide_heading_concepts_dict(state: dict) -> int:
    """Add outline-style numbered headings derived from lecture slide titles."""
    from canvas_parser.graph.merge import _course_is_lecture_slides_heavy

    concepts = list(state.get('concepts') or [])
    promoted = 0

    for course_id, course_files in (state.get('files') or {}).items():
        if not isinstance(course_files, dict):
            continue
        resolver = build_file_type_resolver(course_files)
        if not _course_is_lecture_slides_heavy(course_files, resolver):
            continue
        course_concepts = [
            concept for concept in concepts
            if str(concept.get('courseid') or '') == str(course_id)
        ]
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            if str(resolver(str(file_id)) or '').strip() not in LECTURE_FILE_TYPES:
                continue
            for index, row in enumerate(_lecture_slide_rows(file_node)):
                raw_title = str(row.get('title') or '').strip()
                if not raw_title:
                    continue
                for name_index, title in enumerate(_numbered_heading_titles(raw_title)):
                    if _exact_title_exists(course_concepts, title):
                        continue
                    concepts.append({
                        'courseid': str(course_id),
                        'conceptid': f'lecture-heading-{course_id}-{file_id}-{index + 1}-{name_index + 1}',
                        'name': title,
                        'description': '',
                        'details': [],
                        'examples': [],
                        'problems': [],
                        'aliases': [],
                        'prerequisiteConceptIds': [],
                        'moduleOrderHints': [],
                        'documentOrder': {
                            'fileId': str(file_id),
                            'sequenceIndex': int(row.get('slideOrder') or index + 1),
                        },
                        'embedded': {},
                        'sourcePages': [],
                    })
                    course_concepts.append(concepts[-1])
                    promoted += 1

    state['concepts'] = concepts
    return promoted


def promote_lecture_slide_concepts_dict(state: dict) -> int:
    """Add concept nodes from logged lecture slide titles (lecture-heavy courses)."""
    from canvas_parser.graph.merge import _course_is_lecture_slides_heavy

    concepts = list(state.get('concepts') or [])
    promoted = 0

    for course_id, course_files in (state.get('files') or {}).items():
        if not isinstance(course_files, dict):
            continue
        resolver = build_file_type_resolver(course_files)
        if not _course_is_lecture_slides_heavy(course_files, resolver):
            continue
        course_concepts = [
            concept for concept in concepts
            if str(concept.get('courseid') or '') == str(course_id)
        ]
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            if str(resolver(str(file_id)) or '').strip() not in LECTURE_FILE_TYPES:
                continue
            for index, row in enumerate(_lecture_slide_rows(file_node)):
                raw_title = str(row.get('title') or '').strip()
                if not _is_promotable_slide_title(raw_title):
                    continue
                summary = str(row.get('summary') or '').strip()
                for name_index, title in enumerate(_slide_concept_names(raw_title)):
                    if _title_exists(course_concepts, title):
                        continue
                    concepts.append({
                        'courseid': str(course_id),
                        'conceptid': f'lecture-slide-{course_id}-{file_id}-{index + 1}-{name_index + 1}',
                        'name': title,
                        'description': summary,
                        'details': _slide_detail_rows(summary),
                        'examples': [],
                        'problems': [],
                        'aliases': [],
                        'prerequisiteConceptIds': [],
                        'moduleOrderHints': [],
                        'documentOrder': {
                            'fileId': str(file_id),
                            'sequenceIndex': int(row.get('slideOrder') or index + 1),
                        },
                        'embedded': {},
                        'sourcePages': [],
                    })
                    course_concepts.append(concepts[-1])
                    promoted += 1

    state['concepts'] = concepts
    return promoted


def promote_lecture_slides_for_file(
    courseid,
    file_id,
    file_node,
    *,
    add_concept_node,
    find_concept,
    add_detail_node=None,
) -> int:
    """Promote log_lecture_slide rows into concept nodes without an LLM pass2."""
    promoted = 0
    rows = _lecture_slide_rows(file_node)
    if not rows:
        return 0
    for index, row in enumerate(rows):
        raw_title = str(row.get('title') or '').strip()
        if not _is_promotable_slide_title(raw_title):
            continue
        summary = str(row.get('summary') or '').strip()
        for title in _slide_concept_names(raw_title):
            concept = find_concept(courseid, title)
            if concept is None:
                concept_id = add_concept_node(courseid, title, summary)
                if not concept_id:
                    continue
                concept = find_concept(courseid, concept_id)
                promoted += 1
            if concept is None:
                continue
            order = getattr(concept, 'documentOrder', None) or {}
            if isinstance(order, dict):
                order = dict(order)
            else:
                order = {}
            order['fileId'] = str(file_id)
            order['sequenceIndex'] = int(row.get('slideOrder') or index + 1)
            concept.documentOrder = order
            if summary and add_detail_node is not None:
                detail_name = 'Slide summary'
                existing = [
                    detail for detail in (getattr(concept, 'details', None) or [])
                    if getattr(detail, 'name', '') == detail_name
                ]
                if not existing:
                    add_detail_node(
                        courseid,
                        concept.conceptid,
                        detail_name,
                        f'Excerpt: {summary[:480]}',
                    )
    return promoted
