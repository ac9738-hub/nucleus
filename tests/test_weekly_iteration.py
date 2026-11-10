import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.weekly_iteration.evaluate import compare_to_ground_truth, names_match
from canvas_parser.weekly_iteration.format import (
    _parse_any_date,
    _parse_filename_date,
    _reading_title_to_discussion_name,
    format_course_snapshot,
)


def _assignment(name, due_at='', submission_types=None, published=True):
    return {
        'id': name,
        'name': name,
        'due_at': due_at,
        'published': published,
        'submission_types': submission_types or ['online_upload'],
    }


def test_names_match_is_fuzzy():
    assert names_match('Problem Set 1', 'problem set 1')
    assert names_match('Exam 1 (Midterm)', 'Midterm Exam') is False
    assert names_match('Assignment 1 Photography', 'Assignment 1: Architectural Photography')


def test_parse_iso_datetime_with_offset():
    parsed = _parse_any_date('2025-09-08T00:00:00+00:00')
    assert parsed is not None
    assert parsed.year == 2025
    assert parsed.month == 9
    assert parsed.day == 8


def test_parse_filename_date_after_underscore():
    parsed = _parse_filename_date('Dr Francis Slides_Sept 3, 2024.pdf', 2024)
    assert parsed is not None
    assert parsed.month == 9
    assert parsed.day == 3


def test_reading_discussion_title_from_dash_separated_filename():
    assert (
        _reading_title_to_discussion_name('Nguyen - Nothing Ever Dies, "On Remembering One\'s Own".pdf')
        == 'Nothing Ever Dies'
    )
    assert _reading_title_to_discussion_name('Chua et al. - Turbulent Circulation') == 'Turbulent Circulation'


def test_format_course_snapshot_basic():
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
