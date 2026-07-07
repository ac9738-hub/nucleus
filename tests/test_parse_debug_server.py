"""Test parse debug server preflight and POST session."""
from __future__ import annotations

import json
import threading
import time
from http.client import HTTPConnection
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def debug_server(monkeypatch):
    monkeypatch.chdir(ROOT)
    import scripts.parse_debug_server as srv
    from canvas_parser.parse.debug_runner import load_debug_batches

    srv._batches, srv._courses = load_debug_batches(ROOT, course_ids=None)
    if not srv._courses:
        pytest.skip('no debug courses available')
    import asyncio

    srv._loop = asyncio.new_event_loop()
    thread = threading.Thread(target=srv._run_async_loop, args=(srv._loop,), daemon=True)
    thread.start()
    time.sleep(0.05)
    from http.server import ThreadingHTTPServer

    server = ThreadingHTTPServer(('127.0.0.1', 0), srv.DebugHandler)
    port = server.server_address[1]
    thread2 = threading.Thread(target=server.serve_forever, daemon=True)
    thread2.start()
    try:
        yield f'127.0.0.1:{port}'
    finally:
        server.shutdown()
        server.server_close()
        srv._loop.call_soon_threadsafe(srv._loop.stop)


def _post_session(host: str, body: dict) -> dict:
    conn = HTTPConnection(host, timeout=30)
    payload = json.dumps(body).encode('utf-8')
    conn.request('POST', '/api/session', body=payload, headers={'Content-Type': 'application/json'})
    resp = conn.getresponse()
    data = json.loads(resp.read().decode('utf-8'))
    conn.close()
    return {'status': resp.status, **data}


def test_post_single_file_requires_item_key(debug_server):
    import scripts.parse_debug_server as srv

    course_id = srv._courses[0]['id']
    out = _post_session(debug_server, {
        'course_id': course_id,
        'pipeline_mode': 'single_file',
        'pause_mode': 'turn',
    })
    assert out['status'] == 400
    assert 'item_key' in out['error']


def test_health_reports_api_version(debug_server):
    from http.client import HTTPConnection

    conn = HTTPConnection(debug_server, timeout=10)
    conn.request('GET', '/api/health')
    resp = conn.getresponse()
    data = json.loads(resp.read().decode('utf-8'))
    conn.close()
    assert resp.status == 200
    assert data.get('api_version', 0) >= 2
    assert data.get('supports_full_course') is True


def test_post_session_returns_starting_or_waiting(debug_server):
    import scripts.parse_debug_server as srv
    from canvas_parser.parse.debug_runner import list_course_items

    course_id = srv._courses[0]['id']
    items = list_course_items(srv._batches, course_id)
    assert items
    out = _post_session(debug_server, {
        'course_id': course_id,
        'item_key': items[0]['key'],
        'pause_mode': 'turn',
    })
    assert out['status'] == 200
    session = out['session']
    assert session is not None
    assert session['status'] in {'starting', 'running', 'waiting', 'error'}


def test_post_full_course_session_without_item_key(debug_server):
    import scripts.parse_debug_server as srv

    course_id = srv._courses[0]['id']
    out = _post_session(debug_server, {
        'course_id': course_id,
        'pipeline_mode': 'full_course',
        'pause_mode': 'phase',
    })
    assert out['status'] == 200
    session = out['session']
    assert session is not None
    assert session['pipeline_mode'] == 'full_course'
    assert session['status'] in {'starting', 'running', 'waiting', 'error'}


def test_post_session_surfaces_missing_api_key(debug_server, monkeypatch):
    import scripts.parse_debug_server as srv
    from canvas_parser.parse.debug_runner import list_course_items

    monkeypatch.delenv('DEEP_SEEK_API_KEY', raising=False)
    monkeypatch.setattr(
        'canvas_parser.parse.balance_guard.load_deepseek_api_key',
        lambda _root: '',
    )
    course_id = srv._courses[0]['id']
    items = list_course_items(srv._batches, course_id)
    out = _post_session(debug_server, {
        'course_id': course_id,
        'item_key': items[0]['key'],
        'pause_mode': 'turn',
    })
    session = out['session']
    assert session['status'] == 'error'
    assert 'DEEP_SEEK_API_KEY' in session['error']
