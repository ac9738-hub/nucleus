import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.events import is_schedulable_date
from parser import (
    infer_course_academic_year,
    normalize_date,
    normalize_event_date,
    set_date_normalize_context,
)


class FakeSyllabus:
    def __init__(self, classtimes='', other='', assignments=None):
        self.classtimes = classtimes
        self.other = other
        self.assignments = assignments or []


class FakeAssignment:
    def __init__(self, duedate=''):
        self.duedate = duedate
        self.unlockdate = ''
        self.name = 'Problem Set 1'


class FakeFileNode:
    def __init__(self, name):
        self.name = name


def test_normalize_date_parses_iso_and_rejects_tbd():
    assert normalize_date('2025-03-10T15:00:00Z') == '2025-03-10T15:00:00Z'
    assert normalize_date('TBD') == ''
    assert normalize_date('') == ''


def test_normalize_date_parses_full_month_day_year():
    assert normalize_date('March 10, 2025') == '2025-03-10T00:00:00Z'


def test_normalize_date_uses_default_year_for_yearless_dates():
    assert normalize_date('March 10', default_year=2025) == '2025-03-10T00:00:00Z'
    assert normalize_date('Mar 10', default_year=2025) == '2025-03-10T00:00:00Z'


def test_normalize_date_returns_empty_for_unparseable_text():
    assert normalize_date('Week 7') == ''
    assert normalize_date('sometime soon') == ''


def test_normalize_event_date_only_keeps_schedulable_values():
    assert normalize_event_date('March 10, 2025') == '2025-03-10T00:00:00Z'
    assert normalize_event_date('Week 7') == ''


def test_infer_course_academic_year_from_term_code_and_assignment():
    syllabus = FakeSyllabus(
        classtimes='NEU201/PSY258 Fundamentals of Neuroscience Fall 2024',
        assignments=[FakeAssignment('2024-09-09T14:00:00Z')],
    )
    assert infer_course_academic_year('15237', syllabus, {}) == 2024

    files = {'f1': FakeFileNode('NEU201 Fall 2024 syllabus.pdf')}
    assert infer_course_academic_year('15237', None, files) == 2024


def test_set_date_normalize_context_applies_to_normalize_date():
    set_date_normalize_context(2025)
    try:
        assert normalize_date('May 12') == '2025-05-12T00:00:00Z'
    finally:
        set_date_normalize_context(None)


def test_is_schedulable_date_matches_iso_utc_format():
    assert is_schedulable_date('2025-03-10T00:00:00Z') is True
    assert is_schedulable_date('March 10') is False
    assert is_schedulable_date('') is False
