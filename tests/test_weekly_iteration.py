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


def test_names_match_is_fuzzy():
    assert names_match('Problem Set 1', 'problem set 1')
    assert names_match('Assignment 1 Photography', 'Assignment 1: Architectural Photography')
    assert names_match('Exam 1 (Midterm)', 'Midterm Exam') is False


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


def test_tuesday_reading_discussions_use_calendar_due_dates():
    snapshot = {
        'course': {
            'id': 2,
            'course_code': 'ASA 344',
            'name': 'ASA 344 Fall 2025',
            'term': {'start_at': '2025-08-18T04:00:00Z'},
        },
        'assignments': [],
        'files': [{'id': '10', 'display_name': 'Chua et al. - Turbulent Circulation'}],
        'modules': [{'id': 'm1', 'name': 'Tuesday, November 4', 'position': 1}],
        'module_items': {
            'm1': [
                {
                    'id': 'i1',
                    'type': 'File',
                    'content_id': '10',
                    'position': 1,
                    'title': 'Chua et al. - Turbulent Circulation',
                }
            ],
        },
    }

    parsed = format_course_snapshot(snapshot)

    assert parsed['discussions'] == [{'name': 'Turbulent Circulation', 'due_at': '11/3/2025'}]
    assert any(
        item['name'] == 'Turbulent Circulation'
        for week in parsed['weekly_schedule']
        for item in week.get('assignments', [])
    )


def test_page_linked_pdf_with_underscore_date_is_bucketed():
    snapshot = {
        'course': {
            'id': 3,
            'course_code': 'CHM 201',
            'name': 'General Chemistry I Fall 2024',
            'term': {'start_at': '2024-08-26T04:00:00Z'},
        },
        'assignments': [],
        'files': [],
        'modules': [],
        'module_items': {},
        'page_bodies': {
            'download-lecture-slides': (
                '<a class="instructure_file_link" '
                'href="/files/1">Dr Francis Slides_Sept 3, 2024.pdf</a>'
            )
        },
    }

    parsed = format_course_snapshot(snapshot)

    assert any(
        names_match('Dr Francis Slides Sept 3, 2024.pdf', item['name'])
        for week in parsed['weekly_schedule']
        for item in week.get('files', [])
    )
