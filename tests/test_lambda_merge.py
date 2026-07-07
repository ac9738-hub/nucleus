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
