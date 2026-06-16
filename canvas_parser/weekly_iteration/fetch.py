"""Fetch raw Canvas API data using saved session auth."""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .auth import CanvasAuth
from .limits import MAX_PAGE_BODY_FETCHES, MAX_PAGINATION_ITEMS, MAX_PAGINATION_PAGES, PER_PAGE


class CanvasFetchError(RuntimeError):
    pass


def _auth_headers(auth: CanvasAuth) -> dict[str, str]:
    headers = {
        'Accept': 'application/json',
        'Cookie': auth.cookie,
        'User-Agent': 'nucleus-weekly-iteration/1.0',
    }
    if auth.csrf:
        headers['X-CSRF-Token'] = auth.csrf
    return headers


def _parse_link_next(link_header: str) -> str | None:
    if not link_header:
        return None
    for part in link_header.split(','):
        section = part.strip()
        if 'rel="next"' in section or "rel='next'" in section:
            match = re.search(r'<([^>]+)>', section)
            if match:
                return match.group(1)
    return None


def fetch_json(auth: CanvasAuth, url: str, *, attempts: int = 3) -> Any:
    last_error: Exception | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers=_auth_headers(auth))
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read().decode('utf-8')
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf-8', errors='replace')
            raise CanvasFetchError(f'HTTP {error.code} for {url}: {body[:300]}') from error
        except urllib.error.URLError as error:
            last_error = error
            if attempt < attempts - 1:
                time.sleep(1 + attempt)
                continue
            raise CanvasFetchError(f'Network error for {url}: {error}') from error
    if last_error:
        raise CanvasFetchError(f'Network error for {url}: {last_error}') from last_error
    return None


def fetch_paginated(
    auth: CanvasAuth,
    url: str,
    *,
    attempts: int = 3,
    max_pages: int = MAX_PAGINATION_PAGES,
    max_items: int = MAX_PAGINATION_ITEMS,
) -> list[Any]:
    items: list[Any] = []
    next_url = url
    pages_fetched = 0
    while next_url:
        if pages_fetched >= max_pages or len(items) >= max_items:
            print(
                f'Warning: pagination cap reached for {url} '
                f'(pages={pages_fetched}, items={len(items)})',
                flush=True,
            )
            break
        last_error: Exception | None = None
        page = None
        for attempt in range(attempts):
            request = urllib.request.Request(next_url, headers=_auth_headers(auth))
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    raw = response.read().decode('utf-8')
                    page = json.loads(raw) if raw.strip() else []
                    next_url = _parse_link_next(response.headers.get('Link', ''))
                    break
            except urllib.error.HTTPError as error:
                body = error.read().decode('utf-8', errors='replace')
                raise CanvasFetchError(f'HTTP {error.code} for {next_url}: {body[:300]}') from error
            except urllib.error.URLError as error:
                last_error = error
                if attempt < attempts - 1:
                    time.sleep(1 + attempt)
                    continue
                raise CanvasFetchError(f'Network error for {next_url}: {error}') from error
        if page is None:
            if last_error:
                raise CanvasFetchError(f'Network error for {next_url}: {last_error}') from last_error
            break
        pages_fetched += 1
        if isinstance(page, list):
            remaining = max_items - len(items)
            if remaining <= 0:
                break
            if len(page) > remaining:
                items.extend(page[:remaining])
                print(
                    f'Warning: pagination item cap reached for {url} ({max_items} items)',
                    flush=True,
                )
                break
            items.extend(page)
        else:
            return [page]
    return items


def validate_auth(auth: CanvasAuth) -> dict[str, Any]:
    return fetch_json(auth, f'{auth.base_url}/api/v1/users/self')


def fetch_courses(auth: CanvasAuth) -> list[dict[str, Any]]:
    url = f'{auth.base_url}/api/v1/courses?per_page={PER_PAGE}&include[]=term'
    courses = fetch_paginated(auth, url)
    return [
        course for course in courses
        if course.get('id') and course.get('workflow_state') != 'deleted'
    ]


def fetch_course_bucket(auth: CanvasAuth, course_id: int | str, bucket: str) -> list[dict[str, Any]]:
    url = f'{auth.base_url}/api/v1/courses/{course_id}/{bucket}?per_page={PER_PAGE}'
    try:
        return fetch_paginated(auth, url)
    except CanvasFetchError:
        return []


