"""Run parser.py LLM passes against Canvas snapshots for weekly iteration."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
from html import unescape
from pathlib import Path
from typing import Any

from .auth import CanvasAuth
from .limits import MAX_PARSER_BATCH_ITEMS

PARSER_DONE_MARKER = 'parser all passes completed__________________________________________________'


def _strip_html(value: str) -> str:
    text = unescape(re.sub(r'<[^>]+>', ' ', str(value or '')))
    return re.sub(r'\s+', ' ', text).strip()


def snapshot_to_canvas_data(snapshot: dict[str, Any]) -> dict[str, Any]:
    course = snapshot.get('course') or {}
    course_id = str(course.get('id') or '')
    return {
        'courses': [course],
        'assignments': {course_id: snapshot.get('assignments') or []},
        'files': {course_id: snapshot.get('files') or []},
        'modules': {course_id: snapshot.get('modules') or []},
        'module_items': {course_id: snapshot.get('module_items') or {}},
        'pages': {course_id: snapshot.get('pages') or []},
    }


def build_parser_batches(snapshot: dict[str, Any], base_url: str) -> list[dict[str, Any]]:
    course = snapshot.get('course') or {}
    course_id = str(course.get('id') or '')
    if not course_id:
        return []

    batches: list[dict[str, Any]] = []
    syllabus_html = course.get('syllabus_body') or ''
    syllabus_text = _strip_html(syllabus_html)
    if syllabus_text:
        batches.append({
            'type': 'syllabus',
            'content': [{
                'id': f'course-syllabus-{course_id}',
                'url': f'{base_url}/courses/{course_id}/assignments/syllabus',
                'previewurl': f'{base_url}/courses/{course_id}/assignments/syllabus',
                'courseid': course_id,
                'name': f"{course.get('name') or 'Course'} syllabus",
                'content': json.dumps({
                    'documenttype': 'syllabus',
                    'coursename': course.get('name') or '',
                    'html_url': f'{base_url}/courses/{course_id}/assignments/syllabus',
                    'syllabus': syllabus_text,
                }, ensure_ascii=False),
            }],
        })

    parsing_assignments = []
    for assignment in snapshot.get('assignments') or []:
        assignment_id = assignment.get('id')
        name = assignment.get('name') or ''
        if not assignment_id or not name:
            continue
        parsing_assignments.append({
            'id': assignment_id,
            'url': assignment.get('html_url') or '',
            'previewurl': assignment.get('html_url') or '',
            'courseid': course_id,
            'name': name,
            'content': json.dumps({
                'documenttype': 'assignment',
                'assignmentname': name,
                'description': _strip_html(assignment.get('description') or ''),
                'description_text': _strip_html(assignment.get('description') or ''),
                'description_html': assignment.get('description') or '',
                'submission_types': assignment.get('submission_types') or [],
                'duedate': assignment.get('due_at') or '',
                'unlockdate': assignment.get('unlock_at') or '',
                'lockdate': assignment.get('lock_at') or '',
                'points_possible': assignment.get('points_possible') if assignment.get('points_possible') is not None else '',
                'html_url': assignment.get('html_url') or '',
            }, ensure_ascii=False),
        })
    if parsing_assignments:
        batches.append({'type': 'assignment', 'content': parsing_assignments})

    parsing_pages = []
    seen_page_ids: set[str] = set()
    page_bodies = snapshot.get('page_bodies') or {}
    module_name_by_id = {
        str(module.get('id') or ''): str(module.get('name') or '')
        for module in (snapshot.get('modules') or [])
    }
    for module_id, items in (snapshot.get('module_items') or {}).items():
        module_name = module_name_by_id.get(str(module_id), '')
        for item in items or []:
            if str(item.get('type') or '').lower() != 'page':
                continue
            page_url = str(item.get('url') or '').strip()
            page_id = str(item.get('page_url') or item.get('id') or page_url)
            if not page_id or page_id in seen_page_ids:
                continue
            body_html = page_bodies.get(page_url) or ''
            body_text = _strip_html(body_html)
            if not body_text:
                continue
            seen_page_ids.add(page_id)
            parsing_pages.append({
                'id': page_id,
                'url': page_url,
                'previewurl': item.get('html_url') or page_url,
                'courseid': course_id,
                'name': item.get('title') or page_id,
                'content': json.dumps({
                    'documenttype': 'page',
                    'title': item.get('title') or '',
                    'url': item.get('page_url') or '',
                    'body_html': body_html,
                    'body_text': body_text,
                    'html_url': item.get('html_url') or '',
                    'moduleName': module_name,
                }, ensure_ascii=False),
            })
    if parsing_pages:
        batches.append({'type': 'page', 'content': parsing_pages})

    parsing_module_items = []
    for module_id, items in (snapshot.get('module_items') or {}).items():
        module_name = module_name_by_id.get(str(module_id), '')
        for item in items or []:
            item_id = item.get('id')
            if not item_id:
                continue
            parsing_module_items.append({
                'id': item_id,
                'url': item.get('html_url') or item.get('external_url') or '',
                'previewurl': item.get('html_url') or item.get('external_url') or '',
                'courseid': course_id,
                'name': item.get('title') or item.get('type') or 'Module item',
                'content': json.dumps({
                    'documenttype': 'module_item',
                    'moduleId': str(module_id),
                    'moduleName': module_name,
                    'position': item.get('position') or 0,
                    'itemType': item.get('type') or '',
                    'title': item.get('title') or '',
                    'html_url': item.get('html_url') or '',
                    'external_url': item.get('external_url') or '',
                    'content_id': item.get('content_id') or '',
                    'page_url': item.get('page_url') or '',
                }, ensure_ascii=False),
            })
    if parsing_module_items:
        batches.append({'type': 'module_item', 'content': parsing_module_items})

    parsing_files = []
    for file_item in snapshot.get('files') or []:
        file_id = file_item.get('id')
        if not file_id:
            continue
        content_type = file_item.get('content-type') or file_item.get('content_type') or ''
        parsing_files.append({
            'url': file_item.get('url') or '',
            'previewurl': file_item.get('previewurl') or file_item.get('url') or '',
            'id': file_id,
            'name': file_item.get('display_name') or file_item.get('filename') or file_item.get('name') or '',
            'courseid': course_id,
            'content_type': content_type,
        })
    if parsing_files:
        batches.append({'type': 'file', 'content': parsing_files})

    return batches


def chunk_parser_batches(
    batches: list[dict[str, Any]],
    *,
    max_items: int = MAX_PARSER_BATCH_ITEMS,
) -> list[dict[str, Any]]:
    """Split large parser batches so each stdin line stays within a fair item cap."""
    if max_items <= 0:
        return batches
    chunked: list[dict[str, Any]] = []
    for batch in batches:
        batch_type = batch.get('type', 'unknown')
        content = batch.get('content')
        if not isinstance(content, list) or len(content) <= max_items:
            chunked.append(batch)
            continue
        for index in range(0, len(content), max_items):
            chunked.append({'type': batch_type, 'content': content[index:index + max_items]})
    return chunked


def _backup_graph(root_dir: Path) -> Path | None:
    graph_path = root_dir / 'canvas_graph.json'
    if not graph_path.is_file():
        return None
    backup_path = root_dir / 'canvas_graph.json.weekly_iteration.bak'
    shutil.copy2(graph_path, backup_path)
    return backup_path


def _restore_graph(root_dir: Path, backup_path: Path | None) -> None:
    graph_path = root_dir / 'canvas_graph.json'
    if backup_path and backup_path.is_file():
        shutil.copy2(backup_path, graph_path)
        backup_path.unlink(missing_ok=True)
    elif graph_path.is_file():
        graph_path.unlink(missing_ok=True)


def run_parser_batches(
    batches: list[dict[str, Any]],
    root_dir: Path,
    auth: CanvasAuth,
    *,
    timeout_seconds: int = 2100,
) -> dict[str, Any]:
    if not batches:
        return {}

    backup_path = _backup_graph(root_dir)
    graph_path = root_dir / 'canvas_graph.json'
    if graph_path.is_file():
        graph_path.unlink()

    env = os.environ.copy()
    env.update({
        'PYTHONIOENCODING': 'utf-8',
        'PYTHONUNBUFFERED': '1',
        'CANVAS_AUTH_COOKIE': auth.cookie,
        'CANVAS_AUTH_CSRF': auth.csrf,
        'CANVAS_BASE_URL': auth.base_url,
    })

    proc = subprocess.Popen(
        [sys.executable, str(root_dir / 'parser.py')],
        cwd=str(root_dir),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        text=True,
        encoding='utf-8',
        errors='replace',
    )
    assert proc.stdin is not None
    assert proc.stdout is not None

    done = threading.Event()

    def _watch_stdout() -> None:
        for line in proc.stdout:
            sys.stdout.write(line)
            if PARSER_DONE_MARKER in line:
                done.set()
                break

    watcher = threading.Thread(target=_watch_stdout, daemon=True)
    watcher.start()

    for batch in chunk_parser_batches(batches):
        line = json.dumps(batch, ensure_ascii=False) + '\n'
        proc.stdin.write(line)
        proc.stdin.flush()
    proc.stdin.write('None\n')
    proc.stdin.flush()
    proc.stdin.close()

    if not done.wait(timeout=timeout_seconds):
        proc.kill()
        _restore_graph(root_dir, backup_path)
        raise RuntimeError(f'parser timed out after {timeout_seconds}s')

    proc.wait(timeout=60)
    if proc.returncode not in (0, None):
        _restore_graph(root_dir, backup_path)
        raise RuntimeError(f'parser exited with code {proc.returncode}')

    if not graph_path.is_file():
        _restore_graph(root_dir, backup_path)
        return {}

    graph = json.loads(graph_path.read_text(encoding='utf-8'))
    _restore_graph(root_dir, backup_path)
    return graph


def run_parser_for_snapshots(
    snapshots: list[dict[str, Any]],
    root_dir: Path,
    auth: CanvasAuth,
) -> dict[str, Any]:
    all_batches: list[dict[str, Any]] = []
    for snapshot in snapshots:
        all_batches.extend(build_parser_batches(snapshot, auth.base_url))
    return run_parser_batches(all_batches, root_dir, auth)
