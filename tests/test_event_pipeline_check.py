import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.check.event_pipeline import (
    EventPipelineChecker,
    classify_undated_source,
    format_report,
)
from canvas_parser.graph.events import extract_syllabus_exam_hints, is_plausible_exam_date_text


def test_is_plausible_exam_date_text_rejects_grading_fragments():
    assert not is_plausible_exam_date_text('45')
    assert not is_plausible_exam_date_text('zes 45')
    assert not is_plausible_exam_date_text('Exam 2')
    assert not is_plausible_exam_date_text('Exam 40')
    assert is_plausible_exam_date_text('10/15/2024')
    assert is_plausible_exam_date_text('October 10, 2025')
    assert is_plausible_exam_date_text('Friday, October 10')


def test_extract_syllabus_exam_hints_skips_quiz_percentage_line():
    text = '3 Quizzes 45%, Final 40%, Midterm 15%'
    hints = extract_syllabus_exam_hints(text)
    assert hints == []


def test_extract_syllabus_exam_hints_keeps_real_dates():
    text = 'Midterm: October 10, 2025\nFinal Exam: December 15, 2025'
    hints = extract_syllabus_exam_hints(text)
    names = {hint['name'] for hint in hints}
    assert 'Midterm' in names
    assert 'Final' in names


def test_classify_undated_source():
    assert classify_undated_source({'description': 'Inferred from assignment: Midterm'}) == 'assignment_no_due'
    assert classify_undated_source({'description': 'Extracted from syllabus: Exam (Exam 2)'}) == 'syllabus_hint_unparseable'
    assert classify_undated_source({'description': ''}) == 'llm_or_unknown'


def test_checker_assignment_gap():
    graph = {
        'events': [
            {
                'courseid': '1',
                'eventid': 'e1',
                'name': 'Midterm',
                'type': 'test',
                'startdate': '',
                'enddate': '',
                'description': '',
            }
        ],
        'syllabi': {
            '1': {
                'classtimes': '',
                'other': '',
                'assignments': [
                    {
                        'name': 'Midterm Exam',
                        'duedate': '2025-10-10T21:00:00Z',
                        'unlockdate': '',
                    }
                ],
            }
        },
        'files': {},
    }
    report = EventPipelineChecker(graph).run()
    categories = {finding.category for finding in report.findings}
    assert 'assignment_date_gap' in categories


def test_format_report_pass_when_no_errors():
    report = EventPipelineChecker({'events': [], 'syllabi': {}, 'files': {}}).run()
    text = format_report(report)
    assert 'RESULT: PASS' in text
