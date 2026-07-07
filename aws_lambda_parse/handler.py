"""AWS Lambda handler — one Canvas parse item per invocation (URL-based download)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from canvas_parser.parse.lambda_runtime import (  # noqa: E402
    apply_canvas_auth,
    item_key,
    process_single_item,
)
from canvas_parser.parse.lambda_deploy import download_seed_from_s3  # noqa: E402


def _upload_fragment(bucket: str, run_id: str, key_suffix: str, payload: dict) -> str:
    import boto3

    client = boto3.client('s3')
    s3_key = f'runs/{run_id}/items/{key_suffix}.json'
    client.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        ContentType='application/json',
    )
    return s3_key


def handler(event, context):
    """Lambda entry: parse one batch item using ``item.url``; write fragment to S3."""
    if isinstance(event, str):
        event = json.loads(event)

    placement = str(event.get('placement') or 'lambda_download_parse')
    batch_type = str(event.get('batch_type') or 'file')
    item = event.get('item') or {}
    bucket = str(event.get('bucket') or os.getenv('NUCLEUS_PARSE_BUCKET') or '')
    run_id = str(event.get('run_id') or '')
    key_suffix = str(event.get('item_key') or item_key(batch_type, item))

    apply_canvas_auth(event.get('canvas_auth') or {})
    if event.get('production'):
        os.environ['PARSER_PRODUCTION_PARSE'] = '1'

    seed_state = event.get('seed_state')
    seed_s3_key = str(event.get('seed_s3_key') or '').strip()
    if seed_s3_key and bucket:
        import boto3

        seed_state = download_seed_from_s3(boto3.client('s3'), bucket, seed_s3_key)

    canvas_dir = Path(tempfile.mkdtemp(prefix='nucleus-canvasfiles-'))
    os.environ['PARSER_CANVASFILES_DIR'] = str(canvas_dir)
    os.environ.setdefault('PARSER_OUTSIDE_SOURCES_DIR', '/tmp/nucleus-outside-sources')
    os.environ.setdefault('PARSER_PDF_CACHE_DIR', '/tmp/pdf_extract')
    os.environ.setdefault('CANVAS_DOWNLOAD_MAX_BYTES', str(128 * 1024 * 1024))
    import asyncio

    fragment = asyncio.run(process_single_item(
        batch_type,
        item,
        placement=placement,
        canvasfiles_dir=canvas_dir,
        production=bool(event.get('production')),
        seed_state=seed_state,
    ))

    if bucket and run_id:
        s3_key = _upload_fragment(bucket, run_id, key_suffix, fragment)
        return {'status': 'ok', 'item_key': key_suffix, 's3_key': s3_key}

    return {'status': 'ok', 'item_key': key_suffix, 'fragment': fragment}
