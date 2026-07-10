"""Tests for concurrent Lambda Event invoke batching."""
from __future__ import annotations

import threading
import time

from canvas_parser.parse.lambda_deploy import (
    expected_s3_item_result_keys,
    invoke_items_concurrent,
    wait_for_s3_items,
)


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


class _FakeS3List:
    def __init__(self, snapshots: list[list[str]]) -> None:
        self.snapshots = snapshots
        self.calls = 0

    def list_objects_v2(self, **kwargs) -> dict:
        index = min(self.calls, len(self.snapshots) - 1)
        self.calls += 1
        return {
            'Contents': [{'Key': key} for key in self.snapshots[index]],
            'IsTruncated': False,
        }


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


def test_wait_for_s3_items_requires_expected_item_keys():
    items = [
        ('file', {'courseid': '1', 'id': 'a'}, 'file__1__a'),
        ('file', {'courseid': '1', 'id': 'b'}, 'file__1__b'),
    ]
    expected_keys = expected_s3_item_result_keys('run-1', items)
    stale_key = 'runs/run-1/items/stale-from-prior-attempt.json'
    first_key = 'runs/run-1/items/file__1__a.json'
    second_key = 'runs/run-1/items/file__1__b.json'
    s3 = _FakeS3List([
        [stale_key, first_key],
        [stale_key, first_key, second_key],
    ])
    progress: list[tuple[int, int]] = []

    keys = wait_for_s3_items(
        s3,
        'bucket',
        'run-1',
        len(items),
        expected_keys=expected_keys,
        poll_sec=0,
        timeout_sec=1,
        on_progress=lambda done, total: progress.append((done, total)),
    )

    assert keys == [first_key, second_key]
    assert progress[0] == (1, 2)
    assert progress[-1] == (2, 2)


def test_wait_for_s3_items_times_out_when_only_stale_keys_satisfy_count():
    items = [
        ('file', {'courseid': '1', 'id': 'a'}, 'file__1__a'),
        ('file', {'courseid': '1', 'id': 'b'}, 'file__1__b'),
    ]
    expected_keys = expected_s3_item_result_keys('run-2', items)
    s3 = _FakeS3List([
        [
            'runs/run-2/items/file__1__a.json',
            'runs/run-2/items/stale-from-prior-attempt.json',
        ]
    ])

    try:
        wait_for_s3_items(
            s3,
            'bucket',
            'run-2',
            len(items),
            expected_keys=expected_keys,
            poll_sec=0,
            timeout_sec=0.001,
        )
    except TimeoutError as error:
        assert 'missing 1 expected item keys' in str(error)
        assert 'file__1__b.json' in str(error)
    else:
        raise AssertionError('expected wait_for_s3_items to time out')
