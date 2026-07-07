"""Use parser typeExtractions for retrieval ranking, chunk edges, and ordering."""
from __future__ import annotations

import re

WEEK_NUMBER_PATTERN = re.compile(r'\bweek\s*(\d+)\b', re.IGNORECASE)
SLIDE_NUMBER_PATTERN = re.compile(r'\bslide\s*(\d+)\b', re.IGNORECASE)
LECTURE_NUMBER_PATTERN = re.compile(r'\blecture\s*(\d+)\b', re.IGNORECASE)
SECTION_NUMBER_PATTERN = re.compile(r'\bsection\s*([\d.]+)\b', re.IGNORECASE)
TOKEN_PATTERN = re.compile(r'[a-z0-9]{3,}')

ROW_TEXT_KEYS = (
    'title', 'name', 'term', 'topic', 'objective', 'summary', 'text', 'statement',
    'definition', 'question', 'theme', 'claim', 'policyType', 'eventname', 'symbol',
    'setting', 'author', 'isbnOrUrl', 'startDate', 'endDate',
)


def _normalize_text(value):
    return re.sub(r'[^a-z0-9]+', ' ', str(value or '').casefold()).strip()


def _query_terms(query):
    return TOKEN_PATTERN.findall(_normalize_text(query))


def _token_overlap(left, right):
    left_terms = set(_query_terms(left))
    right_terms = set(_query_terms(right))
    if not left_terms or not right_terms:
        return 0
    return len(left_terms & right_terms)


def _iter_type_rows(type_extractions):
    if not isinstance(type_extractions, dict):
        return
    for group, categories in type_extractions.items():
        if not isinstance(categories, dict):
            continue
        for category, rows in categories.items():
            if not isinstance(rows, list):
                continue
            for row in rows:
                if isinstance(row, dict):
                    yield str(group), str(category), row


def row_label(row, category=''):
    for key in ROW_TEXT_KEYS:
        value = row.get(key)
        if value:
            return str(value)
    if row.get('sectionNumber') not in (None, ''):
        return f"Section {row['sectionNumber']}"
    if row.get('weekNumber') not in (None, ''):
        return f"Week {row['weekNumber']}"
    if row.get('slideOrder') not in (None, ''):
        return f"Slide {row['slideOrder']}"
    if row.get('sectionOrder') not in (None, ''):
        return f"Section {row['sectionOrder']}"
    return str(category or '')


def row_searchable_text(row):
    parts = []
    for key in ROW_TEXT_KEYS:
        value = row.get(key)
        if isinstance(value, list):
            parts.extend(str(item) for item in value if item)
        elif value not in (None, ''):
            parts.append(str(value))
    readings = row.get('readings')
    if isinstance(readings, list):
        parts.extend(str(item) for item in readings if item)
    return ' '.join(parts)


def type_extraction_search_text(type_extractions, max_chars=5000):
    if not isinstance(type_extractions, dict):
        return ''
    parts = []
    for _, category, row in _iter_type_rows(type_extractions):
        label = row_label(row, category)
        if label:
            parts.append(label)
        body = row_searchable_text(row)
        if body:
            parts.append(body)
    text = ' '.join(part for part in parts if part).strip()
    if len(text) > max_chars:
        return text[:max_chars]
    return text


def _type_extraction_edge(group, category, row):
    edge = {
        'type': 'type-extraction',
        'group': group,
        'category': category,
        'label': row_label(row, category),
        'summary': row_searchable_text(row),
    }
    for key in ('pageid', 'slideOrder', 'sectionOrder', 'sectionNumber', 'weekNumber'):
        if row.get(key) not in (None, ''):
            edge[key] = row.get(key)
    return edge


def attach_type_extraction_edges(chunks, type_extractions):
    if not chunks or not isinstance(type_extractions, dict):
        return chunks

    enriched = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            enriched.append(chunk)
            continue
        edges = list(chunk.get('edges') or []) if isinstance(chunk.get('edges'), list) else []
        source = chunk.get('source') if isinstance(chunk.get('source'), dict) else {}
        pageid = str(source.get('pageid') or '')
        block_index = source.get('blockIndex')

        for group, category, row in _iter_type_rows(type_extractions):
            matched = False
            row_pageid = str(row.get('pageid') or '')
            if row_pageid and pageid and row_pageid == pageid:
                matched = True
            elif block_index is not None:
                slide_order = row.get('slideOrder')
                section_order = row.get('sectionOrder')
                block_idx = int(block_index)
                if slide_order is not None and block_idx in {int(slide_order) - 1, int(slide_order)}:
                    matched = True
                elif section_order is not None and block_idx in {int(section_order) - 1, int(section_order)}:
                    matched = True

            if not matched:
                continue
            edge = _type_extraction_edge(group, category, row)
            if edge not in edges:
                edges.append(edge)

        enriched.append({**chunk, 'edges': edges})
    return enriched


def chunk_sequential_order(chunk):
    orders = []
    for edge in chunk.get('edges') or []:
        if not isinstance(edge, dict) or edge.get('type') != 'type-extraction':
            continue
        for key in ('slideOrder', 'sectionOrder', 'weekNumber'):
            value = edge.get(key)
            if value not in (None, ''):
                try:
                    orders.append(int(value))
                except (TypeError, ValueError):
                    pass
    if orders:
        return min(orders)
    source = chunk.get('source') if isinstance(chunk.get('source'), dict) else {}
    block_index = source.get('blockIndex')
    if block_index is not None:
        try:
            return int(block_index) + 1
        except (TypeError, ValueError):
            pass
    return 9999


