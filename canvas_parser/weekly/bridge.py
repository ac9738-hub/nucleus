"""Bridge Canvas app data (canvas_data.json shape) to weekly_iteration formatters."""

from __future__ import annotations

from typing import Any

from canvas_parser.weekly_iteration.format import format_course_snapshot


def _course_bucket(canvas_data: dict[str, Any], bucket_name: str, course_id: str) -> Any:
    bucket = canvas_data.get(bucket_name) or {}
    if not isinstance(bucket, dict):
        return [] if bucket_name != 'module_items' else {}
    value = bucket.get(course_id) or bucket.get(str(course_id))
    if bucket_name == 'module_items':
        return value if isinstance(value, dict) else {}
    return value if isinstance(value, list) else []


def _normalize_module_items(module_items: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    normalized: dict[str, list[dict[str, Any]]] = {}
    for module_id, items in (module_items or {}).items():
        if isinstance(items, list):
            normalized[str(module_id)] = items
    return normalized


def _page_body_index(pages: list[dict[str, Any]]) -> dict[str, str]:
    index: dict[str, str] = {}
    for page in pages or []:
        body = str(page.get('body') or '')
        if not body:
            continue
        for key in (page.get('url'), page.get('page_id'), page.get('html_url')):
            text = str(key or '').strip().lower()
            if text:
                index[text] = body
                if '/' in text:
                    index[text.rsplit('/', 1)[-1]] = body
    return index


def _build_page_bodies(
    pages: list[dict[str, Any]],
    module_items: dict[str, list[dict[str, Any]]],
) -> dict[str, str]:
    index = _page_body_index(pages)
    bodies: dict[str, str] = {}
    seen: set[str] = set()
    for items in module_items.values():
        for item in items:
            if str(item.get('type') or '').lower() != 'page':
                continue
            api_url = str(item.get('url') or '').strip()
            if not api_url or api_url in seen:
                continue
            seen.add(api_url)
            body = ''
            for candidate in (
                api_url,
                item.get('page_url'),
                api_url.rsplit('/', 1)[-1],
            ):
                body = index.get(str(candidate or '').strip().lower(), '')
                if body:
                    break
            if body:
                bodies[api_url] = body
    return bodies


def _merge_syllabus(course: dict[str, Any], canvas_data: dict[str, Any], course_id: str) -> dict[str, Any]:
    merged = dict(course)
    syllabi = canvas_data.get('syllabi') or {}
    syllabus = syllabi.get(course_id) or syllabi.get(str(course_id)) or {}
    if isinstance(syllabus, dict):
        if syllabus.get('syllabus_body') and not merged.get('syllabus_body'):
            merged['syllabus_body'] = syllabus.get('syllabus_body') or ''
        if syllabus.get('name') and not merged.get('name'):
            merged['name'] = syllabus.get('name') or merged.get('name')
    return merged


def canvas_data_to_snapshot(course: dict[str, Any], canvas_data: dict[str, Any]) -> dict[str, Any]:
    """Convert one course from main-app canvas_data into weekly_iteration snapshot shape."""
    course_id = str(course.get('id') or '')
    module_items = _normalize_module_items(_course_bucket(canvas_data, 'module_items', course_id))
    pages = _course_bucket(canvas_data, 'pages', course_id)
    return {
        'course': _merge_syllabus(course, canvas_data, course_id),
        'assignments': _course_bucket(canvas_data, 'assignments', course_id),
        'files': _course_bucket(canvas_data, 'file', course_id),
        'modules': _course_bucket(canvas_data, 'modules', course_id),
        'module_items': module_items,
        'pages': pages,
        'page_bodies': _build_page_bodies(pages, module_items),
    }


def build_weekly_schedules(
    canvas_data: dict[str, Any],
    graph: dict[str, Any] | None = None,
    *,
    use_graph: bool = True,
) -> dict[str, list[dict[str, Any]]]:
    """Build per-course weekly schedules using weekly_iteration heuristics + optional graph enrichment."""
    schedules: dict[str, list[dict[str, Any]]] = {}
    courses = canvas_data.get('courses') or []
    if not isinstance(courses, list):
        return schedules

    graph_payload = graph if use_graph else None
    for course in courses:
        if not isinstance(course, dict) or not course.get('id'):
            continue
        course_id = str(course['id'])
        snapshot = canvas_data_to_snapshot(course, canvas_data)
        parsed = format_course_snapshot(
            snapshot,
            graph=graph_payload,
            use_llm_weekly=bool(use_graph and graph_payload),
        )
        weekly = parsed.get('weekly_schedule') or []
        if weekly:
            schedules[course_id] = weekly
    return schedules
