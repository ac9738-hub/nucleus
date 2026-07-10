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


def test_merge_graph_fragments_preserves_external_platform_mappings():
    left = {
        'external_platforms': {
            'gradescope': {
                'synced_at': '2026-01-01T00:00:00Z',
                'courses': [{'id': 'course-a'}],
                'mappings': [{
                    'courseId': '1',
                    'canvasAssignmentId': '10',
                    'gradescopeAssignmentId': 'gs-10',
                }],
            },
        },
    }
    right = {
        'external_platforms': {
            'gradescope': {
                'synced_at': '2026-01-02T00:00:00Z',
                'courses': [{'id': 'course-b'}],
                'mappings': [{
                    'courseId': '1',
                    'canvasAssignmentId': '11',
                    'gradescopeAssignmentId': 'gs-11',
                }],
            },
        },
    }

    merged = merge_graph_fragments([left, right])
    gradescope = merged['external_platforms']['gradescope']
    assert gradescope['synced_at'] == '2026-01-02T00:00:00Z'
    assert {row['id'] for row in gradescope['courses']} == {'course-a', 'course-b'}
    assert {
        row['canvasAssignmentId']
        for row in gradescope['mappings']
    } == {'10', '11'}
