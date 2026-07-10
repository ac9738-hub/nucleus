"""Tests for course parse plan helpers."""
from __future__ import annotations

from canvas_parser.parse.course_parse_plan import (
    CourseParsePlan,
    build_course_parse_plans,
    collect_parseable_file_items,
)


def test_collect_parseable_file_items_excludes_syllabus_keys():
    course_id = '999'
    syllabus_key = f'file__{course_id}__1'
    lecture_key = f'file__{course_id}__2'
    items = [
        ('file', {
            'id': '1',
            'courseid': course_id,
            'name': 'Lecture A.pdf',
            'content_type': 'application/pdf',
        }, syllabus_key),
        ('file', {
            'id': '2',
            'courseid': course_id,
            'name': 'Lecture B.pdf',
            'content_type': 'application/pdf',
        }, lecture_key),
    ]
    plan = CourseParsePlan(course_id=course_id)
    plan.syllabus_items.append(items[0])
    rows = collect_parseable_file_items(plan, items)
    keys = {key for _bt, _item, key in rows}
    assert syllabus_key not in keys
    assert lecture_key in keys


def test_external_submission_runs_as_deterministic_course_item():
    course_id = '999'
    key = f'external_submission__{course_id}__gradescope-999-1'
    plans = build_course_parse_plans([
        ('external_submission', {
            'id': 'gradescope-999-1',
            'courseid': course_id,
            'name': 'Problem Set 1',
        }, key),
    ])

    assert len(plans) == 1
    assert plans[0].deterministic_items == [
        ('external_submission', {
            'id': 'gradescope-999-1',
            'courseid': course_id,
            'name': 'Problem Set 1',
        }, key),
    ]
