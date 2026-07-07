"""Promote humanities typeExtractions (reading sections) into concept nodes."""

from __future__ import annotations

import re

from canvas_parser.graph.syllabus_promote import _exact_title_exists
from canvas_parser.weekly_iteration.match_utils import names_match, normalize_name

HUMANITIES_FILE_TYPES = frozenset({'humanities_reading', 'literary_work'})

CHAPTER_HEADING_PATTERN = re.compile(
    r'^(?:ch\.?\s*\d+|chapter\s+\d+)\s*[-–:]\s*',
    re.I,
)


def _section_rows(file_node) -> list[dict]:
    if isinstance(file_node, dict):
        store = file_node.get('typeExtractions') or {}
    else:
        store = getattr(file_node, 'typeExtractions', None) or {}
    humanities = store.get('humanities') if isinstance(store, dict) else {}
    rows = humanities.get('sections') if isinstance(humanities, dict) else []
    return [row for row in (rows or []) if isinstance(row, dict)]


def _concept_title_set(concepts) -> set[str]:
    titles: set[str] = set()
    for concept in concepts or []:
        if isinstance(concept, dict):
            name = normalize_name(str(concept.get('name') or ''))
        else:
            name = normalize_name(str(getattr(concept, 'name', '') or ''))
        if name:
            titles.add(name)
    return titles


GENERIC_EXTRACTION_TITLES = frozenset({
    'methods', 'findings', 'claims', 'key terms', 'key_terms', 'theses', 'arguments', 'sections',
})


def _should_add_title(concepts, title: str) -> bool:
    target = normalize_name(title)
    if not target or target in GENERIC_EXTRACTION_TITLES:
        return False
    for concept in concepts or []:
        if isinstance(concept, dict):
            name = str(concept.get('name') or '')
        else:
            name = str(getattr(concept, 'name', '') or '')
        normalized = normalize_name(name)
        if normalized == target:
            return False
        if CHAPTER_HEADING_PATTERN.match(name) and target in normalized:
            continue
        if names_match(name, title):
            return False
    return True


def _title_exists(concepts, title: str) -> bool:
    return not _should_add_title(concepts, title)


def _reading_detail_rows(summary: str) -> list[dict]:
    text = str(summary or '').strip()
    if not text:
        return []
    return [{
        'name': 'Reading excerpt',
        'description': f'Excerpt: {text[:480]}',
        'embedded': {},
        'sourcePages': [],
    }]


def _append_concept(
    concepts,
    course_concepts,
    *,
    course_id: str,
    file_id: str,
    concept_id: str,
    title: str,
    summary: str,
    sequence_index: int,
) -> bool:
    title = str(title or '').strip()
    if not title or _title_exists(course_concepts, title):
        return False
    concepts.append({
        'courseid': str(course_id),
        'conceptid': concept_id,
        'name': title,
        'description': str(summary or '').strip(),
        'details': _reading_detail_rows(summary) if str(summary or '').strip() else [],
        'examples': [],
        'problems': [],
        'aliases': [],
        'prerequisiteConceptIds': [],
        'moduleOrderHints': [],
        'documentOrder': {
            'fileId': str(file_id),
            'sequenceIndex': sequence_index,
        },
        'embedded': {},
        'sourcePages': [],
    })
    course_concepts.append(concepts[-1])
    return True


def _humanities_row_titles(file_node, *, include_research=False) -> list[tuple[str, str, int]]:
    if isinstance(file_node, dict):
        store = file_node.get('typeExtractions') or {}
    else:
        store = getattr(file_node, 'typeExtractions', None) or {}
    rows: list[tuple[str, str, int]] = []
    groups = ['humanities']
    if include_research:
        groups.append('research')
    for group in groups:
        categories = store.get(group) if isinstance(store, dict) else {}
        if not isinstance(categories, dict):
            continue
        for category, entries in categories.items():
            if group == 'research' and category not in {'key_terms', 'claims'}:
                continue
            if not isinstance(entries, list):
                continue
            for index, row in enumerate(entries):
                if not isinstance(row, dict):
                    continue
                if category == 'sections':
                    title = str(row.get('title') or '').strip()
                    summary = str(row.get('summary') or '').strip()
                elif category == 'key_terms':
                    title = str(row.get('term') or '').strip()
                    summary = str(row.get('definition') or '').strip()
                elif category in {'arguments', 'claims'}:
                    title = str(row.get('argument') or row.get('claim') or '').strip()
                    summary = str(row.get('supports') or row.get('evidence') or '').strip()
                    max_title_words = 22
                elif category == 'theses':
                    title = str(row.get('thesis') or '').strip()
                    summary = ''
                else:
                    continue
                if not title:
                    continue
                word_limit = max_title_words if category in {'arguments', 'claims'} else 12
                if len(title.split()) > word_limit:
                    continue
                if normalize_name(title) in GENERIC_EXTRACTION_TITLES:
                    continue
                order = int(row.get('sectionOrder') or row.get('slideOrder') or index + 1)
                rows.append((title, summary, order))
    return rows


