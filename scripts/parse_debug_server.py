#!/usr/bin/env python3
"""Local HTTP server for step-through parse pipeline debugging.

Usage:
  python scripts/parse_debug_server.py
  python scripts/parse_debug_server.py --port 8765 --course 15237

Open http://127.0.0.1:8765/
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

UI_DIR = Path(__file__).resolve().parent / 'parse_debug_ui'

_loop: asyncio.AbstractEventLoop | None = None
_session = None
_session_lock = threading.Lock()
_batches: list = []
_courses: list = []


def _json_response(handler: BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get('Content-Length') or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode('utf-8'))


def _preflight_parse_env(root: Path) -> str | None:
    """Return an error message when required parse secrets are missing."""
    from canvas_parser.parse.balance_guard import load_deepseek_api_key
    from canvas_parser.weekly_iteration.auth import apply_env_file, load_auth_from_env

    apply_env_file(root / '.env')
    if not load_deepseek_api_key(root):
        return 'DEEP_SEEK_API_KEY is not set in .env (required for LLM parse passes)'
    auth = load_auth_from_env(root)
    if not (auth.cookie or '').strip():
        return 'CANVAS_AUTH_COOKIE is not set in .env (required to download Canvas files)'
    return None


def _run_on_loop(fn, *args) -> None:
    assert _loop is not None
    _loop.call_soon_threadsafe(fn, *args)


def _begin_session(session) -> None:
    """Must run on the asyncio loop thread (create_task)."""
    session.start()


def _stop_session_on_loop(session) -> None:
    if session._task and not session._task.done():
        session._task.cancel()


class DebugHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(f'[parse-debug] {self.address_string()} {fmt % args}', flush=True)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self) -> None:
        global _session
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'

        if path == '/favicon.ico':
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return

        if path == '/' or path == '/index.html':
            index = UI_DIR / 'index.html'
            if not index.is_file():
                self.send_error(HTTPStatus.NOT_FOUND, 'Missing parse_debug_ui/index.html')
                return
            body = index.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return

        if path == '/api/health':
            host = self.headers.get('Host', '127.0.0.1:8765')
            from canvas_parser.parse.balance_guard import load_deepseek_api_key
            from canvas_parser.weekly_iteration.auth import load_auth_from_env

            env_err = _preflight_parse_env(ROOT)
            _json_response(self, {
                'ok': True,
                'api_version': 2,
                'supports_full_course': True,
                'has_session': _session is not None,
                'env_ready': env_err is None,
                'env_error': env_err,
                'has_deepseek_key': bool(load_deepseek_api_key(ROOT)),
                'has_canvas_cookie': bool((load_auth_from_env(ROOT).cookie or '').strip()),
                'url': f'http://{host}',
                'port': host.rsplit(':', 1)[-1],
            })
            return

        if path == '/api/courses':
            _json_response(self, {'courses': _courses})
            return

        if path.startswith('/api/courses/') and path.endswith('/items'):
            course_id = path.split('/')[3]
            from canvas_parser.parse.debug_runner import list_course_items

            items = list_course_items(_batches, course_id)
            _json_response(self, {'course_id': course_id, 'items': items})
            return

        if path == '/api/session/clear':
            with _session_lock:
                session = _session
            if session is not None:
                _run_on_loop(_stop_session_on_loop, session)
            with _session_lock:
                _session = None
            _json_response(self, {'ok': True})
            return

        if path == '/api/session':
            with _session_lock:
                session = _session
            if session is None:
                _json_response(self, {'session': None})
                return
            qs = parse_qs(parsed.query)
            light = (qs.get('light') or [''])[0] in {'1', 'true', 'yes'}
            step_raw = (qs.get('step') or [''])[0]
            step_index = int(step_raw) if step_raw.isdigit() else None
            try:
                snap = session.snapshot(light=light, step_index=step_index)
            except Exception as exc:
                _json_response(self, {'error': f'snapshot failed: {exc}', 'session': None}, status=500)
                return
            _json_response(self, {'session': snap})
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        global _session
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        if path == '/api/session/proceed':
            with _session_lock:
                session = _session
            if session is None:
                _json_response(self, {'error': 'no active session'}, status=404)
                return
            if session.trace.status != 'waiting':
                _json_response(self, {
                    'error': f'session not paused (status={session.trace.status})',
                    'session': session.snapshot(light=True),
                }, status=409)
                return
            session.proceed()
            _json_response(self, {'session': session.snapshot(light=True)})
            return

        if path == '/api/session/stop':
            with _session_lock:
                session = _session
            if session is not None:
                _run_on_loop(_stop_session_on_loop, session)
                session.trace.status = 'error'
                session.trace.error = 'stopped by user'
            _json_response(self, {'ok': True})
            return

        if path == '/api/session':
            body = _read_json(self)
            course_id = str(body.get('course_id') or '')
            target_key = str(body.get('item_key') or '')
            pipeline_mode = str(body.get('pipeline_mode') or 'single_file')
            pause_mode = str(body.get('pause_mode') or 'phase')
            if not course_id:
                _json_response(self, {'ok': False, 'error': 'course_id required'}, status=400)
                return
            if pipeline_mode != 'full_course' and not target_key:
                _json_response(self, {
                    'ok': False,
                    'error': 'item_key required for single-file mode',
                }, status=400)
                return

            from canvas_parser.parse.debug_runner import DebugSession

            preflight_err = _preflight_parse_env(ROOT)
            with _session_lock:
                if _session is not None:
                    _run_on_loop(_stop_session_on_loop, _session)
                _session = DebugSession(
                    root=ROOT,
                    batches=_batches,
                    course_id=course_id,
                    target_key=target_key,
                    pipeline_mode=pipeline_mode,
                    pause_mode=pause_mode,
                )
                session = _session

            if preflight_err:
                session.trace.status = 'error'
                session.trace.error = preflight_err
                session.trace.set_activity(preflight_err)
                print(f'[parse-debug] preflight failed: {preflight_err}', flush=True)
                _json_response(self, {'session': session.snapshot(light=True)})
                return

            session.trace.status = 'starting'
            session.trace.set_activity('Starting parser session…')
            print(
                f'[parse-debug] run course={course_id} mode={pipeline_mode} '
                f'file={target_key or "(all)"} pause={pause_mode}',
                flush=True,
            )
            _run_on_loop(_begin_session, session)
            try:
                snap = session.snapshot(light=True)
            except Exception as exc:
                session.trace.status = 'error'
                session.trace.error = f'snapshot failed: {exc}'
                snap = session.snapshot(light=True)
            _json_response(self, {
                'session': snap,
            })
            return

        self.send_error(HTTPStatus.NOT_FOUND)


def _run_async_loop(loop: asyncio.AbstractEventLoop) -> None:
    asyncio.set_event_loop(loop)

    def _on_exception(_loop, context):
        exc = context.get('exception')
        msg = context.get('message', 'asyncio error')
        print(f'[parse-debug] asyncio: {msg}', flush=True)
        if exc:
            print(f'[parse-debug] {exc!r}', flush=True)
            with _session_lock:
                if _session is not None and _session.trace.status not in {'done', 'error'}:
                    _session.trace.status = 'error'
                    _session.trace.error = f'{exc}'

    loop.set_exception_handler(_on_exception)
    loop.run_forever()


def main() -> int:
    global _loop, _batches, _courses

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--course', type=int, nargs='*', default=None)
    args = parser.parse_args()

    from canvas_parser.weekly_iteration.auth import apply_env_file

    apply_env_file(ROOT / '.env')

    from canvas_parser.parse.debug_runner import load_debug_batches

    _batches, _courses = load_debug_batches(ROOT, course_ids=args.course)
    if not _courses:
        print(
            'No courses found. Ensure canvas_data.json or '
            'fixtures/weekly_iteration/snapshots_gt.json exists.',
            file=sys.stderr,
        )
        return 1

    _loop = asyncio.new_event_loop()
    thread = threading.Thread(target=_run_async_loop, args=(_loop,), daemon=True)
    thread.start()
    time.sleep(0.05)

    server = ThreadingHTTPServer((args.host, args.port), DebugHandler)
    url = f'http://{args.host}:{args.port}/'
    print(f'Parse debug UI: {url}', flush=True)
    print(f'Port: {args.port}', flush=True)
    print(f'Courses loaded: {len(_courses)}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down.')
    finally:
        server.server_close()
        _loop.call_soon_threadsafe(_loop.stop)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