def fetch_course_syllabus(auth: CanvasAuth, course_id: int | str) -> dict[str, Any] | None:
    url = (
        f'{auth.base_url}/api/v1/courses/{course_id}'
        f'?include[]=syllabus_body&include[]=term'
    )
    try:
        return fetch_json(auth, url)
    except CanvasFetchError:
        return None


def fetch_module_items(auth: CanvasAuth, items_url: str) -> list[dict[str, Any]]:
    try:
        return fetch_paginated(auth, items_url)
    except CanvasFetchError:
        return []


def enrich_snapshot_with_page_bodies(auth: CanvasAuth, snapshot: dict[str, Any]) -> dict[str, Any]:
    page_bodies: dict[str, str] = {}
    seen_urls: set[str] = set()
    fetched = 0
    for items in (snapshot.get('module_items') or {}).values():
        for item in items:
            if fetched >= MAX_PAGE_BODY_FETCHES:
                print(
                    f'Warning: page-body fetch cap reached ({MAX_PAGE_BODY_FETCHES}) '
                    f'for course {((snapshot.get("course") or {}).get("id"))}',
                    flush=True,
                )
                snapshot['page_bodies'] = page_bodies
                return snapshot
            if str(item.get('type') or '').lower() != 'page':
                continue
            api_url = str(item.get('url') or '').strip()
            if not api_url or api_url in seen_urls:
                continue
            seen_urls.add(api_url)
            try:
                page = fetch_json(auth, api_url)
            except CanvasFetchError:
                continue
            fetched += 1
            if isinstance(page, dict):
                page_bodies[api_url] = page.get('body') or ''
    snapshot['page_bodies'] = page_bodies
    return snapshot


def fetch_course_snapshot(auth: CanvasAuth, course: dict[str, Any]) -> dict[str, Any]:
    course_id = course['id']
    modules = fetch_course_bucket(auth, course_id, 'modules')
    module_items: dict[str, list[dict[str, Any]]] = {}
    for module in modules:
        items_url = module.get('items_url')
        if not items_url:
            continue
        module_items[str(module['id'])] = fetch_module_items(auth, items_url)

    assignments = fetch_course_bucket(auth, course_id, 'assignments')
    files = fetch_course_bucket(auth, course_id, 'files')
    pages = fetch_course_bucket(auth, course_id, 'pages')
    syllabus_course = fetch_course_syllabus(auth, course_id) or {}

    snapshot = {
        'course': {
            **course,
            'syllabus_body': syllabus_course.get('syllabus_body') or course.get('syllabus_body') or '',
            'start_at': syllabus_course.get('start_at') or course.get('start_at') or '',
            'end_at': syllabus_course.get('end_at') or course.get('end_at') or '',
            'term': syllabus_course.get('term') or course.get('term') or {},
        },
        'assignments': assignments,
        'files': files,
        'pages': pages,
        'modules': sorted(modules, key=lambda module: module.get('position') or 0),
        'module_items': module_items,
    }
    return enrich_snapshot_with_page_bodies(auth, snapshot)


def fetch_course_snapshot_by_id(auth: CanvasAuth, course_id: int | str) -> dict[str, Any]:
    course = fetch_course_syllabus(auth, course_id)
    if not course or not course.get('id'):
        raise CanvasFetchError(f'Could not load course {course_id}')
    return fetch_course_snapshot(auth, course)


def fetch_course_snapshots_by_ids(auth: CanvasAuth, course_ids: list[int | str]) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    for course_id in course_ids:
        snapshots.append(fetch_course_snapshot_by_id(auth, course_id))
    return snapshots


def fetch_all_courses(auth: CanvasAuth) -> list[dict[str, Any]]:
    if not auth.is_valid:
        raise CanvasFetchError('Canvas auth is missing. Log in through Nucleus first.')
    validate_auth(auth)
    courses = fetch_courses(auth)
    snapshots = []
    for course in courses:
        try:
            snapshots.append(fetch_course_snapshot(auth, course))
        except CanvasFetchError as error:
            print(f'Warning: skipping course {course.get("id")}: {error}')
    return snapshots


def save_snapshots(snapshots: list[dict[str, Any]], output_path: str | Path) -> None:
    from pathlib import Path
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshots, indent=2, ensure_ascii=False), encoding='utf-8')


def load_snapshots(input_path: str | Path) -> list[dict[str, Any]]:
    from pathlib import Path
    path = Path(input_path)
    return json.loads(path.read_text(encoding='utf-8'))
