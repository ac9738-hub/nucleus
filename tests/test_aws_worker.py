"""Tests for AWS worker state helpers."""
from __future__ import annotations

import json

from canvas_parser.parse.aws_worker import WorkerState, load_worker_state, save_worker_state


def test_worker_state_roundtrip(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    state = WorkerState(
        instance_id='i-abc123',
        public_ip='203.0.113.10',
        region='us-east-1',
        worker_spec='ubuntu@203.0.113.10:/home/ubuntu/nucleus',
    )
    path = save_worker_state(tmp_path, state)
    assert path.is_file()
    loaded = load_worker_state(tmp_path)
    assert loaded is not None
    assert loaded.instance_id == 'i-abc123'
    assert loaded.worker_spec == state.worker_spec
    data = json.loads(path.read_text(encoding='utf-8'))
    assert data['public_ip'] == '203.0.113.10'
