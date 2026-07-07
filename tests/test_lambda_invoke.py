"""Tests for concurrent Lambda Event invoke batching."""
from __future__ import annotations

import threading
import time

from canvas_parser.parse.lambda_deploy import invoke_items_concurrent


class _FakeLambda:
    def __init__(self, *, delay_sec: float = 0.05) -> None:
        self.delay_sec = delay_sec
        self.active = 0
        self.peak_active = 0
        self.lock = threading.Lock()
        self.invocations: list[dict] = []

    def invoke(self, **kwargs) -> dict:
        with self.lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)
        try:
            time.sleep(self.delay_sec)
            self.invocations.append(kwargs)
            assert kwargs.get('InvocationType') == 'Event'
            return {'StatusCode': 202}
        finally:
            with self.lock:
                self.active -= 1


def test_invoke_items_concurrent_uses_thread_pool():
    client = _FakeLambda(delay_sec=0.08)
    items = [
        ('file', {'courseid': '1', 'id': str(index)}, f'file__1__{index}')
        for index in range(24)
    ]
    started = time.perf_counter()
    invoke_items_concurrent(
        client,
        'nucleus-parse-item',
        bucket='bucket',
        run_id='run-1',
        items=items,
        placement='lambda_download_parse',
        max_workers=12,
    )
    elapsed = time.perf_counter() - started
    assert len(client.invocations) == 24
    assert client.peak_active >= 4
    assert elapsed < 0.8


def test_invoke_items_concurrent_passes_seed_s3_key():
    client = _FakeLambda(delay_sec=0.0)
    items = [('file', {'courseid': '9', 'id': '42'}, 'file__9__42')]
    invoke_items_concurrent(
        client,
        'fn',
        bucket='b',
        run_id='r',
        items=items,
        placement='lambda_download_parse',
        seed_s3_key_by_item={'file__9__42': 'runs/r/seeds/9.json'},
        max_workers=1,
    )
    payload = client.invocations[0]['Payload'].decode('utf-8')
    assert 'seed_s3_key' in payload
    assert 'runs/r/seeds/9.json' in payload