def type_extraction_chunk_score_boost(query, chunk):
    terms = _query_terms(query)
    if not terms:
        return 0.0

    boost = 0.0
    lowered_query = _normalize_text(query)
    for edge in chunk.get('edges') or []:
        if not isinstance(edge, dict) or edge.get('type') != 'type-extraction':
            continue
        haystack = _normalize_text(' '.join([
            str(edge.get('label') or ''),
            str(edge.get('summary') or ''),
            str(edge.get('sectionNumber') or ''),
        ]))
        if not haystack:
            continue
        boost += sum(1 for term in terms if term in haystack) * 0.35

        slide_order = edge.get('slideOrder')
        slide_match = SLIDE_NUMBER_PATTERN.search(query)
        if slide_match and slide_order is not None and str(slide_order) == slide_match.group(1):
            boost += 2.5

        week_match = WEEK_NUMBER_PATTERN.search(query)
        if week_match and edge.get('weekNumber') is not None and str(edge.get('weekNumber')) == week_match.group(1):
            boost += 1.8

        section_match = SECTION_NUMBER_PATTERN.search(query)
        if section_match and edge.get('sectionNumber') is not None:
            if str(edge.get('sectionNumber')).startswith(section_match.group(1)):
                boost += 1.5

        if edge.get('category') == 'policies' and any(
            token in lowered_query for token in ('grading', 'policy', 'attendance', 'late', 'collaboration')
        ):
            boost += 0.8

    return boost


def type_extraction_query_boost(query, nodetype, node, *, academic_file_type='', type_extractions=None):
    store = type_extractions
    if store is None:
        store = getattr(node, 'typeExtractions', None) if node is not None else None
    if not isinstance(store, dict):
        store = {}

    if nodetype not in {'file', 'syllabus'} or not store:
        return 0.0

    boost = 0.0
    lowered = _normalize_text(query)
    academic = str(
        academic_file_type
        or getattr(node, 'academicFileType', '')
        or ''
    ).casefold()

    week_match = WEEK_NUMBER_PATTERN.search(query)
    if week_match:
        week_num = int(week_match.group(1))
        for row in store.get('syllabus', {}).get('weeks', []) or []:
            if not isinstance(row, dict):
                continue
            if row.get('weekNumber') == week_num:
                boost += 0.28
                topic = str(row.get('topic') or '')
                if topic and _token_overlap(topic, query) >= 2:
                    boost += 0.12
                for reading in row.get('readings') or []:
                    if _token_overlap(reading, query) >= 1:
                        boost += 0.1

    if any(token in lowered for token in ('grading', 'policy', 'attendance', 'late work', 'collaboration')):
        policies = store.get('syllabus', {}).get('policies') or []
        if policies:
            boost += 0.18
            for row in policies:
                if isinstance(row, dict) and _token_overlap(row.get('text', ''), query) >= 2:
                    boost += 0.16
                    break

    if 'textbook' in lowered or 'required text' in lowered:
        if store.get('syllabus', {}).get('textbooks'):
            boost += 0.16

    slide_match = SLIDE_NUMBER_PATTERN.search(query)
    if slide_match:
        slide_num = int(slide_match.group(1))
        for row in store.get('lecture', {}).get('slides') or []:
            if isinstance(row, dict) and row.get('slideOrder') == slide_num:
                boost += 0.32
                break

    if nodetype == 'file':
        if academic in {'lecture_slides', 'lecture_notes'} and any(
            token in lowered for token in ('slide', 'lecture', 'deck', 'objective')
        ):
            if store.get('lecture'):
                boost += 0.12

        if academic == 'textbook_chapter' and store.get('textbook'):
            boost += 0.1

        if academic == 'humanities_reading':
            for row in store.get('humanities', {}).get('sections') or []:
                if not isinstance(row, dict):
                    continue
                title = str(row.get('title') or '')
                if title and _normalize_text(title) in lowered:
                    boost += 0.24

        if academic == 'literary_work':
            for category in ('characters', 'themes'):
                for row in store.get('literary', {}).get(category) or []:
                    if not isinstance(row, dict):
                        continue
                    label = _normalize_text(row_label(row, category))
                    if label and label in lowered:
                        boost += 0.26

        for row in store.get('lecture', {}).get('key_terms') or []:
            if not isinstance(row, dict):
                continue
            term = _normalize_text(row.get('term') or '')
            if term and term in lowered:
                boost += 0.22

        for row in store.get('textbook', {}).get('definitions') or []:
            if not isinstance(row, dict):
                continue
            term = _normalize_text(row.get('term') or '')
            if term and term in lowered:
                boost += 0.22

    return min(boost, 0.72)


def week_match_boost_from_type_extractions(query, type_extractions):
    week_match = WEEK_NUMBER_PATTERN.search(query)
    if not week_match or not isinstance(type_extractions, dict):
        return 0.0
    week_num = int(week_match.group(1))
    for row in type_extractions.get('syllabus', {}).get('weeks', []) or []:
        if isinstance(row, dict) and row.get('weekNumber') == week_num:
            return 0.22
    return 0.0
