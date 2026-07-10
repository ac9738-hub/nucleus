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

PARSER_BATCH_TYPE_ORDER = (
    'syllabus',
    'assignment',
    'page',
    'module_item',
    'file',
    'external_submission',
)


def merge_parser_batches_by_type(batches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Coalesce per-course batches so file/page work keeps parse concurrency saturated."""
    buckets: dict[str, list[Any]] = {}
    for batch in batches:
        batch_type = str(batch.get('type') or 'unknown')
        content = batch.get('content')
        if not isinstance(content, list):
            continue
        buckets.setdefault(batch_type, []).extend(content)
    if not buckets:
        return batches
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for batch_type in PARSER_BATCH_TYPE_ORDER:
        content = buckets.get(batch_type)
        if content:
            merged.append({'type': batch_type, 'content': content})
            seen.add(batch_type)
    for batch_type, content in buckets.items():
        if batch_type not in seen and content:
            merged.append({'type': batch_type, 'content': content})
    return merged


def _is_parseable_file(file_item: dict[str, Any]) -> bool:
    from canvas_parser.content.extractors import detect_extractor

    content_type = file_item.get('content-type') or file_item.get('content_type') or ''
    filename = file_item.get('display_name') or file_item.get('filename') or file_item.get('name') or ''
    return bool(detect_extractor(content_type, filename))


def _synthesize_module_only_files(
    files: list[dict[str, Any]],
    module_items: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    merged = list(files or [])
    seen = {str(row.get('id')) for row in merged if row.get('id') is not None}
    for items in (module_items or {}).values():
        for item in items or []:
            if str(item.get('type') or '').lower() != 'file':
                continue
            file_id = str(item.get('content_id') or item.get('id') or '')
            if not file_id or file_id in seen:
                continue
            title = str(item.get('title') or item.get('name') or '').strip()
            if not title:
                continue
            merged.append({
                'id': file_id,
                'display_name': title,
                'filename': title,
                'content-type': item.get('content-type') or item.get('content_type') or '',
            })
            seen.add(file_id)
    return merged


def _extract_canvas_file_ids_from_html(html: str) -> list[str]:
    import re

    ids: set[str] = set()
    source = str(html or '')
    if not source:
        return []
    patterns = (
        r'/files/(\d+)',
        r'preview=(\d+)',
        r'data-api-endpoint="[^"]*/files/(\d+)',
    )
    for pattern in patterns:
        for match in re.finditer(pattern, source, flags=re.IGNORECASE):
            ids.add(str(match.group(1)))
    return list(ids)


def _page_lookup_keys(*values: Any) -> set[str]:
    keys: set[str] = set()
    for value in values:
        text = str(value or '').strip()
        if not text:
            continue
        trimmed = text.rstrip('/')
        keys.add(text.lower())
        keys.add(trimmed.lower())
        if '/' in trimmed:
            keys.add(trimmed.rsplit('/', 1)[-1].lower())
    keys.discard('')
    return keys


def _page_record_keys(page: dict[str, Any]) -> set[str]:
    return _page_lookup_keys(
        page.get('url'),
        page.get('page_url'),
        page.get('page_id'),
        page.get('html_url'),
    )


def _build_page_body_index(snapshot: dict[str, Any]) -> dict[str, str]:
    index: dict[str, str] = {}
    for key, body in (snapshot.get('page_bodies') or {}).items():
        body_text = str(body or '')
        if not body_text:
            continue
        for lookup_key in _page_lookup_keys(key):
            index[lookup_key] = body_text
    for page in snapshot.get('pages') or []:
        body_text = str(page.get('body') or '')
        if not body_text:
            continue
        for lookup_key in _page_record_keys(page):
            index[lookup_key] = body_text
    front_pages = snapshot.get('front_pages') or {}
    if isinstance(front_pages, dict):
        for page in front_pages.values():
            if not isinstance(page, dict):
                continue
            body_text = str(page.get('body') or '')
            if not body_text:
                continue
            for lookup_key in _page_record_keys(page):
                index[lookup_key] = body_text
    return index


def _lookup_page_body(page_body_index: dict[str, str], *values: Any) -> str:
    for lookup_key in _page_lookup_keys(*values):
        body = page_body_index.get(lookup_key)
        if body:
            return body
    return ''


_BARE_FILE_DOWNLOAD_RE = re.compile(
    r'^(https?://[^/]+)/files/(\d+)/download/?(?:\?.*)?$',
    re.I,
)
_BARE_FILE_PREVIEW_RE = re.compile(
    r'^(https?://[^/]+)/files/(\d+)/preview/?(?:\?.*)?$',
    re.I,
)
_CANVAS_FILE_DOWNLOAD_RE = re.compile(r'/files/\d+/download', re.I)


def normalize_canvas_file_download_url(
    base_url: str,
    course_id: str,
    file_id: str,
    raw_url: str = '',
) -> str:
    """Return Canvas download URL, matching app ``buildParserFileRecord`` behavior.

    Prefer the Canvas Files API ``url`` as-is (includes ``download_frd=1`` redirect
    hop). Only synthesize a course-scoped download URL when the snapshot omits one.
    """
    cid = str(course_id or '').strip()
    fid = str(file_id or '').strip()
    base = str(base_url or '').rstrip('/')
    raw = str(raw_url or '').strip()
    if raw and _CANVAS_FILE_DOWNLOAD_RE.search(raw):
        return raw
    fallback = f'{base}/courses/{cid}/files/{fid}/download?download_frd=1' if base and cid and fid else ''
    if not raw:
        return fallback
    bare = _BARE_FILE_DOWNLOAD_RE.match(raw.split('?')[0].rstrip('/'))
    if bare and cid:
        host = bare.group(1)
        use_id = fid or bare.group(2)
        return f'{host}/courses/{cid}/files/{use_id}/download?download_frd=1'
    return raw if raw else fallback


def normalize_canvas_file_preview_url(
    base_url: str,
    course_id: str,
    file_id: str,
    raw_url: str = '',
    *,
    download_url: str = '',
) -> str:
    cid = str(course_id or '').strip()
    fid = str(file_id or '').strip()
    base = str(base_url or '').rstrip('/')
    fallback = f'{base}/courses/{cid}/files?preview={fid}' if base and cid and fid else ''
    raw = str(raw_url or '').strip()
    if not raw:
        if download_url:
            return download_url.replace(f'/files/{fid}/download', f'/files?preview={fid}')
        return fallback
    if cid and f'/courses/{cid}/files' in raw:
        return raw
    bare = _BARE_FILE_PREVIEW_RE.match(raw.split('?')[0].rstrip('/'))
    if bare and cid:
        host = bare.group(1)
        use_id = fid or bare.group(2)
        return f'{host}/courses/{cid}/files?preview={use_id}'
    if raw and '/files/' in raw and '/courses/' not in raw and cid and fid:
        host_match = re.match(r'(https?://[^/]+)', raw)
        if host_match:
            return f'{host_match.group(1)}/courses/{cid}/files?preview={fid}'
    return raw if raw else fallback


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
    seen_page_keys: set[str] = set()
    page_body_index = _build_page_body_index(snapshot)
    module_name_by_id = {
        str(module.get('id') or ''): str(module.get('name') or '')
        for module in (snapshot.get('modules') or [])
    }

    def add_page_item(
        *,
        page_id: str,
        page_url: str,
        preview_url: str,
        name: str,
        title: str,
        html_url: str,
        body_html: str,
        module_name: str = '',
        seen_values: tuple[Any, ...] = (),
    ) -> None:
        body_text = _strip_html(body_html)
        if not body_text:
            return
        keys = _page_lookup_keys(page_id, page_url, preview_url, html_url, *seen_values)
        if keys and seen_page_keys.intersection(keys):
            return
        seen_page_keys.update(keys)
        parsing_pages.append({
            'id': page_id,
            'url': page_url,
            'previewurl': preview_url,
            'courseid': course_id,
            'name': name,
            'content': json.dumps({
                'documenttype': 'page',
                'title': title,
                'url': page_url,
                'body_html': body_html,
                'body_text': body_text,
                'html_url': html_url,
                'moduleName': module_name,
            }, ensure_ascii=False),
        })

    for module_id, items in (snapshot.get('module_items') or {}).items():
        module_name = module_name_by_id.get(str(module_id), '')
        for item in items or []:
            if str(item.get('type') or '').lower() != 'page':
                continue
            page_url = str(item.get('url') or '').strip()
            page_id = str(item.get('page_url') or item.get('id') or page_url)
            if not page_id:
                continue
            body_html = _lookup_page_body(
                page_body_index,
                page_url,
                item.get('page_url'),
                item.get('html_url'),
            )
            add_page_item(
                page_id=page_id,
                page_url=page_url,
                preview_url=item.get('html_url') or page_url,
                name=item.get('title') or page_id,
                title=item.get('title') or '',
                html_url=item.get('html_url') or '',
                body_html=body_html,
                module_name=module_name,
                seen_values=(item.get('page_url'), item.get('html_url')),
            )

    for page in snapshot.get('pages') or []:
        body_html = str(page.get('body') or '') or _lookup_page_body(
            page_body_index,
            page.get('url'),
            page.get('page_id'),
            page.get('html_url'),
        )
        page_id = str(
            page.get('page_id')
            or page.get('url')
            or page.get('html_url')
            or ''
        ).strip()
        if not page_id:
            continue
        page_url = str(page.get('html_url') or page.get('url') or '').strip()
        add_page_item(
            page_id=page_id,
            page_url=page_url,
            preview_url=page.get('html_url') or page_url,
            name=page.get('title') or page.get('url') or page_id,
            title=page.get('title') or page.get('url') or '',
            html_url=page.get('html_url') or '',
            body_html=body_html,
            seen_values=(page.get('url'), page.get('page_id'), page.get('html_url')),
        )
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
    linked_ids: set[str] = set()
    for assignment in snapshot.get('assignments') or []:
        linked_ids.update(_extract_canvas_file_ids_from_html(str(assignment.get('description') or '')))
    for body_html in page_body_index.values():
        linked_ids.update(_extract_canvas_file_ids_from_html(str(body_html or '')))
    for page in snapshot.get('pages') or []:
        linked_ids.update(_extract_canvas_file_ids_from_html(str(page.get('body') or '')))

    snapshot_files = list(snapshot.get('files') or [])
    for file_id in linked_ids:
        if any(str(row.get('id') or '') == file_id for row in snapshot_files):
            continue
        snapshot_files.append({
            'id': file_id,
            'display_name': f'Linked file {file_id}',
            'filename': f'file-{file_id}',
            'url': f'{base_url}/courses/{course_id}/files/{file_id}/download',
        })

    snapshot_files = _synthesize_module_only_files(
        snapshot_files,
        snapshot.get('module_items') or {},
    )

    for file_item in snapshot_files:
        file_id = file_item.get('id')
        if not file_id:
            continue
        if not _is_parseable_file(file_item):
            continue
        content_type = file_item.get('content-type') or file_item.get('content_type') or ''
        download_url = normalize_canvas_file_download_url(
            base_url,
            course_id,
            str(file_id),
            str(file_item.get('url') or ''),
        )
        preview_url = normalize_canvas_file_preview_url(
            base_url,
            course_id,
            str(file_id),
            str(file_item.get('previewurl') or ''),
            download_url=download_url,
        )
        parsing_files.append({
            'url': download_url,
            'previewurl': preview_url,
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
    max_items: int | None = None,
) -> list[dict[str, Any]]:
    """Split large parser batches so each stdin line stays within a fair item cap."""
    if max_items is None:
        max_items = int(os.getenv('PARSER_MAX_BATCH_ITEMS', str(MAX_PARSER_BATCH_ITEMS)))
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
    keep_graph: bool = False,
    resume_graph: bool = False,
    restore_on_failure: bool = True,
    extra_env: dict[str, str] | None = None,
) -> dict[str, Any]:
    if not batches:
        return {}

    backup_path = _backup_graph(root_dir) if not resume_graph else None
    graph_path = root_dir / 'canvas_graph.json'
    if not resume_graph and graph_path.is_file():
        graph_path.unlink()

    env = os.environ.copy()
    env.update({
        'PYTHONIOENCODING': 'utf-8',
        'PYTHONUNBUFFERED': '1',
        'PYTHONUTF8': '1',
        'CANVAS_AUTH_COOKIE': auth.cookie,
        'CANVAS_AUTH_CSRF': auth.csrf,
        'CANVAS_BASE_URL': auth.base_url,
    })
    if extra_env:
        env.update(extra_env)

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
    parser_success = {'ok': False}

    def _watch_stdout() -> None:
        try:
            for line in proc.stdout:
                try:
                    sys.stdout.write(line)
                except UnicodeEncodeError:
                    sys.stdout.buffer.write(line.encode('utf-8', errors='replace'))
                if PARSER_DONE_MARKER in line:
                    parser_success['ok'] = True
                    done.set()
                    break
        finally:
            if not parser_success['ok']:
                done.set()

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
        if restore_on_failure:
            _restore_graph(root_dir, backup_path)
        raise RuntimeError(f'parser timed out after {timeout_seconds}s')

    watcher.join(timeout=30)
    proc.wait(timeout=60)
    if proc.returncode == 2:
        if restore_on_failure:
            _restore_graph(root_dir, backup_path)
        raise RuntimeError(
            'parser aborted: DeepSeek insufficient balance (402) — top up DEEP_SEEK_API_KEY'
        )
    if not parser_success['ok']:
        if restore_on_failure:
            _restore_graph(root_dir, backup_path)
        code = proc.returncode if proc.returncode is not None else 'unknown'
        raise RuntimeError(f'parser exited without completing (code {code})')
    if proc.returncode not in (0, None):
        if restore_on_failure:
            _restore_graph(root_dir, backup_path)
        raise RuntimeError(f'parser exited with code {proc.returncode}')

    if not graph_path.is_file():
        if restore_on_failure:
            _restore_graph(root_dir, backup_path)
        return {}

    graph = json.loads(graph_path.read_text(encoding='utf-8'))
    if not keep_graph:
        _restore_graph(root_dir, backup_path)
    elif backup_path and backup_path.is_file():
        backup_path.unlink(missing_ok=True)
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
