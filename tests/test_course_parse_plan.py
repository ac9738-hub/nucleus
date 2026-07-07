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
