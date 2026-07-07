"""Tests for graph parse eval and course scope."""
from __future__ import annotations

import json
from pathlib import Path

from canvas_parser.parse.course_scope import filter_course_records, is_princeton_course
from scripts.eval_graph_parse import compare_course, evaluate_graphs


def test_princeton_course_filter():
    princeton = {'id': 15160, 'root_account_id': 1, 'name': 'CHM201'}
    other = {'id': 269820000000000160, 'root_account_id': 269820000000000000, 'name': 'Other'}
    assert is_princeton_course(princeton)
    assert not is_princeton_course(other)
    rows = filter_course_records([princeton, other], princeton_only=True)
    assert [row['id'] for row in rows] == [15160]


def test_graph_eval_passes_identical_graph(tmp_path: Path):
    graph = {
        'concepts': [
            {
                'courseid': '18857',
                'name': 'Gothic Architecture',
                'details': [{'name': 'Pointed Arch'}],
            }
        ],
        'events': [
            {'courseid': '18857', 'name': 'Midterm Exam', 'type': 'test', 'startdate': '2025-10-10'}
        ],
        'problems': [],
        'files': {'18857': {'1': {'fileid': '1', 'pages': [{'text': 'x'}]}}},
    }
    baseline_path = tmp_path / 'baseline.json'
    candidate_path = tmp_path / 'candidate.json'
    baseline_path.write_text(json.dumps(graph), encoding='utf-8')
    candidate_path.write_text(json.dumps(graph), encoding='utf-8')
    report = evaluate_graphs(graph, graph, ['18857'])
    assert report['passed'] is True
    row = report['courses'][0]
    assert row['conceptTitleRecall'] == 1.0


def test_manifest_row_compare_matches_graph_compare():
    baseline = {
        'concepts': [
            {'courseid': '15160', 'name': 'Thermodynamics', 'details': [{'name': 'Entropy'}]},
            {'courseid': '15160', 'name': 'Kinetics', 'details': []},
        ],
        'events': [],
        'problems': [],
        'files': {'15160': {}},
    }
    manifest_row = {
        'courseId': '15160',
        'metrics': {'concepts': 2, 'details': 1, 'datedTestEvents': 0, 'parsedFiles': 0},
        'conceptTitles': ['thermodynamics', 'kinetics'],
    }
    from scripts.eval_graph_parse import compare_course, compare_course_to_manifest_row

    graph_row = compare_course(baseline, baseline, '15160')
    manifest_compare = compare_course_to_manifest_row(manifest_row, baseline, '15160')
    assert graph_row['passed'] is True
    assert manifest_compare['passed'] is True
    assert manifest_compare['conceptTitleRecall'] == graph_row['conceptTitleRecall']


def test_graph_eval_detects_missing_concepts():
    baseline = {
        'concepts': [
            {'courseid': '15160', 'name': 'Thermodynamics', 'details': [{'name': 'Entropy'}]},
            {'courseid': '15160', 'name': 'Kinetics', 'details': []},
        ],
        'events': [],
        'problems': [],
        'files': {'15160': {}},
    }
    candidate = {
        'concepts': [
            {'courseid': '15160', 'name': 'Thermodynamics', 'details': []},
        ],
        'events': [],
        'problems': [],
        'files': {'15160': {}},
    }
    row = compare_course(baseline, candidate, '15160')
    assert row['passed'] is False
    assert row['ratios']['concepts'] == 0.5