def _chapter_segment_titles(name: str) -> list[str]:
    raw = str(name or '').strip()
    if not CHAPTER_HEADING_PATTERN.match(raw):
        return []
    body = CHAPTER_HEADING_PATTERN.sub('', raw).strip()
    if not body:
        return []

    segments: list[str] = []
    if '?' in body:
        tail = body.split('?', 1)[1].strip()
        if tail and len(tail.split()) <= 10:
            segments.append(tail)
    if ':' in body:
        tail = body.split(':', 1)[1].strip()
        if tail and len(tail.split()) <= 10:
            segments.append(tail)

    expanded: list[str] = []
    for segment in segments:
        parts = re.split(r'\s+and\s+', segment, flags=re.I)
        if 1 < len(parts) <= 3 and all(1 <= len(part.split()) <= 6 for part in parts):
            expanded.extend(part.strip() for part in parts if part.strip())
        else:
            expanded.append(segment)
    return expanded


def _colon_clause_titles(text: str, *, max_words: int = 8) -> list[str]:
    """Pull short clause labels from argument/claim prose (colon heads and vs splits)."""
    raw = str(text or '').strip()
    if not raw:
        return []
    titles: list[str] = []
    if ':' in raw:
        tail = raw.split(':', 1)[1].strip()
        for part in re.split(r'\s+vs\.?\s+|\s*;\s*', tail):
            phrase = re.sub(r'\s+', ' ', part.strip().strip('.'))
            if phrase and len(phrase.split()) <= max_words:
                titles.append(phrase)
    if len(raw.split()) <= max_words:
        titles.append(raw)
    seen: set[str] = set()
    out: list[str] = []
    for title in titles:
        normalized = normalize_name(title)
        if not normalized or normalized in seen or normalized in GENERIC_EXTRACTION_TITLES:
            continue
        seen.add(normalized)
        out.append(title)
    return out


def _reading_filename_titles(filename: str) -> list[str]:
    name = str(filename or '').strip()
    if not name.lower().endswith('.pdf'):
        return []
    stem = re.sub(r'\.pdf$', '', name, flags=re.I).strip()
    stem = re.sub(r'^[^,]+,\s*', '', stem).strip()
    stem = re.sub(r'\s*-\s*Ch(?:apter)?\.?\s*\d+.*$', '', stem, flags=re.I).strip()
    stem = re.sub(r'\s*\([^)]*\)\s*$', '', stem).strip()
    titles: list[str] = []
    if stem and len(stem.split()) <= 12:
        titles.append(stem)
    chapter = re.search(r'Ch(?:apter)?\.?\s*(\d+)', name, re.I)
    if chapter and stem:
        titles.append(f"chapter {chapter.group(1)} {stem.lower()}")
    return titles


def promote_humanities_key_term_concepts_dict(
    state: dict,
    *,
    file_type_resolver=None,
    max_words: int = 10,
) -> int:
    """Promote short humanities key terms and argument labels for recall."""
    concepts = list(state.get('concepts') or [])
    promoted = 0

    for course_id, course_files in (state.get('files') or {}).items():
        if not isinstance(course_files, dict):
            continue
        resolver = file_type_resolver
        if resolver is None:
            from canvas_parser.graph.merge import build_file_type_resolver
            resolver = build_file_type_resolver(course_files)
        course_concepts = [
            concept for concept in concepts
            if str(concept.get('courseid') or '') == str(course_id)
        ]
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            file_type = str(resolver(str(file_id)) or '').strip()
            if file_type not in HUMANITIES_FILE_TYPES:
                continue
            for title_index, title in enumerate(_reading_filename_titles(str(file_node.get('name') or ''))):
                if _append_concept(
                    concepts,
                    course_concepts,
                    course_id=str(course_id),
                    file_id=str(file_id),
                    concept_id=f'reading-file-{course_id}-{file_id}-{title_index + 1}',
                    title=title,
                    summary='',
                    sequence_index=0,
                ):
                    promoted += 1
            humanities = (file_node.get('typeExtractions') or {}).get('humanities') or {}
            if not isinstance(humanities, dict):
                continue
            for category in ('key_terms',):
                for index, entry in enumerate(humanities.get(category) or []):
                    if not isinstance(entry, dict):
                        continue
                    title = str(entry.get('term') or '').strip()
                    summary = str(entry.get('definition') or '').strip()
                    if not title or len(title.split()) > max_words:
                        continue
                    if _exact_title_exists(course_concepts, title):
                        continue
                    if _append_concept(
                        concepts,
                        course_concepts,
                        course_id=str(course_id),
                        file_id=str(file_id),
                        concept_id=f'reading-term-{course_id}-{file_id}-{category}-{index + 1}',
                        title=title,
                        summary=summary,
                        sequence_index=index + 1,
                    ):
                        promoted += 1
            for category in ('arguments', 'claims'):
                for index, entry in enumerate(humanities.get(category) or []):
                    if not isinstance(entry, dict):
                        continue
                    argument = str(
                        entry.get('argument') or entry.get('claim') or ''
                    ).strip()
                    if not argument:
                        continue
                    summary = str(entry.get('supports') or entry.get('evidence') or '').strip()
                    titles = list(_colon_clause_titles(argument, max_words=8))
                    if len(argument.split()) <= 22:
                        titles.append(argument)
                    seen: set[str] = set()
                    for seg_index, title in enumerate(titles):
                        normalized = normalize_name(title)
                        if not normalized or normalized in seen:
                            continue
                        seen.add(normalized)
                        if _exact_title_exists(course_concepts, title):
                            continue
                        if _append_concept(
                            concepts,
                            course_concepts,
                            course_id=str(course_id),
                            file_id=str(file_id),
                            concept_id=(
                                f'reading-arg-{course_id}-{file_id}-{category}-'
                                f'{index + 1}-{seg_index + 1}'
                            ),
                            title=title,
                            summary=summary,
                            sequence_index=index + 1,
                        ):
                            promoted += 1

    state['concepts'] = concepts
    return promoted


