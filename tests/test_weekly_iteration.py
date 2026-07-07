import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.weekly_iteration.evaluate import compare_to_ground_truth, names_match
from canvas_parser.weekly_iteration.format import format_course_snapshot


def _assignment(name, due_at='', submission_types=None, published=True):
    return {
        'id': name,
        'name': name,
        'due_at': due_at,
        'published': published,
        'submission_types': submission_types or ['online_upload'],
    }


def test_exam_event_display_name_maps_take_home_midterm():
    from canvas_parser.weekly_iteration.format import _exam_event_display_name

    assert _exam_event_display_name('Midterm take-home exam') == 'Midterm Exam'
    assert _exam_event_display_name('Midterm') == 'Midterm'


def test_infer_final_exam_week_from_fall_term_end():
    from canvas_parser.weekly_iteration.format import _infer_final_exam_week, _infer_default_year

    snapshot = {
        'course': {
            'name': 'ART102 Fall',
            'term': {'name': 'Fall 2025', 'end_at': '2026-01-24T05:00:00Z'},
        },
        'assignments': [{'name': 'Midterm take-home exam', 'due_at': '2025-10-10T21:00:00Z'}],
        'files': [],
    }
    default_year = _infer_default_year(snapshot)
    final_week = _infer_final_exam_week(snapshot, default_year=default_year)
    assert final_week is not None
    assert final_week.month == 12
    assert final_week.day == 15


def test_names_match_is_fuzzy():
    assert names_match('Problem Set 1', 'problem set 1')
    assert names_match('Exam 1 (Midterm)', 'Midterm Exam') is False
    assert names_match('6 1 the dome', 'Dome of Florence Cathedral')
    assert names_match(
        'brunelleschi s dome florence cathedral',
        'Dome of Florence Cathedral (Santa Maria del Fiore)',
    )


def test_parse_filename_date_handles_underscore_before_month():
    from canvas_parser.weekly_iteration.format import _parse_filename_date

    parsed = _parse_filename_date('Dr Francis Slides_Sept 3, 2024.pdf', 2024)
    assert parsed is not None
    assert parsed.month == 9
    assert parsed.day == 3


def test_extract_page_file_names_includes_assignment_descriptions():
    from canvas_parser.weekly_iteration.format import _extract_page_file_names

    snapshot = {
        'page_bodies': {},
        'assignments': [{
            'description': '<a href="/files/1">Linked Lecture.pdf</a>',
        }],
    }
    assert _extract_page_file_names(snapshot) == ['Linked Lecture.pdf']
    snapshot = {
        'course': {
            'id': 1,
            'course_code': 'CHM 201',
            'name': 'General Chemistry I Fall 2024',
            'start_at': '2024-08-26T04:00:00Z',
            'syllabus_body': '<p>Exam 1 (Midterm): October 10, 2024</p>',
        },
        'assignments': [
            _assignment('Problem Set 1', '2024-09-13T03:59:59Z'),
            _assignment('Lab Participation', submission_types=['none']),
            _assignment('Exam 1 (Midterm)', '2024-10-10T03:59:59Z'),
        ],
        'files': [
            {'id': '10', 'display_name': 'Practice Exam 1.pdf'},
        ],
        'modules': [
            {'id': 'm1', 'name': 'Practice Exams', 'position': 1},
        ],
        'module_items': {
            'm1': [
                {'id': 'i1', 'type': 'File', 'content_id': '10', 'position': 1, 'title': 'Practice Exam 1.pdf'},
            ],
        },
    }
    parsed = format_course_snapshot(snapshot)
    assert any(item['name'] == 'Problem Set 1' for item in parsed['assignments'])
    assert parsed['participation'][0]['name'] == 'Lab Participation'
    assert parsed['modules'][0]['module_name'] == 'Practice Exams'


def test_compare_to_ground_truth_modules():
    ground_truth = {
        'assignments': [{'name': 'Problem Set 1', 'due_at': '9/13/2024'}],
        'modules': [{
            'module_name': 'Practice Exams',
            'module_contents': [{'name': 'Practice Exam 1.pdf'}],
        }],
    }
    parsed = {
        'assignments': [{'name': 'Problem Set 1', 'due_at': '9/13/2024'}],
        'modules': [{
            'module_name': 'Practice Exams',
            'module_contents': [{'name': 'Practice Exam 1.pdf'}],
        }],
    }
    score = compare_to_ground_truth(parsed, ground_truth)
    assert score.sections['assignments'].accuracy == 1.0
    assert score.sections['modules'].accuracy == 1.0


def test_final_exam_module_files_bucket_by_late_pset_weeks():
    snapshot = {
        'course': {
            'id': 20812,
            'course_code': 'MAT201',
            'start_at': '2026-01-09T05:00:00Z',
            'term': {'start_at': '2026-01-09T05:00:00Z'},
        },
        'assignments': [
            _assignment('QUIZ 1', '2026-02-17T04:59:00Z'),
            _assignment('Problem Set 8', '2026-04-15T03:59:59Z'),
            _assignment('Problem Set 9', '2026-04-22T03:59:00Z'),
            _assignment('MAKE-UP QUIZ', '2026-04-30T03:59:59Z'),
        ],
        'files': [
            {'id': 'f1', 'display_name': 'Practice 1.pdf'},
            {'id': 'f2', 'display_name': 'Actual Exam.pdf'},
        ],
        'modules': [{'id': 'm1', 'name': 'Quizzes/Exams', 'position': 1}],
        'module_items': {
            'm1': [
                {'id': 'h1', 'type': 'SubHeader', 'title': 'Final Exam', 'position': 1},
                {'id': 'i1', 'type': 'File', 'content_id': 'f1', 'title': 'Practice 1', 'position': 2},
                {'id': 'i2', 'type': 'File', 'content_id': 'f2', 'title': 'Actual Exam', 'position': 3},
            ],
        },
    }
    parsed = format_course_snapshot(snapshot)
    weeks = parsed.get('weekly_schedule') or []
    final_weeks = [
        week for week in weeks
        if any(event.get('name') == 'Final Exam' for event in week.get('events') or [])
    ]
    assert final_weeks
    for week in final_weeks:
        month = int(str(week.get('start_date') or '1/1/2026').split('/')[0])
        assert month >= 4
    assert not any(
        'Final Exam' in {event.get('name') for event in week.get('events') or []}
        for week in weeks
        if int(str(week.get('start_date') or '12/31/2026').split('/')[0]) <= 2
    )


