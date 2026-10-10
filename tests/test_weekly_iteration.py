import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.weekly_iteration.evaluate import compare_to_ground_truth, names_match
from canvas_parser.weekly_iteration.format import _parse_any_date, format_course_snapshot


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


def test_timezone_offset_dates_are_parseable():
    parsed = _parse_any_date('2025-09-08T00:00:00+00:00')
    assert parsed is not None
    assert parsed.year == 2025
    assert parsed.month == 9
    assert parsed.day == 8


def test_dated_reading_modules_prefer_file_titles_for_discussions():
    snapshot = {
        'course': {
            'id': 1,
            'course_code': 'ASA 344',
            'name': 'Asian American Studies Fall 2025',
            'start_at': '2025-09-01T04:00:00Z',
        },
        'assignments': [],
        'files': [
            {'id': 'f1', 'display_name': 'Tsing, Mushroom at the End of the World (Excerpt).pdf'},
        ],
        'modules': [
            {'id': 'm1', 'name': 'Tuesday, September 16', 'position': 1},
        ],
        'module_items': {
            'm1': [
                {'id': 'u1', 'type': 'ExternalUrl', 'position': 1, 'title': 'LOGISTICS (2012)'},
                {'id': 'i1', 'type': 'File', 'content_id': 'f1', 'position': 2, 'title': 'Fallback.pdf'},
            ],
        },
    }

    parsed = format_course_snapshot(snapshot)

    assert {'name': 'The Mushroom at the End of the World', 'due_at': '9/15/2025'} in parsed['discussions']


def test_assignment_sheet_pdf_stem_alias_lands_in_due_week():
    snapshot = {
        'course': {
            'id': 1,
            'course_code': 'ART 102',
            'name': 'Architecture Fall 2025',
            'start_at': '2025-09-01T04:00:00Z',
        },
        'assignments': [
            _assignment('Assignment 1: Architectural Photograph', '2025-09-11T03:59:59Z'),
        ],
        'files': [
            {'id': 'f1', 'display_name': 'Assignment 1 Photography.pdf'},
        ],
        'modules': [
            {'id': 'm1', 'name': '0 Syllabus and Other Important Documents', 'position': 1},
        ],
        'module_items': {
            'm1': [
                {'id': 'i1', 'type': 'File', 'content_id': 'f1', 'position': 1, 'title': 'Assignment 1 Photography.pdf'},
            ],
        },
    }

    parsed = format_course_snapshot(snapshot)
    weekly_names = [
        item['name']
        for week in parsed['weekly_schedule']
        for item in week.get('assignments') or []
    ]

    assert 'Assignment 1: Architectural Photograph' in weekly_names
    assert 'Assignment 1 Photography' in weekly_names
