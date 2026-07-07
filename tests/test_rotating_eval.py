"""Tests for rotating parse eval pipeline."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from canvas_parser.parse.concurrency_audit import KNOWN_CONCURRENCY_ISSUES, audit_report
from canvas_parser.parse.parse_eval_concurrency import apply_eval_concurrency_env
from canvas_parser.parse.parse_eval_gt import (
    compare_file_to_gt,
    extract_file_gt_from_fragment,
)
from canvas_parser.parse.rotating_eval import (
    load_rotation_state,
    pool_entries,
    save_rotation_state,
    select_rotating_entry,
    syllabus_prompt_context,
)
from scripts.build_parse_eval_pool import build_pool, extract_syllabus_seed


def _sample_fragment(course_id: str, file_id: str) -> dict:
    return {
        'concepts': [
            {
                'courseid': course_id,
                'name': 'Neural Plasticity',
                'sourceFiles': [file_id],
                'details': [{'name': 'Hebbian learning'}],
            },
            {
                'courseid': course_id,
                'name': 'Synaptic Scaling',
                'fileid': file_id,
                'details': [],
            },
        ],
        'events': [{'courseid': course_id, 'fileid': file_id, 'name': 'Midterm Review'}],
        'files': {
            course_id: {
                file_id: {
                    'fileid': file_id,
                    'name': 'Lecture 12.pdf',
                    'academicFileType': 'lecture_slides',
                    'pages': [{'text': 'Neural Plasticity\nHebbian learning'}],
                },
            },
        },
        '_meta': {'deepseek_passes': 2},
    }


def test_apply_eval_concurrency_env_sets_1000():
    level = apply_eval_concurrency_env(1000)
    assert level == 1000
    import os
    assert os.environ['PARSE_MAX_CONCURRENT'] == '1000'
    assert os.environ['DEEPSEEK_MAX_CONCURRENT'] == '1000'
    assert os.environ['PARSER_LAMBDA_INVOKE_WORKERS'] == '1000'


def test_extract_file_gt_from_fragment():
    frag = _sample_fragment('15237', '999')
    gt = extract_file_gt_from_fragment(frag, course_id='15237', file_id='999', filename='Lecture 12.pdf')
    assert gt['conceptCount'] == 2
    assert gt['detailCount'] == 1
    assert gt['expectedFileType'] == 'lecture_slides'
    assert 'Midterm Review' in gt['events']


def test_compare_file_to_gt_pass_and_fail():
    base_gt = extract_file_gt_from_fragment(
        _sample_fragment('15237', '999'),
        course_id='15237',
        file_id='999',
    )
    good = compare_file_to_gt(_sample_fragment('15237', '999'), base_gt)
    assert good['conceptRecall'] == 1.0
    assert good['passed'] is True

    sparse = {
        'concepts': [{'courseid': '15237', 'name': 'Unrelated', 'sourceFiles': ['999']}],
        'files': {'15237': {'999': {'academicFileType': 'lecture_slides'}}},
        '_meta': {'deepseek_passes': 1},
    }
    bad = compare_file_to_gt(sparse, base_gt)
    assert bad['conceptRecall'] < 0.5
    assert bad['passed'] is False


def test_rotation_round_robin(tmp_path: Path):
    pool = {
        'root': str(tmp_path),
        'files': [
            {'courseId': '1', 'fileId': 'a', 'gtPath': 'gt/1/a.json', 'filename': 'a.pdf'},
            {'courseId': '1', 'fileId': 'b', 'gtPath': 'gt/1/b.json', 'filename': 'b.pdf'},
        ],
    }
    gt_dir = tmp_path / 'gt' / '1'
    gt_dir.mkdir(parents=True)
    for fid in ('a', 'b'):
        (gt_dir / f'{fid}.json').write_text('{"courseId":"1","fileId":"' + fid + '","concepts":[]}', encoding='utf-8')

    state = {'index': 0}
    e1, state = select_rotating_entry(pool, state=state)
    e2, state = select_rotating_entry(pool, state=state)
    assert e1['fileId'] == 'a'
    assert e2['fileId'] == 'b'


def test_syllabus_prompt_context():
    seed = {
        'syllabi': {'15237': {'courseid': '15237', 'assignments': [{'name': 'PSet 1'}]}},
        'concepts': [{'courseid': '15237', 'name': 'Course Overview'}],
        'events': [{'courseid': '15237', 'name': 'Midterm', 'startdate': '2025-10-15', 'type': 'test'}],
    }
    ctx = syllabus_prompt_context(seed, '15237')
    assert ctx['courseId'] == '15237'
    assert ctx['syllabusEventCount'] == 1
    assert ctx['conceptsSample'][0]['name'] == 'Course Overview'


def test_extract_syllabus_seed_filters_by_course():
    graph = {
        'syllabi': {
            '100': {'courseid': '100', 'assignments': []},
            '200': {'courseid': '200', 'assignments': []},
        },
        'concepts': [
            {'courseid': '100', 'name': 'A', 'fromSyllabus': True},
            {'courseid': '200', 'name': 'B'},
        ],
        'events': [],
        'files': {},
    }
    seed = extract_syllabus_seed(graph, '100')
    assert '100' in seed['syllabi']
    assert len(seed['concepts']) == 1
    assert seed['concepts'][0]['name'] == 'A'


def test_build_pool_from_heuristic_manifest(tmp_path: Path):
    manifest = {
        'files': [
            {
                'courseId': '15237',
                'fileId': '1',
                'filename': 'slides.pdf',
                'localPdf': True,
                'heuristicFileType': 'lecture_slides',
                'heuristicConfidence': 0.9,
                'pageCount': 10,
            },
        ],
    }
    graph = {
        'syllabi': {'15237': {'courseid': '15237'}},
        'concepts': [],
        'events': [],
        'files': {'15237': {}},
    }
    pool = build_pool(manifest, graph, require_local_pdf=True)
    assert pool['fileCount'] == 1
    assert pool['syllabusCourseCount'] == 1
    assert (Path('fixtures/parse_eval/syllabi/15237.json')).is_file()


def test_concurrency_audit_has_issues():
    assert len(KNOWN_CONCURRENCY_ISSUES) >= 8
    report = audit_report(run_metrics={'concurrency': 1000, 'conceptRecall': 0.5})
    assert 'extreme_concurrency' in report['riskFlags']
    assert 'low_concept_recall_under_load' in report['riskFlags']


def test_pool_entries_require_gt(tmp_path: Path):
    pool = {
        'root': str(tmp_path),
        'files': [
            {'courseId': '1', 'fileId': 'a', 'gtPath': 'gt/1/a.json'},
            {'courseId': '1', 'fileId': 'b', 'gtPath': 'gt/1/b.json'},
        ],
    }
    assert len(pool_entries(pool, require_gt=True)) == 0
    (tmp_path / 'gt' / '1').mkdir(parents=True)
    (tmp_path / 'gt' / '1' / 'a.json').write_text('{}', encoding='utf-8')
    assert len(pool_entries(pool, require_gt=True)) == 1
