"""Tests for Lambda graph fragment merge."""
from __future__ import annotations

from canvas_parser.parse.lambda_runtime import merge_graph_fragments


def test_merge_graph_fragments_combines_concepts():
    left = {
        'concepts': [{'courseid': '1', 'name': 'A', 'conceptid': 'c1'}],
        'problems': [],
        'events': [],
        'syllabi': {},
        'files': {},
        'edges': [],
    }
    right = {
        'concepts': [{'courseid': '1', 'name': 'B', 'conceptid': 'c2'}],
        'problems': [],
        'events': [],
        'syllabi': {},
        'files': {},
        'edges': [],
    }
    merged = merge_graph_fragments([left, right])
    assert len(merged['concepts']) == 2


def test_merge_graph_fragments_preserves_course_metadata_from_each_fragment():
    left = {
        'learningBlocks': {
            '1': [{'blockId': 'b1', 'conceptId': 'c1', 'order': 1}],
        },
        'moduleOrderHints': {
            '1': {
                'c1': [{'moduleId': 'm1', 'position': 1}],
            },
        },
        'external_platforms': {
            'gradescope': {
                'synced_at': '2026-01-01T00:00:00Z',
                'mappings': [{'gradescopeAssignmentId': 'g1'}],
                'courses': [{'id': 'course-a'}],
            },
        },
    }
    right = {
        'learningBlocks': {
            '1': [{'blockId': 'b2', 'conceptId': 'c2', 'order': 2}],
        },
        'moduleOrderHints': {
            '1': {
                'c2': [{'moduleId': 'm2', 'position': 2}],
            },
        },
        'external_platforms': {
            'gradescope': {
                'synced_at': '2026-01-02T00:00:00Z',
                'mappings': [{'gradescopeAssignmentId': 'g2'}],
                'courses': [{'id': 'course-b'}],
            },
        },
    }

    merged = merge_graph_fragments([left, right])

    assert [block['blockId'] for block in merged['learningBlocks']['1']] == ['b1', 'b2']
    assert set(merged['moduleOrderHints']['1']) == {'c1', 'c2'}
    assert [
        mapping['gradescopeAssignmentId']
        for mapping in merged['external_platforms']['gradescope']['mappings']
    ] == ['g1', 'g2']
    assert [course['id'] for course in merged['external_platforms']['gradescope']['courses']] == ['course-a', 'course-b']
    assert merged['external_platforms']['gradescope']['synced_at'] == '2026-01-02T00:00:00Z'
