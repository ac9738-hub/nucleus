"""Build weekly-iteration snapshots for Harvard GT courses from canvas_data.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARVARD_COURSE_IDS = (143716, 161543, 161797, 160377)


def _course_record(data: dict, course_id: int) -> dict:
    for course in data.get('courses') or []:
        if int(course.get('id') or 0) == course_id:
            return dict(course)
    for course in (data.get('course_details') or {}).values():
        if int(course.get('id') or 0) == course_id:
            return dict(course)
    for course in data.get('courseDetails') or []:
        if int(course.get('id') or 0) == course_id:
            return dict(course)
    return {'id': course_id}


def _bucket(data: dict, key: str, course_id: int) -> list:
    bucket = (data.get(key) or {}).get(str(course_id))
    return list(bucket or [])


def _files(data: dict, course_id: int) -> list:
    for key in ('files', 'file'):
        bucket = _bucket(data, key, course_id)
        if bucket:
            return bucket
    return []


def _module_items(data: dict, course_id: int) -> dict[str, list]:
    raw = (data.get('module_items') or {}).get(str(course_id)) or {}
    if not isinstance(raw, dict):
        return {}
    return {str(module_id): list(items or []) for module_id, items in raw.items()}


def _page_key_values(page: dict) -> set[str]:
    keys: set[str] = set()
    for key in (page.get('url'), page.get('page_id'), page.get('html_url')):
        text = str(key or '').strip()
        if not text:
            continue
        keys.add(text.lower())
        if '/' in text:
            keys.add(text.rstrip('/').rsplit('/', 1)[-1].lower())
    return keys


def _front_page(data: dict, course_id: int) -> dict | None:
    raw = data.get('front_pages') or {}
    if not isinstance(raw, dict):
        return None
    page = raw.get(str(course_id)) or raw.get(course_id)
    return page if isinstance(page, dict) else None


def _append_front_page(pages: list[dict], front_page: dict | None) -> list[dict]:
    if not front_page or not front_page.get('body'):
        return pages
    merged = list(pages or [])
    existing_keys: set[str] = set()
    for page in merged:
        existing_keys.update(_page_key_values(page))
    front_keys = _page_key_values(front_page)
    if front_keys and existing_keys.intersection(front_keys):
        return merged
    merged.append(dict(front_page))
    return merged


def build_snapshot(data: dict, course_id: int) -> dict:
    course = _course_record(data, course_id)
    course_key = str(course_id)
    course_details = (data.get('course_details') or {}).get(course_key) or {}
    if isinstance(course_details, dict):
        for field in ('syllabus_body', 'syllabus_text', 'name', 'course_code', 'term', 'start_at', 'end_at'):
            if course_details.get(field) and not course.get(field):
                course[field] = course_details[field]
    modules = sorted(_bucket(data, 'modules', course_id), key=lambda row: row.get('position') or 0)
    pages = _append_front_page(_bucket(data, 'pages', course_id), _front_page(data, course_id))
    page_bodies: dict[str, str] = {}
    for page in pages:
        body = page.get('body') or ''
        if not body:
            continue
        for key in _page_key_values(page):
            page_bodies[key] = body
    files = _files(data, course_id)
    module_items = _module_items(data, course_id)
    files = _synthesize_files_from_module_items(files, module_items)
    return {
        'course': course,
        'assignments': _bucket(data, 'assignments', course_id),
        'files': files,
        'pages': pages,
        'modules': modules,
        'module_items': module_items,
        'page_bodies': page_bodies,
    }


def _synthesize_files_from_module_items(
    files: list[dict],
    module_items: dict[str, list],
) -> list[dict]:
    merged = list(files or [])
    seen = {str(row.get('id')) for row in merged if row.get('id') is not None}
    for items in module_items.values():
        for item in items:
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
            })
            seen.add(file_id)
    return merged


def main() -> int:
    source = ROOT / 'canvas_data.json'
    if not source.is_file():
        print(f'Missing {source}', file=sys.stderr)
        return 1
    data = json.loads(source.read_text(encoding='utf-8'))
    snapshots = [build_snapshot(data, course_id) for course_id in HARVARD_COURSE_IDS]
    out = ROOT / '.cache' / 'weekly_iteration' / 'snapshots_harvard.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshots, ensure_ascii=False), encoding='utf-8')
    for snapshot in snapshots:
        course = snapshot.get('course') or {}
        print(
            f'  {course.get("id")} {course.get("course_code")}: '
            f'{len(snapshot.get("assignments") or [])} assignments, '
            f'{len(snapshot.get("files") or [])} files, '
            f'{len(snapshot.get("modules") or [])} modules'
        )
    print(f'Wrote {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
