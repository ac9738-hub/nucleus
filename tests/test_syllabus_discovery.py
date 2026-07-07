"""Tests for concurrent syllabus discovery and primary selection."""
from __future__ import annotations

import asyncio

import pytest

from canvas_parser.parse.course_parse_plan import CourseParsePlan, item_key
from canvas_parser.parse.syllabus_discovery import (
    _fallback_primary_key,
    _has_canvas_syllabus_body,
    reconcile_syllabus_duplicates,
)


def _file_item(file_id: int, course_id: str, name: str):
    item = {'id': file_id, 'courseid': course_id, 'name': name, 'content-type': 'application/pdf'}
    return ('file', item, item_key('file', item))


def test_fallback_primary_key_prefers_syllabus_in_name():
    rows = [
        _file_item(1, '99', 'Week 1 handout.pdf'),
        _file_item(2, '99', 'Fall 2025 Syllabus.pdf'),
    ]
    assert _fallback_primary_key(rows).endswith('__2')


def test_reconcile_keeps_canvas_body_demotes_pdfs():
    plan = CourseParsePlan(course_id='99')
    plan.syllabus_items = [
        ('syllabus', {'id': 's', 'courseid': '99', 'name': 'syllabus'}, item_key('syllabus', {'id': 's', 'courseid': '99'})),
        _file_item(1, '99', 'Fall Syllabus.pdf'),
        _file_item(2, '99', 'Syllabus supplement.pdf'),
    ]
    assert _has_canvas_syllabus_body(plan)
    asyncio.run(reconcile_syllabus_duplicates(plan))
    assert len(plan.syllabus_items) == 1
    assert plan.syllabus_items[0][0] == 'syllabus'
    assert len(plan.file_items) == 2


def test_reconcile_multiple_pdfs_keeps_one():
    plan = CourseParsePlan(course_id='99')
    plan.syllabus_items = [
        _file_item(1, '99', 'course outline.pdf'),
        _file_item(2, '99', 'ART 102 Fall Syllabus.pdf'),
    ]
    asyncio.run(reconcile_syllabus_duplicates(plan))
    assert len(plan.syllabus_items) == 1
    assert 'Syllabus' in plan.syllabus_items[0][1]['name']
    assert len(plan.file_items) == 1
