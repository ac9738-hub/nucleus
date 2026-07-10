"""Tests for Lambda graph fragment merge."""
from __future__ import annotations

from canvas_parser.parse.lambda_runtime import finalize_merged_graph, merge_graph_fragments


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


def test_finalize_merged_graph_keeps_one_duplicate_seeded_exam_event():
    """Seeded Lambda workers can each export the same pre-existing exam event."""
    event = {
        'courseid': '101',
        'name': 'Midterm',
        'eventid': 'Midtermeventid',
        'startdate': '2026-03-01T00:00:00',
        'enddate': '',
        'gradepercentage': '',
        'description': '',
        'type': 'test',
        'dependencies': [],
        'coveredConcepts': [],
        'embedded': {},
    }
    syllabus = {'courseid': '101', 'assignments': [], 'other': ''}
    fragment = {
        'concepts': [],
        'problems': [],
        'events': [event],
        'syllabi': {'101': syllabus},
        'files': {},
        'edges': [],
    }

    merged = merge_graph_fragments([
        fragment,
        {
            **fragment,
            'events': [dict(event)],
            'syllabi': {'101': dict(syllabus)},
        },
    ])
    finalized = finalize_merged_graph(merged, production=False)

    events = finalized.get('events') or []
    assert len(events) == 1
    assert events[0]['name'] == 'Midterm'
