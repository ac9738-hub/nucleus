"""Promote log_textbook_* typeExtractions into concept nodes without LLM pass2."""

from __future__ import annotations


def _textbook_rows(file_node, category: str) -> list[dict]:
    if isinstance(file_node, dict):
        store = file_node.get('typeExtractions') or {}
    else:
        store = getattr(file_node, 'typeExtractions', None) or {}
    textbook = store.get('textbook') if isinstance(store, dict) else {}
    rows = textbook.get(category) if isinstance(textbook, dict) else []
    return [row for row in (rows or []) if isinstance(row, dict)]


def promote_textbook_extractions_for_file(
    courseid,
    file_id,
    file_node,
    *,
    add_concept_node,
    find_concept,
    add_detail_node=None,
) -> int:
    promoted = 0
    for index, row in enumerate(_textbook_rows(file_node, 'sections')):
        section_number = str(row.get('sectionNumber') or '').strip()
        title = str(row.get('title') or '').strip()
        if not title:
            continue
        name = f'{section_number} {title}'.strip() if section_number else title
        if find_concept(courseid, name):
            continue
        summary = str(row.get('summary') or '').strip()
        concept_id = add_concept_node(courseid, name, summary)
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
            order['sequenceIndex'] = index + 1
            concept.documentOrder = order
        promoted += 1
    for row in _textbook_rows(file_node, 'definitions'):
        term = str(row.get('term') or row.get('title') or '').strip()
        definition = str(row.get('definition') or row.get('summary') or '').strip()
        if not term:
            continue
        concept = find_concept(courseid, term)
        if concept is None:
            concept_id = add_concept_node(courseid, term, definition)
            concept = find_concept(courseid, concept_id) if concept_id else None
            if concept is not None:
                promoted += 1
        if concept is not None and definition and add_detail_node is not None:
            detail_name = 'Definition'
            if not any(getattr(d, 'name', '') == detail_name for d in (getattr(concept, 'details', None) or [])):
                add_detail_node(courseid, concept.conceptid, detail_name, definition[:480])
    return promoted
