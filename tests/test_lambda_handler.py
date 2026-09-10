"""Tests for the AWS Lambda parse item handler."""
from __future__ import annotations

from pathlib import Path

import pytest

import aws_lambda_parse.handler as lambda_handler


def test_lambda_handler_removes_per_invocation_canvas_dir(monkeypatch, tmp_path: Path):
    canvas_dir = tmp_path / 'nucleus-canvasfiles-success'

    monkeypatch.setattr(lambda_handler.tempfile, 'mkdtemp', lambda prefix: str(canvas_dir))

    async def fake_process_single_item(*_args, canvasfiles_dir=None, **_kwargs):
        assert canvasfiles_dir == canvas_dir
        canvasfiles_dir.mkdir(parents=True, exist_ok=True)
        (canvasfiles_dir / 'downloaded.pdf').write_bytes(b'x' * 1024)
        return {'files': {'1': {'2': {'pages': [{'text': 'parsed'}]}}}}

    monkeypatch.setattr(lambda_handler, 'process_single_item', fake_process_single_item)

    result = lambda_handler.handler(
        {
            'batch_type': 'file',
            'item': {'courseid': '1', 'id': '2', 'url': 'https://canvas.example/files/2'},
        },
        None,
    )

    assert result['status'] == 'ok'
    assert not canvas_dir.exists()


def test_lambda_handler_removes_canvas_dir_after_parse_failure(monkeypatch, tmp_path: Path):
    canvas_dir = tmp_path / 'nucleus-canvasfiles-failure'

    monkeypatch.setattr(lambda_handler.tempfile, 'mkdtemp', lambda prefix: str(canvas_dir))

    async def failing_process_single_item(*_args, canvasfiles_dir=None, **_kwargs):
        canvasfiles_dir.mkdir(parents=True, exist_ok=True)
        (canvasfiles_dir / 'partial.pdf').write_bytes(b'x' * 1024)
        raise RuntimeError('parse failed')

    monkeypatch.setattr(lambda_handler, 'process_single_item', failing_process_single_item)

    with pytest.raises(RuntimeError, match='parse failed'):
        lambda_handler.handler(
            {
                'batch_type': 'file',
                'item': {'courseid': '1', 'id': '3', 'url': 'https://canvas.example/files/3'},
            },
            None,
        )

    assert not canvas_dir.exists()
