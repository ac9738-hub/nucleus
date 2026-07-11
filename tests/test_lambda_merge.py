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


def test_reset_parser_state_clears_events_and_syllabus_prompt_context():
    import parser as parser_mod
    from canvas_parser.parse.lambda_runtime import export_parser_state, reset_parser_state

    try:
        parser_mod.eventNodes.setdefault('stale-course', []).append(
            parser_mod.eventNode(
                'Stale Midterm',
                startdate='2026-02-01',
                eventtype='test',
            )
        )
        parser_mod.syllabusNodes['stale-course'] = parser_mod.syllabusNode(
            courseid='stale-course',
            other='Stale syllabus body',
        )
        parser_mod.allsyllabi['stale-course'] = {'other': 'Stale syllabus body'}

        reset_parser_state()

        assert parser_mod.eventNodes == {}
        assert parser_mod.syllabusNodes == {}
        assert parser_mod.allsyllabi == {}

        fragment = export_parser_state()
        assert fragment['events'] == []
        assert fragment['syllabi'] == {}
    finally:
        reset_parser_state()
