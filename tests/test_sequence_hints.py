"""Tests for parser document-order and sequence hint helpers."""
from __future__ import annotations

from canvas_parser.graph.sequence_hints import (
    apply_outline_sequence_edges,
    build_document_order,
    document_order_sort_key,
    parse_heading_numbers,
    sort_concepts_by_document_order,
)


def test_parse_heading_numbers_section_and_lecture():
    numbers = parse_heading_numbers('Lecture 4: 2.3 Matrix Products')
    assert numbers.get('lecture') == 4
    assert numbers.get('sectionMajor') == 2
    assert numbers.get('sectionMinor') == 3


def test_document_order_sort_key_orders_sections():
    left = build_document_order({'name': '2.1 Vectors', 'pageNumber': 1}, file_id='f1', sequence_index=0)
    right = build_document_order({'name': '2.3 Matrix Products', 'pageNumber': 2}, file_id='f1', sequence_index=1)
    assert document_order_sort_key(left) < document_order_sort_key(right)


def test_apply_outline_sequence_edges_adds_prerequisites():
    concepts = {}

    class Concept:
        def __init__(self, conceptid, name):
            self.conceptid = conceptid
            self.name = name
            self.prerequisiteConceptIds = []

    concepts['c1'] = Concept('c1', '2.1 Vectors')
    concepts['c2'] = Concept('c2', '2.3 Matrix Products')
    edges = []

    def find_concept(_course, ref):
        return concepts.get(ref)

    def add_prereq(_course, from_id, to_id, source, confidence):
        concepts[to_id].prerequisiteConceptIds.append(from_id)
        edges.append((from_id, to_id, source, confidence))
        return {'status': 'SUCCESS'}

    rows = [
        {
            'conceptId': 'c1',
            'documentOrder': build_document_order({'name': '2.1 Vectors'}, file_id='f1', sequence_index=0),
        },
        {
            'conceptId': 'c2',
            'documentOrder': build_document_order({'name': '2.3 Matrix Products'}, file_id='f1', sequence_index=1),
        },
    ]
    added = apply_outline_sequence_edges('demo', rows, find_concept, add_prereq)
    assert added == 1
    assert concepts['c2'].prerequisiteConceptIds == ['c1']


def test_sort_concepts_by_document_order():
    concepts = [
        {'conceptid': 'b', 'documentOrder': build_document_order({'name': '2.3 Products'}, file_id='f1', sequence_index=1)},
        {'conceptid': 'a', 'documentOrder': build_document_order({'name': '2.1 Vectors'}, file_id='f1', sequence_index=0)},
    ]
    assert sort_concepts_by_document_order(concepts) == ['a', 'b']