def promote_humanities_extractions_dict(
    state: dict,
    *,
    file_type_resolver=None,
) -> int:
    """Promote humanities reading rows and chapter segments into concept nodes."""
    concepts = list(state.get('concepts') or [])
    promoted = 0

    for course_id, course_files in (state.get('files') or {}).items():
        if not isinstance(course_files, dict):
            continue
        course_concepts = [
            concept for concept in concepts
            if str(concept.get('courseid') or '') == str(course_id)
        ]
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            file_type = ''
            if file_type_resolver:
                file_type = str(file_type_resolver(str(file_id)) or '').strip()
            include_research = False
            for index, (title, summary, order) in enumerate(
                _humanities_row_titles(file_node, include_research=include_research)
            ):
                if _append_concept(
                    concepts,
                    course_concepts,
                    course_id=str(course_id),
                    file_id=str(file_id),
                    concept_id=f'reading-{course_id}-{file_id}-row-{index + 1}',
                    title=title,
                    summary=summary,
                    sequence_index=order,
                ):
                    promoted += 1

        for index, concept in enumerate(list(course_concepts)):
            name = str(concept.get('name') or '').strip()
            file_id = str((concept.get('documentOrder') or {}).get('fileId') or '')
            if not file_id or not file_type_resolver:
                continue
            file_type = str(file_type_resolver(file_id) or '').strip()
            if file_type not in HUMANITIES_FILE_TYPES:
                continue
            if not CHAPTER_HEADING_PATTERN.match(name):
                continue
            for seg_index, segment in enumerate(_chapter_segment_titles(name)):
                if _append_concept(
                    concepts,
                    course_concepts,
                    course_id=str(course_id),
                    file_id=file_id or f'chapter-{index + 1}',
                    concept_id=f'reading-{course_id}-chapter-{index + 1}-{seg_index + 1}',
                    title=segment,
                    summary='',
                    sequence_index=seg_index + 1,
                ):
                    promoted += 1

    state['concepts'] = concepts
    return promoted


def backfill_humanities_concept_details(state: dict, *, file_type_resolver=None) -> int:
    """Ensure promoted reading concepts carry at least one detail for QA structural gates."""
    added = 0
    for concept in state.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        if concept.get('details'):
            continue
        summary = str(concept.get('description') or '').strip()
        if not summary:
            continue
        file_id = str((concept.get('documentOrder') or {}).get('fileId') or '').strip()
        if file_type_resolver and file_id:
            file_type = str(file_type_resolver(file_id) or '').strip()
            if file_type not in HUMANITIES_FILE_TYPES:
                continue
        elif file_id:
            continue
        concept['details'] = _reading_detail_rows(summary)
        added += 1
    return added


def promote_reading_extractions_dict(state: dict) -> int:
    """Add concept rows from file typeExtractions.humanities.sections (JSON graph)."""
    return promote_humanities_extractions_dict(state)


def promote_reading_extractions_for_course(courseid, concept_list, course_files, *, add_concept_node, find_concept):
    """Promote logged reading sections into concept nodes during parser finalize."""
    promoted = 0
    if not course_files:
        return 0
    for file_id, file_node in course_files.items():
        for index, row in enumerate(_section_rows(file_node)):
            title = str(row.get('title') or '').strip()
            if not title:
                continue
            if find_concept(courseid, title):
                continue
            summary = str(row.get('summary') or '').strip()
            concept_id = add_concept_node(courseid, title, summary)
            if not concept_id:
                continue
            concept = find_concept(courseid, concept_id)
            if concept is not None:
                order = getattr(concept, 'documentOrder', None) or {}
                if isinstance(order, dict):
                    order = dict(order)
                else:
                    order = {}
                order['fileId'] = str(file_id)
                order['sequenceIndex'] = int(row.get('sectionOrder') or index)
                concept.documentOrder = order
            promoted += 1
    return promoted
