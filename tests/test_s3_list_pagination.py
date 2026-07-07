"""Tests for S3 list pagination in Lambda deploy helpers."""
from __future__ import annotations

from canvas_parser.parse.lambda_deploy import _list_s3_json_keys


class _FakeS3:
    def __init__(self, pages: list[dict]) -> None:
        self.pages = pages
        self.calls = 0

    def list_objects_v2(self, **kwargs):
        page = self.pages[self.calls]
        self.calls += 1
        return page


def test_list_s3_json_keys_paginates_past_1000():
    page1_keys = [f'runs/r1/items/item_{index:04d}.json' for index in range(1000)]
    page2_keys = [f'runs/r1/items/item_{index:04d}.json' for index in range(1000, 1323)]
    client = _FakeS3([
        {
            'Contents': [{'Key': key} for key in page1_keys],
            'IsTruncated': True,
            'NextContinuationToken': 'token-2',
        },
        {
            'Contents': [{'Key': key} for key in page2_keys],
            'IsTruncated': False,
        },
    ])
    keys = _list_s3_json_keys(client, 'bucket', 'runs/r1/items/')
    assert len(keys) == 1323
    assert client.calls == 2
