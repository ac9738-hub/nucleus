"""Build weekly schedule using parser graph + weekly-schedule.js bridge."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from canvas_parser.graph.events import normalize_event_type

from .match_utils import names_match


def _week_key(week: dict[str, Any]) -> str:
    return str(week.get('start_date') or week.get('name') or '')


def _parse_graph_date(value: str, default_year: int | None) -> datetime | None:
    from .format import _parse_any_date

    return _parse_any_date(value, default_year=default_year)


def _canonical_event_name(name: str) -> str:
    from .format import _canonical_event_name as canonical

    return canonical(name)


def _format_week_start(value: datetime, default_year: int | None) -> str:
    from .format import _canvas_week_start, format_ground_truth_date

    return format_ground_truth_date(
        _canvas_week_start(value).replace(tzinfo=timezone.utc).isoformat(),
        default_year=default_year,
    )


def _event_already_present(week: dict[str, Any], name: str) -> bool:
    for entry in week.get('events') or []:
        if names_match(name, entry.get('name') or ''):
            return True
    return False


def _undated_event_date_from_snapshot(
    snapshot: dict[str, Any],
    event_name: str,
    default_year: int | None,
) -> datetime | None:
    from canvas_parser.graph.events import build_snapshot_exam_text, extract_syllabus_exam_hints
    from .format import MONTH_DAY_NAME, _parse_any_date

    lowered = str(event_name or '').lower()
    if not lowered:
        return None

    month_day = MONTH_DAY_NAME.search(str(event_name or ''))
    if not month_day and default_year:
        month_only = re.search(
            r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b',
            str(event_name or ''),
            re.IGNORECASE,
        )
        if month_only:
            parsed = _parse_any_date(f'{month_only.group(1)} {month_only.group(2)}', default_year=default_year)
            if parsed:
                return parsed
    elif month_day and default_year:
        parsed = _parse_any_date(month_day.group(0), default_year=default_year)
        if parsed:
            return parsed

    for hint in extract_syllabus_exam_hints(build_snapshot_exam_text(snapshot)):
        label = str(hint.get('label') or hint.get('name') or '').lower()
        if not label:
            continue
        if label in lowered or lowered in label or (lowered == 'midterm' and 'midterm' in label):
            parsed = _parse_any_date(hint.get('date_text') or '', default_year=default_year)
            if parsed:
                return parsed

    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').strip()
        if not name:
            continue
        if not (names_match(event_name, name) or name.lower() == lowered):
            continue
        due = assignment.get('due_at') or ''
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            return parsed
        assignment_id = str(assignment.get('id') or '')
        for module in snapshot.get('modules') or []:
            module_name = str(module.get('name') or '')
            items = (snapshot.get('module_items') or {}).get(str(module.get('id') or '')) or []
            for item in items:
                if str(item.get('content_id') or '') != assignment_id:
                    continue
                parsed = _parse_any_date(module_name, default_year=default_year)
                if parsed:
                    return parsed
    return None


def enrich_weekly_with_graph(
    weekly: list[dict[str, Any]],
    snapshot: dict[str, Any],
    graph: dict[str, Any],
) -> list[dict[str, Any]]:
    """Add dated test events from parser graph into an existing weekly schedule."""
    if not weekly or not graph:
        return weekly

    from .format import _infer_default_year

    default_year = _infer_default_year(snapshot)
    course_id = str((snapshot.get('course') or {}).get('id') or '')
    if not course_id:
        return weekly

    week_by_start = {_week_key(week): week for week in weekly if _week_key(week)}
    candidates: list[dict[str, str]] = []

    for event in graph.get('events') or []:
        if str(event.get('courseid') or '') not in {course_id, str(course_id)}:
            continue
        name = str(event.get('name') or '').strip()
        if not name:
            continue
        event_type = normalize_event_type(event.get('type') or '', name)
        if event_type not in {'test', 'review', 'lecture', 'lab', 'presentation', 'deadline', 'other'}:
            continue
        if event_type == 'other' and '小考' not in name:
            continue
        date_text = event.get('startdate') or event.get('enddate') or ''
        candidates.append({
            'name': _canonical_event_name(name),
            'date': date_text,
        })

    syllabi = graph.get('syllabi') or {}
    syllabus = syllabi.get(course_id) or syllabi.get(int(course_id) if course_id.isdigit() else course_id) or {}
    for logged in syllabus.get('logged_events') or graph.get('logged_events', {}).get(course_id) or []:
        if isinstance(logged, dict):
            name = str(logged.get('eventname') or logged.get('name') or '').strip()
            date_text = logged.get('startdate') or logged.get('enddate') or ''
        else:
            name = str(getattr(logged, 'eventname', '') or getattr(logged, 'name', '') or '').strip()
            date_text = getattr(logged, 'startdate', '') or getattr(logged, 'enddate', '') or ''
        if name:
            candidates.append({'name': _canonical_event_name(name), 'date': str(date_text or '')})

    for candidate in candidates:
        parsed = _parse_graph_date(candidate.get('date') or '', default_year)
        if not parsed:
            parsed = _undated_event_date_from_snapshot(snapshot, candidate.get('name') or '', default_year)
        if not parsed:
            continue
        week_start = _format_week_start(parsed, default_year)
        week = week_by_start.get(week_start)
        if not week:
            continue
        name = candidate.get('name') or ''
        if not name or _event_already_present(week, name):
            continue
        week.setdefault('events', []).append({'name': name, 'files': []})

    return weekly
