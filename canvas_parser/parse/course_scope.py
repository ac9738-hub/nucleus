"""Course scope helpers for bulk parse runs."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

PRINCETON_ROOT_ACCOUNT_ID = 1


def is_princeton_course(course: dict[str, Any]) -> bool:
    """True for courses on the main Princeton Canvas account."""
    root = course.get('root_account_id')
    if root is not None:
        return int(root) == PRINCETON_ROOT_ACCOUNT_ID
    html_url = str(course.get('html_url') or '')
    return 'princeton.instructure.com' in html_url


def filter_course_records(
    courses: Iterable[dict[str, Any]],
    *,
    princeton_only: bool = False,
    course_ids: Iterable[int | str] | None = None,
) -> list[dict[str, Any]]:
    rows = [course for course in courses if course.get('id')]
    if princeton_only:
        rows = [course for course in rows if is_princeton_course(course)]
    if course_ids:
        allowed = {str(course_id) for course_id in course_ids}
        rows = [course for course in rows if str(course.get('id')) in allowed]
    return rows


def load_canvas_data(root: Path) -> dict[str, Any]:
    path = root / 'canvas_data.json'
    return json.loads(path.read_text(encoding='utf-8'))


def princeton_course_ids(root: Path) -> list[int]:
    data = load_canvas_data(root)
    return [int(course['id']) for course in filter_course_records(data.get('courses') or [], princeton_only=True)]


def summarize_batch_scope(batches: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for batch in batches:
        batch_type = str(batch.get('type') or 'unknown')
        counts[batch_type] = counts.get(batch_type, 0) + len(batch.get('content') or [])
    counts['total'] = sum(counts.values())
    return counts
