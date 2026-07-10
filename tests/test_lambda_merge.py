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


def test_merge_graph_fragments_preserves_richer_file_node_from_later_stale_snapshot():
    stale = {
        'files': {
            '1': {
                '42': {
                    'fileid': '42',
                    'courseid': '1',
                    'name': 'Lecture.pdf',
                    'downloadurl': 'https://canvas.example/files/42',
                    'pages': [],
                    'textChunks': [],
                    'typeExtractions': {},
                },
            },
        },
    }
    rich = {
        'files': {
            '1': {
                '42': {
                    'fileid': '42',
                    'courseid': '1',
                    'name': 'Lecture.pdf',
                    'academicFileType': 'lecture_slides',
                    'downloadurl': 'https://canvas.example/files/42',
                    'pages': [{'pageid': '42:1', 'text': 'important lecture content'}],
                    'textChunks': [{'chunkId': '42:chunk:1', 'text': 'important lecture content'}],
                    'typeExtractions': {'lecture': {'topics': ['limits']}},
                },
            },
        },
    }

    merged = merge_graph_fragments([rich, stale])
    node = merged['files']['1']['42']
    assert node['academicFileType'] == 'lecture_slides'
    assert node['pages'] == [{'pageid': '42:1', 'text': 'important lecture content'}]
    assert node['textChunks'] == [{'chunkId': '42:chunk:1', 'text': 'important lecture content'}]
    assert node['typeExtractions'] == {'lecture': {'topics': ['limits']}}

    merged_reversed = merge_graph_fragments([stale, rich])
    assert merged_reversed['files']['1']['42']['pages'] == node['pages']
    assert merged_reversed['files']['1']['42']['typeExtractions'] == node['typeExtractions']
