"""Regression tests for local parser state isolation."""
from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace

from canvas_parser.parse import lambda_runtime


def test_process_single_item_serializes_parser_global_state(monkeypatch):
    fake_state: dict[str, str] = {}

    def reset_state() -> None:
        fake_state.clear()

    def export_state() -> dict:
        return {'fake_state': dict(fake_state)}

    async def process_parse_item(item, batch_type):
        fake_state['batch_type'] = batch_type
        fake_state['started_course'] = str(item['courseid'])
        fake_state['started_item'] = str(item['id'])
        await asyncio.sleep(0)
        fake_state['finished_course'] = str(item['courseid'])
        fake_state['finished_item'] = str(item['id'])

    fake_parser = SimpleNamespace(
        process_parse_item=process_parse_item,
        parser_thread_log_lines=[],
    )
    monkeypatch.setitem(sys.modules, 'parser', fake_parser)
    monkeypatch.setattr(lambda_runtime, 'reset_parser_state', reset_state)
    monkeypatch.setattr(lambda_runtime, 'configure_runtime', lambda **_kwargs: None)
    monkeypatch.setattr(lambda_runtime, 'hydrate_parser_seed', lambda _seed: None)
    monkeypatch.setattr(lambda_runtime, 'export_parser_state', export_state)

    async def run_two_items():
        return await asyncio.gather(
            lambda_runtime.process_single_item(
                'assignment',
                {'courseid': 'course-a', 'id': 'item-a', 'name': 'A'},
                placement='local_download_lambda_parse',
                production=True,
            ),
            lambda_runtime.process_single_item(
                'assignment',
                {'courseid': 'course-b', 'id': 'item-b', 'name': 'B'},
                placement='local_download_lambda_parse',
                production=True,
            ),
        )

    left, right = asyncio.run(run_two_items())

    assert left['fake_state'] == {
        'batch_type': 'assignment',
        'started_course': 'course-a',
        'started_item': 'item-a',
        'finished_course': 'course-a',
        'finished_item': 'item-a',
    }
    assert right['fake_state'] == {
        'batch_type': 'assignment',
        'started_course': 'course-b',
        'started_item': 'item-b',
        'finished_course': 'course-b',
        'finished_item': 'item-b',
    }
