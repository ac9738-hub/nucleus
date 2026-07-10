"""Tests for course parse plan helpers."""
from __future__ import annotations

import asyncio

import parser as parser_mod

from canvas_parser.parse.course_parse_plan import (
    CourseParsePlan,
    build_course_parse_plans,
    collect_parseable_file_items,
)
from canvas_parser.parse import lambda_runtime


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


def test_build_course_parse_plans_keeps_linked_discovered_file_without_extension():
    items = [
        ('file', {
            'id': '999',
            'courseid': '101',
            'name': 'Linked file 999',
            'url': 'https://canvas.example.edu/courses/101/files/999/download',
            'linked_discovered': True,
        }, 'file__101__999'),
    ]
    plan = build_course_parse_plans(items)[0]
    assert [key for _bt, _item, key in plan.file_items] == ['file__101__999']


def test_run_deterministic_course_items_drains_linked_canvas_files(monkeypatch):
    calls: list[str] = []

    async def fake_process_parse_item(item, batch_type):
        calls.append(f'item:{batch_type}:{item["id"]}')
        parser_mod.pending_linked_canvas_files.setdefault('101', {})['999'] = {
            'downloadurl': 'https://canvas.example.edu/courses/101/files/999/download',
        }

    async def fake_parse_pending_linked_canvas_files():
        calls.append('pending')
        parser_mod.pending_linked_canvas_files.clear()

    monkeypatch.setattr(lambda_runtime, 'configure_runtime', lambda **_kwargs: None)
    monkeypatch.setattr(lambda_runtime, 'reset_parser_state', parser_mod.pending_linked_canvas_files.clear)
    monkeypatch.setattr(lambda_runtime, 'hydrate_parser_seed', lambda _seed: None)
    monkeypatch.setattr(lambda_runtime, 'export_parser_state', lambda: {'files': {'101': {'999': {}}}})
    monkeypatch.setattr(parser_mod, 'process_parse_item', fake_process_parse_item)
    monkeypatch.setattr(parser_mod, 'parse_pending_linked_canvas_files', fake_parse_pending_linked_canvas_files)

    result = asyncio.run(lambda_runtime.run_deterministic_course_items(
        [('assignment', {'id': 'a1', 'courseid': '101'}, 'assignment__101__a1')],
        placement='local_download_parse',
    ))

    assert calls == ['item:assignment:a1', 'pending']
    assert result == {'files': {'101': {'999': {}}}}