def test_chunk_parser_batches_splits_large_content():
    from canvas_parser.weekly_iteration.llm_parse import chunk_parser_batches

    batches = [{
        'type': 'assignment',
        'content': [{'id': index} for index in range(125)],
    }]
    chunked = chunk_parser_batches(batches, max_items=50)
    assert len(chunked) == 3
    assert all(batch['type'] == 'assignment' for batch in chunked)
    assert [len(batch['content']) for batch in chunked] == [50, 50, 25]


def test_chunk_parser_batches_reads_env_max_items(monkeypatch):
    from canvas_parser.weekly_iteration import llm_parse

    monkeypatch.setenv('PARSER_MAX_BATCH_ITEMS', '40')
    batches = [{'type': 'file', 'content': [{'id': index} for index in range(100)]}]
    chunked = llm_parse.chunk_parser_batches(batches)
    assert len(chunked) == 3


def test_fetch_paginated_respects_item_cap(monkeypatch):
    from canvas_parser.weekly_iteration.auth import CanvasAuth
    from canvas_parser.weekly_iteration import fetch as fetch_module

    class FakeResponse:
        def __init__(self, payload, link=''):
            self._payload = payload
            self.headers = {'Link': link}

        def read(self):
            return self._payload.encode('utf-8')

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    pages = [json.dumps([{'id': index} for index in range(100)]) for _ in range(3)]
    calls = {'count': 0}

    def fake_urlopen(request, timeout=60):
        index = calls['count']
        calls['count'] += 1
        link = '<https://example.test/next>; rel="next"' if index < len(pages) - 1 else ''
        return FakeResponse(pages[index], link)

    monkeypatch.setattr(fetch_module.urllib.request, 'urlopen', fake_urlopen)

    auth = CanvasAuth(base_url='https://example.test', cookie='x', csrf='')
    items = fetch_module.fetch_paginated(auth, 'https://example.test/items', max_pages=10, max_items=150)
    assert len(items) == 150
    assert calls['count'] == 2


def test_parse_filename_date_handles_compact_class_stem():
    from canvas_parser.weekly_iteration.format import _parse_filename_date

    parsed = _parse_filename_date('C01_01262026', 2026)
    assert parsed is not None
    assert parsed.month == 1
    assert parsed.day == 26


def test_parse_filename_date_handles_compact_class_suffix():
    from canvas_parser.weekly_iteration.format import _parse_filename_date

    parsed = _parse_filename_date('C01_01262026_H.pdf', 2026)
    assert parsed is not None
    assert parsed.month == 1
    assert parsed.day == 26


def test_parse_assignment_name_date_handles_trailing_md():
    from canvas_parser.weekly_iteration.format import _parse_assignment_name_date

    parsed = _parse_assignment_name_date('Dictation 1 (L2 Part 1) 2/3', 2026)
    assert parsed is not None
    assert parsed.month == 2
    assert parsed.day == 3


def test_parse_assignment_name_date_handles_paren_md():
    from canvas_parser.weekly_iteration.format import _parse_assignment_name_date

    parsed = _parse_assignment_name_date('Review Quiz 1 (2/25)', 2026)
    assert parsed is not None
    assert parsed.month == 2
    assert parsed.day == 25


def test_assignment_entry_parses_due_date_from_name():
    from canvas_parser.weekly_iteration.format import _assignment_entry

    entry = _assignment_entry(
        {'name': 'Homework 1 (due 2/2 Mon in class)', 'due_at': None},
        2026,
    )
    assert entry['due_at'] == '2/2/2026'


def test_weekly_item_is_evaluable_respects_assignment_lock():
    from canvas_parser.weekly_iteration.availability import weekly_item_is_evaluable

    snapshot = {
        'assignments': [{
            'id': 1,
            'name': 'Problem Set 1',
            'published': True,
            'workflow_state': 'published',
            'locked_for_user': True,
        }],
        'files': [],
        'modules': [],
        'module_items': {},
    }
    assert weekly_item_is_evaluable(snapshot, 'Problem Set 1', 'assignments') is False
    snapshot['assignments'][0]['locked_for_user'] = False
    assert weekly_item_is_evaluable(snapshot, 'Problem Set 1', 'assignments') is True


def test_merge_parser_batches_by_type():
    from canvas_parser.weekly_iteration.llm_parse import merge_parser_batches_by_type

    batches = [
        {'type': 'assignment', 'content': [{'courseid': '1', 'id': 'a1'}]},
        {'type': 'file', 'content': [{'courseid': '1', 'id': 'f1'}]},
        {'type': 'assignment', 'content': [{'courseid': '2', 'id': 'a2'}]},
        {'type': 'file', 'content': [{'courseid': '2', 'id': 'f2'}]},
    ]
    merged = merge_parser_batches_by_type(batches)
    assert [batch['type'] for batch in merged] == ['assignment', 'file']
    assert len(merged[0]['content']) == 2
    assert len(merged[1]['content']) == 2
