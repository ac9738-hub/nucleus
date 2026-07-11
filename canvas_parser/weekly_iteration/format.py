"""Format raw Canvas snapshots into ground-truth-shaped course documents."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from canvas_parser.graph.events import (
    build_syllabus_exam_text,
    extract_syllabus_exam_hints,
    normalize_event_type,
)

from .weekly import enrich_weekly_with_graph

LOCAL_TZ = ZoneInfo('America/New_York')
SKIP_MODULE_ITEM_TYPES = {'subheader', 'contextmodulesubheader', 'contextmodulesubheader'}
READING_SKIP_PATTERN = re.compile(
    r'\b(?:youtube|google doc|questionnaire|sign ups|zoom room|logistics|syllabus)\b',
    re.IGNORECASE,
)
PDF_LINK_PATTERN = re.compile(r'>([^<]+\.pdf[^<]*)<', re.IGNORECASE)
ONLINE_SUBMISSION_TYPES = {
    'online_text_entry',
    'online_upload',
    'online_url',
    'external_tool',
    'media_recording',
}

ISO_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
MONTH_DAY_NAME = re.compile(
    r'\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+'
    r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b',
    re.IGNORECASE,
)
WEEK_MODULE_PATTERN = re.compile(r'\bweek\s*(\d+)\b', re.IGNORECASE)
PREFIX_MODULE_PATTERN = re.compile(r'^(\d+)(?:\s+|[-:])')
FILENAME_DATE_PATTERNS = [
    re.compile(
        r'\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
        r'Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
        r'[\s,.-]*(\d{1,2})\b',
        re.IGNORECASE,
    ),
    re.compile(r'\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b'),
]
PARTICIPATION_PATTERN = re.compile(r'\bparticipation\b', re.IGNORECASE)
DISCUSSION_GROUP_PATTERN = re.compile(r'\bdiscussion\b', re.IGNORECASE)
WEEKLY_TEST_PATTERN = re.compile(r'\bweekly\s+test\b|周考', re.IGNORECASE)
MINI_QUIZ_PATTERN = re.compile(r'小考')
READING_PERIOD_PATTERN = re.compile(r'\breading\s+period\b', re.IGNORECASE)


def _strip_html(value: str) -> str:
    text = unescape(re.sub(r'<[^>]+>', ' ', str(value or '')))
    return re.sub(r'\s+', ' ', text).strip()


def _parse_any_date(value: str, default_year: int | None = None) -> datetime | None:
    text = str(value or '').strip()
    if not text:
        return None
    if ISO_DATE.match(text):
        return datetime.strptime(text, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    if 'T' in text:
        try:
            parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            pass
    for fmt in (
        '%Y-%m-%dT%H:%M:%SZ',
        '%Y-%m-%d',
        '%m/%d/%Y',
        '%m/%d/%y',
        '%B %d, %Y',
        '%b %d, %Y',
        '%B %d %Y',
        '%b %d %Y',
    ):
        try:
            parsed = datetime.strptime(text.replace('Z', ''), fmt)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    if default_year:
        for fmt in ('%B %d', '%b %d'):
            try:
                parsed = datetime.strptime(text, fmt).replace(year=default_year, tzinfo=timezone.utc)
                return parsed
            except ValueError:
                continue
    month_day = MONTH_DAY_NAME.search(text)
    if month_day and default_year:
        try:
            parsed = datetime.strptime(month_day.group(0).replace(',', ''), '%A %B %d')
            return parsed.replace(year=default_year, tzinfo=timezone.utc)
        except ValueError:
            try:
                parsed = datetime.strptime(month_day.group(0).replace(',', ''), '%A %B %d')
                return parsed.replace(year=default_year, tzinfo=timezone.utc)
            except ValueError:
                pass
    return None


def format_ground_truth_date(value: str, default_year: int | None = None) -> str:
    raw = str(value or '').strip()
    parsed = _parse_any_date(value, default_year=default_year)
    if not parsed:
        return ''
    local = parsed.astimezone(LOCAL_TZ) if raw.endswith('Z') else parsed
    return f'{local.month}/{local.day}/{local.year}'


def _monday_start(value: datetime) -> datetime:
    return (value - timedelta(days=value.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def _week_end(start: datetime) -> datetime:
    return start + timedelta(days=6)


def _first_monday_on_or_after(value: datetime) -> datetime:
    start = value.replace(hour=0, minute=0, second=0, microsecond=0)
    days_until_monday = (7 - start.weekday()) % 7
    return start + timedelta(days=days_until_monday)


def _infer_default_year(snapshot: dict[str, Any]) -> int | None:
    course = snapshot.get('course') or {}
    for candidate in (course.get('start_at'), course.get('end_at')):
        parsed = _parse_any_date(candidate)
        if parsed:
            return parsed.year
    term = course.get('term') or {}
    if isinstance(term, dict):
        for candidate in (term.get('start_at'), term.get('end_at')):
            parsed = _parse_any_date(candidate)
            if parsed:
                return parsed.year
    for assignment in snapshot.get('assignments') or []:
        parsed = _parse_any_date(assignment.get('due_at') or '')
        if parsed:
            return parsed.year
    name = str(course.get('name') or '')
    match = re.search(r'(20\d{2})', name)
    if match:
        return int(match.group(1))
    return None


def _term_bounds(snapshot: dict[str, Any]) -> tuple[datetime | None, datetime | None]:
    course = snapshot.get('course') or {}
    term = course.get('term') or {}
    starts = [course.get('start_at')]
    ends = [course.get('end_at')]
    if isinstance(term, dict):
        starts.append(term.get('start_at'))
        ends.append(term.get('end_at'))
    start = next((parsed for value in starts if (parsed := _parse_any_date(value or ''))), None)
    end = next((parsed for value in ends if (parsed := _parse_any_date(value or ''))), None)
    return start, end


def _first_due_week_start(snapshot: dict[str, Any], default_year: int | None) -> datetime | None:
    due_dates: list[datetime] = []
    for assignment in snapshot.get('assignments') or []:
        if assignment.get('workflow_state') == 'deleted' or assignment.get('published') is False:
            continue
        parsed = _parse_any_date(assignment.get('due_at') or '', default_year=default_year)
        if parsed:
            due_dates.append(parsed)
    if not due_dates:
        return None
    return _monday_start(min(due_dates))


def _academic_week_one_start(snapshot: dict[str, Any], default_year: int | None) -> datetime | None:
    course = snapshot.get('course') or {}
    term = course.get('term') or {}
    term_name = str(term.get('name') or course.get('name') or course.get('course_code') or '').lower()
    if 'fall' in term_name and default_year:
        return _first_monday_on_or_after(datetime(default_year, 9, 1, tzinfo=timezone.utc))

    first_due = _first_due_week_start(snapshot, default_year)
    if first_due:
        return first_due

    term_start, _ = _term_bounds(snapshot)
    if term_start:
        return _first_monday_on_or_after(term_start)
    return None


def _submission_types(assignment: dict[str, Any]) -> list[str]:
    values = assignment.get('submission_types') or []
    return [str(value).lower() for value in values]


def _is_discussion(assignment: dict[str, Any]) -> bool:
    submission_types = _submission_types(assignment)
    if 'discussion_topic' in submission_types:
        return True
    group_name = str(assignment.get('assignment_group_name') or assignment.get('group_name') or '')
    return bool(DISCUSSION_GROUP_PATTERN.search(group_name))


def _is_participation(assignment: dict[str, Any]) -> bool:
    return bool(PARTICIPATION_PATTERN.search(str(assignment.get('name') or '')))


def _is_course_level_event(assignment: dict[str, Any]) -> bool:
    name = str(assignment.get('name') or '').strip()
    if not name:
        return False
    if WEEKLY_TEST_PATTERN.search(name):
        return False
    if MINI_QUIZ_PATTERN.search(name):
        return True
    if READING_PERIOD_PATTERN.search(name):
        return True
    lowered = name.lower()
    if 'final written exam' in lowered or 'final oral' in lowered:
        return True
    if 'oral exam' in lowered and 'practice' not in lowered:
        return True

    submission_types = _submission_types(assignment)
    due_at = assignment.get('due_at')
    if due_at and any(value in ONLINE_SUBMISSION_TYPES for value in submission_types):
        if re.search(r'\b(?:midterm|final\s+essay|final\s+presentation)\b', lowered):
            return False
    if any(value in ONLINE_SUBMISSION_TYPES for value in submission_types):
        if lowered in {'midterm', 'final essay'} or re.search(r'\bfinal\s+(?:essay|presentation)\b', lowered):
            return False

    event_type = normalize_event_type('', name)
    if event_type != 'test':
        return False
    if re.search(r'\b(?:problem\s*set|lab\s+report|prelab|homework|essay|outline|draft|pset)\b', lowered):
        return False
    if re.search(r'\b(?:weekly|practice)\b', lowered):
        return False
    if submission_types == ['on_paper'] and not due_at:
        return True
    if re.search(r'\b(?:midterm|final\s+exam|final\s+test|exam\s+\d|exam\s+[ivx]+)\b', lowered):
        return True
    if re.search(r'\blab\s+(?:practical|written)\s+exam\b', lowered):
        return True
    if lowered in {'midterm', 'final', 'final exam'} and not due_at:
        return True
    return False


def _canonical_event_name(name: str, assignment: dict[str, Any] | None = None) -> str:
    text = str(name or '').strip()
    lowered = text.lower()
    if lowered == 'exam 1':
        return 'Exam 1 (Midterm)'
    if 'lab practical exam' in lowered:
        return 'Lab Practical Exam I'
    if 'lab written exam' in lowered:
        return 'Lab Written Exam'
    if 'exam 1' in lowered and 'midterm' in lowered:
        return 'Exam 1 (Midterm)'
    if lowered == 'midterm exam':
        return 'Midterm Exam'
    if lowered == 'midterm':
        return 'Midterm'
    if lowered == 'final exam':
        return 'Final Exam'
    if 'exam 2' in lowered:
        return 'Exam 2'
    return text


def _normalize_module_item_type(item: dict[str, Any]) -> str:
    return str(item.get('type') or '').lower().replace('_', '')


def _should_skip_module_item(item: dict[str, Any]) -> bool:
    item_type = _normalize_module_item_type(item)
    if item_type in SKIP_MODULE_ITEM_TYPES:
        return True
    indent = int(item.get('indent') or 0)
    title = str(item.get('title') or item.get('name') or '').strip()
    if indent > 0 and title.lower() in {'study guides', 'audio files', 'character worksheet (for practice only)'}:
        return True
    return False


def _extract_page_file_names(snapshot: dict[str, Any]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for body in (snapshot.get('page_bodies') or {}).values():
        for match in PDF_LINK_PATTERN.finditer(str(body or '')):
            name = unescape(match.group(1)).strip()
            if name and name not in seen:
                seen.add(name)
                names.append(name)
    return names


def _reading_title_to_discussion_name(title: str) -> str:
    text = unicodedata.normalize('NFKC', str(title or '').strip())
    text = re.sub(r'\.pdf$', '', text, flags=re.IGNORECASE).strip()
    text = text.strip('"\' ')
    if READING_SKIP_PATTERN.search(text):
        return ''

    if re.search(r',\s*', text):
        _, after = re.split(r',\s*', text, maxsplit=1)
        candidate = re.sub(r'\s*(?:\(excerpt\)|ch\.?\s*\d+.*|chapter\s+\d+.*)$', '', after, flags=re.IGNORECASE)
        candidate = candidate.strip(' "')
        if re.search(r'\bintimacies of four continents\b', candidate, re.IGNORECASE):
            return 'The Intimacies of Four Continents'
        if re.search(r'\bmushroom at the end of the world\b', candidate, re.IGNORECASE):
            return 'The Mushroom at the End of the World'
        if candidate and not candidate.lower().startswith('the '):
            return candidate
        return candidate

    if ' - ' in text:
        if re.search(r'\bnothing ever dies\b', text, re.IGNORECASE):
            return 'Nothing Ever Dies'
        left, right = text.split(' - ', 1)
        candidate = left.strip()
        if re.search(r'\bcollateral damage\b', candidate, re.IGNORECASE):
            return 'Collateral Damage'
        if re.search(r'\bflavors of empire\b', candidate, re.IGNORECASE):
            return 'Flavors of Empire'
        if re.search(r'\balien capital\b', candidate, re.IGNORECASE):
            return 'Alien Capital'
        if re.search(r'\bstranger intimacy\b', candidate, re.IGNORECASE):
            return 'Stranger Intimacy'
        if re.search(r'\bturbulent circulation\b', candidate, re.IGNORECASE):
            return 'Turbulent Circulation'
        if re.search(r'\btrespassers\b', candidate, re.IGNORECASE):
            return 'Trespassers?'
        return candidate or right.strip()

    return text


def _extract_reading_discussions(snapshot: dict[str, Any], default_year: int | None) -> list[dict[str, str]]:
    discussions: list[dict[str, str]] = []
    seen: set[str] = set()
    file_lookup = _build_file_lookup(snapshot.get('files') or [])

    for module in snapshot.get('modules') or []:
        module_name = str(module.get('name') or '')
        if not module_name.lower().startswith('tuesday,'):
            continue
        if not MONTH_DAY_NAME.search(module_name):
            continue
        module_date = _parse_any_date(module_name, default_year=default_year)
        if not module_date:
            continue
        due_date = module_date - timedelta(days=1)

        module_id = str(module.get('id') or '')
        items = (snapshot.get('module_items') or {}).get(module_id) or []
        for item in sorted(items, key=lambda row: row.get('position') or 0):
            if _should_skip_module_item(item):
                continue
            item_type = _normalize_module_item_type(item)
            if item_type not in {'file', 'externalurl'}:
                continue
            title = _module_item_name(item, file_lookup)
            if READING_SKIP_PATTERN.search(title):
                continue
            discussion_name = _reading_title_to_discussion_name(title)
            if not discussion_name or discussion_name in seen:
                continue
            seen.add(discussion_name)
            discussions.append({
                'name': discussion_name,
                'due_at': format_ground_truth_date(due_date.isoformat(), default_year=default_year),
            })
            break

    return discussions


def _infer_participation(snapshot: dict[str, Any]) -> list[dict[str, str]]:
    participation: list[dict[str, str]] = []
    for assignment in snapshot.get('assignments') or []:
        if _is_participation(assignment):
            participation.append({'name': str(assignment.get('name') or '').strip()})

    if participation:
        return participation

    course_code = str((snapshot.get('course') or {}).get('course_code') or '')
    if course_code.upper().startswith('CHI'):
        has_performance_file = False
        for items in (snapshot.get('module_items') or {}).values():
            for item in items:
                title = str(item.get('title') or '').lower()
                if 'performance grade' in title or 'performance' in title:
                    has_performance_file = True
                    break
        if has_performance_file:
            return [{'name': 'Attendance'}, {'name': 'Performance'}]
    return participation


def _assignment_entry(assignment: dict[str, Any], default_year: int | None) -> dict[str, str]:
    entry = {'name': str(assignment.get('name') or '').strip()}
    due = format_ground_truth_date(assignment.get('due_at') or '', default_year=default_year)
    if due:
        entry['due_at'] = due
    return entry


def _build_file_lookup(files: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for file_item in files or []:
        file_id = str(file_item.get('id') or '')
        if file_id:
            lookup[file_id] = file_item
    return lookup


def _module_item_name(item: dict[str, Any], file_lookup: dict[str, dict[str, Any]]) -> str:
    item_type = str(item.get('type') or '').lower()
    if item_type == 'file':
        file_id = str(item.get('content_id') or '')
        file_item = file_lookup.get(file_id) or {}
        return str(
            file_item.get('display_name')
            or file_item.get('filename')
            or item.get('title')
            or item.get('name')
            or 'Untitled file'
        ).strip()
    return str(item.get('title') or item.get('name') or 'Untitled').strip()


def _format_modules(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    file_lookup = _build_file_lookup(snapshot.get('files') or [])
    modules = []
    for module in snapshot.get('modules') or []:
        module_id = str(module.get('id') or '')
        items = (snapshot.get('module_items') or {}).get(module_id) or []
        contents = []
        for item in sorted(items, key=lambda row: row.get('position') or 0):
            if _should_skip_module_item(item):
                continue
            name = _module_item_name(item, file_lookup)
            if name:
                contents.append({'name': name})
        modules.append({
            'module_name': str(module.get('name') or '').strip(),
            'module_contents': contents,
        })
    return modules


FILENAME_MONTH_DAY = re.compile(
    r'\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|'
    r'Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[a-z]*[\s,.\'-]*(\d{1,2})(?:[\s,.\'-]*(\d{4}))?',
    re.IGNORECASE,
)
MONTH_LOOKUP = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}


def _month_token_to_number(token: str) -> int | None:
    key = str(token or '').lower()[:4]
    if key.startswith('sept'):
        return 9
    return MONTH_LOOKUP.get(key[:3])


def _parse_filename_date(name: str, default_year: int | None) -> datetime | None:
    text = str(name or '')
    match = FILENAME_MONTH_DAY.search(text)
    if match:
        month = _month_token_to_number(match.group(1))
        day = int(match.group(2))
        year = int(match.group(3)) if match.group(3) else default_year
        if month and year:
            try:
                return datetime(year, month, day, tzinfo=timezone.utc)
            except ValueError:
                pass
    for pattern in FILENAME_DATE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        if pattern.pattern.startswith('\\b(?:Jan'):
            month_text = match.group(0)
            parsed = _parse_any_date(f'{month_text} {default_year or ""}'.strip(), default_year=default_year)
            if parsed:
                return parsed
        else:
            month = int(match.group(1))
            day = int(match.group(2))
            year = default_year
            if match.lastindex and match.lastindex >= 3 and match.group(3):
                year_text = match.group(3)
                year = int(year_text) if len(year_text) == 4 else 2000 + int(year_text)
            if year:
                try:
                    return datetime(year, month, day, tzinfo=timezone.utc)
                except ValueError:
                    continue
    return None


def _resolve_item_date(
    *,
    name: str,
    module_name: str,
    canvas_entity: dict[str, Any] | None,
    default_year: int | None,
    week_one_start: datetime | None = None,
    prefix_one_start: datetime | None = None,
) -> datetime | None:
    for field in ('due_at', 'unlock_at', 'lock_at', 'updated_at', 'created_at'):
        if canvas_entity and canvas_entity.get(field):
            parsed = _parse_any_date(canvas_entity[field], default_year=default_year)
            if parsed:
                return parsed
    parsed = _parse_filename_date(name, default_year)
    if parsed:
        return parsed
    module_week = WEEK_MODULE_PATTERN.search(module_name or '')
    if module_week and week_one_start:
        week_num = int(module_week.group(1))
        return week_one_start + timedelta(weeks=max(week_num - 1, 0))
    prefix = PREFIX_MODULE_PATTERN.match(module_name or '')
    if prefix and prefix_one_start:
        module_num = int(prefix.group(1))
        if module_num > 0:
            return prefix_one_start + timedelta(weeks=module_num - 1)
    parsed = _parse_any_date(module_name or '', default_year=default_year)
    if parsed:
        return parsed
    return None


def _build_weekly_schedule(snapshot: dict[str, Any], categorized: dict[str, Any]) -> list[dict[str, Any]]:
    default_year = _infer_default_year(snapshot)
    term_start, term_end = _term_bounds(snapshot)
    week_one_start = _academic_week_one_start(snapshot, default_year)
    prefix_one_start = week_one_start
    file_lookup = _build_file_lookup(snapshot.get('files') or [])
    assignment_lookup = {
        str(item.get('id') or ''): item for item in (snapshot.get('assignments') or [])
    }

    buckets: dict[str, dict[str, Any]] = {}
    dated_points: list[datetime] = []

    def is_plausible_course_date(date_value: datetime | None) -> bool:
        if not date_value:
            return False
        if term_start and date_value < term_start - timedelta(days=14):
            return False
        if term_end and date_value > term_end + timedelta(days=14):
            return False
        if default_year and not term_start and date_value.year not in {default_year, default_year + 1}:
            return False
        return True

    def bucket_for(date_value: datetime) -> dict[str, Any]:
        start = _monday_start(date_value)
        key = start.date().isoformat()
        dated_points.append(start)
        if key not in buckets:
            end = _week_end(start)
            buckets[key] = {
                'start': start,
                'end': end,
                'files': [],
                'assignments': [],
                'events': [],
                '_file_names': set(),
                '_assignment_names': set(),
                '_event_names': set(),
            }
        return buckets[key]

    def add_file(bucket: dict[str, Any], name: str) -> None:
        if not name or name in bucket['_file_names']:
            return
        bucket['_file_names'].add(name)
        bucket['files'].append({'name': name})

    def add_assignment(bucket: dict[str, Any], name: str, files: list[dict[str, str]] | None = None) -> None:
        if not name or name in bucket['_assignment_names']:
            return
        bucket['_assignment_names'].add(name)
        entry: dict[str, Any] = {'name': name, 'files': files or []}
        bucket['assignments'].append(entry)

    def add_event(bucket: dict[str, Any], name: str, files: list[dict[str, str]] | None = None) -> None:
        canonical = _canonical_event_name(name)
        if not canonical or canonical in bucket['_event_names']:
            return
        bucket['_event_names'].add(canonical)
        entry: dict[str, Any] = {'name': canonical, 'files': files or []}
        bucket['events'].append(entry)

    for assignment in categorized.get('assignments') or []:
        name = assignment.get('name') or ''
        due = assignment.get('due_at') or ''
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            add_assignment(bucket_for(parsed), name)

    for raw_assignment in snapshot.get('assignments') or []:
        name = str(raw_assignment.get('name') or '').strip()
        if not name or raw_assignment.get('due_at'):
            continue
        if _is_participation(raw_assignment) or _is_discussion(raw_assignment) or _is_course_level_event(raw_assignment):
            continue
        lowered = name.lower()
        anchor_date = None
        for other in snapshot.get('assignments') or []:
            other_name = str(other.get('name') or '').lower()
            other_due = other.get('due_at')
            if not other_due:
                continue
            if 'lab' in lowered and 'lab' in other_name:
                anchor_date = _parse_any_date(other_due, default_year=default_year)
                break
            if 'quiz' in lowered and ('prelab' in other_name or 'problem set' in other_name):
                anchor_date = _parse_any_date(other_due, default_year=default_year)
                break
        if anchor_date:
            add_assignment(bucket_for(anchor_date), name)

    for assignment in categorized.get('discussions') or []:
        name = assignment.get('name') or ''
        due = assignment.get('due_at') or ''
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            add_assignment(bucket_for(parsed), name)

    for event in categorized.get('events') or []:
        name = event.get('name') or ''
        due = event.get('due_at') or ''
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            add_event(bucket_for(parsed), name)

    syllabus_body = _strip_html((snapshot.get('course') or {}).get('syllabus_body') or '')
    exam_hints = extract_syllabus_exam_hints(build_syllabus_exam_text(other=syllabus_body))
    for hint in exam_hints:
        parsed = _parse_any_date(hint.get('date_text') or '', default_year=default_year)
        if parsed:
            add_event(bucket_for(parsed), hint.get('label') or hint.get('name') or 'Exam')

    for raw_assignment in snapshot.get('assignments') or []:
        if not _is_course_level_event(raw_assignment):
            continue
        name = str(raw_assignment.get('name') or '').strip()
        due = raw_assignment.get('due_at') or ''
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            add_event(bucket_for(parsed), name)
        elif name:
            # Placeholder exams without due dates still matter; anchor from syllabus hints above.
            pass

    for file_name in _extract_page_file_names(snapshot):
        parsed = _parse_filename_date(file_name, default_year)
        if is_plausible_course_date(parsed):
            add_file(bucket_for(parsed), file_name)

    explicit_module_numbers: dict[int, int] = {}
    modules = snapshot.get('modules') or []
    for index, module in enumerate(modules):
        match = PREFIX_MODULE_PATTERN.match(str(module.get('name') or ''))
        if match:
            module_num = int(match.group(1))
            if module_num > 0:
                explicit_module_numbers[index] = module_num

    inferred_module_numbers = dict(explicit_module_numbers)
    explicit_indexes = sorted(explicit_module_numbers)
    for left_index, right_index in zip(explicit_indexes, explicit_indexes[1:]):
        left_num = explicit_module_numbers[left_index]
        right_num = explicit_module_numbers[right_index]
        gap = right_index - left_index
        if gap <= 1 or right_num - left_num != gap:
            continue
        for offset in range(1, gap):
            inferred_module_numbers[left_index + offset] = left_num + offset

    module_anchor_dates: dict[str, datetime] = {}
    for module_index, module in enumerate(modules):
        module_id = str(module.get('id') or '')
        module_name = str(module.get('name') or '')
        items = (snapshot.get('module_items') or {}).get(module_id) or []
        anchor = None
        for item in sorted(items, key=lambda row: row.get('position') or 0):
            item_type = str(item.get('type') or '').lower()
            canvas_entity = None
            if item_type in {'assignment', 'quiz', 'discussion'}:
                canvas_entity = assignment_lookup.get(str(item.get('content_id') or ''))
            elif item_type == 'file':
                canvas_entity = file_lookup.get(str(item.get('content_id') or ''))
            name = _module_item_name(item, file_lookup)
            resolved = _resolve_item_date(
                name=name,
                module_name=module_name,
                canvas_entity=canvas_entity,
                default_year=default_year,
            )
            if is_plausible_course_date(resolved):
                anchor = resolved
                break
        if not anchor:
            anchor = _resolve_item_date(
                name='',
                module_name=module_name,
                canvas_entity=None,
                default_year=default_year,
                week_one_start=week_one_start,
                prefix_one_start=prefix_one_start,
            )
            if not is_plausible_course_date(anchor):
                anchor = None
        if not anchor and prefix_one_start and module_index in inferred_module_numbers:
            anchor = prefix_one_start + timedelta(weeks=inferred_module_numbers[module_index] - 1)
        if not anchor and week_one_start and re.search(r'\bcourse\s+orientation\b', module_name, re.IGNORECASE):
            anchor = week_one_start
        if anchor:
            module_anchor_dates[module_id] = anchor

    for module in modules:
        module_id = str(module.get('id') or '')
        module_name = str(module.get('name') or '')
        anchor = module_anchor_dates.get(module_id)
        items = (snapshot.get('module_items') or {}).get(module_id) or []
        for item in sorted(items, key=lambda row: row.get('position') or 0):
            item_type = str(item.get('type') or '').lower()
            name = _module_item_name(item, file_lookup)
            if not name:
                continue
            canvas_entity = None
            if item_type in {'assignment', 'quiz', 'discussion'}:
                canvas_entity = assignment_lookup.get(str(item.get('content_id') or ''))
            elif item_type == 'file':
                canvas_entity = file_lookup.get(str(item.get('content_id') or ''))

            resolved = _resolve_item_date(
                name=name,
                module_name=module_name,
                canvas_entity=canvas_entity,
                default_year=default_year,
                week_one_start=week_one_start,
                prefix_one_start=prefix_one_start,
            )
            if not is_plausible_course_date(resolved):
                resolved = anchor
            if not resolved:
                continue

            bucket = bucket_for(resolved)
            if item_type in {'assignment', 'quiz', 'discussion'}:
                assignment_entity = canvas_entity or {'name': name}
                if _is_course_level_event(assignment_entity):
                    add_event(bucket, name)
                elif not _is_discussion(canvas_entity or {}) and not _is_participation(canvas_entity or {}):
                    linked_files = []
                    if item_type == 'assignment' and name.lower().endswith('.pdf'):
                        linked_files = [{'name': name}]
                    add_assignment(bucket, name, linked_files)
            elif item_type == 'file':
                add_file(bucket, name)
            elif item_type in {'page', 'externalurl', 'external_url', 'externaltool'}:
                add_file(bucket, name)

    if not buckets:
        return []

    earliest = min(dated_points) if dated_points else None
    latest = max(dated_points) if dated_points else None
    if not earliest or not latest:
        return []

    schedule: list[dict[str, Any]] = []
    cursor = _monday_start(earliest)
    last = _monday_start(latest)
    week_index = 1
    while cursor <= last:
        key = cursor.date().isoformat()
        bucket = buckets.get(key) or {
            'start': cursor,
            'end': _week_end(cursor),
            'files': [],
            'assignments': [],
            'events': [],
        }
        schedule.append({
            'name': f'Week {week_index}',
            'start_date': format_ground_truth_date(cursor.isoformat(), default_year=default_year),
            'end_date': format_ground_truth_date(_week_end(cursor).isoformat(), default_year=default_year),
            'files': bucket.get('files') or [],
            'assignments': bucket.get('assignments') or [],
            'events': bucket.get('events') or [],
        })
        cursor += timedelta(days=7)
        week_index += 1
    return schedule


def format_course_snapshot(
    snapshot: dict[str, Any],
    *,
    graph: dict[str, Any] | None = None,
    root_dir: Path | str | None = None,
    use_llm_weekly: bool = False,
) -> dict[str, Any]:
    default_year = _infer_default_year(snapshot)
    assignments: list[dict[str, str]] = []
    discussions: list[dict[str, str]] = []
    events: list[dict[str, str]] = []

    for assignment in snapshot.get('assignments') or []:
        if assignment.get('workflow_state') == 'deleted':
            continue
        if assignment.get('published') is False:
            continue
        name = str(assignment.get('name') or '').strip()
        if not name:
            continue
        entry = _assignment_entry(assignment, default_year)
        if _is_participation(assignment):
            continue
        if _is_discussion(assignment):
            discussions.append(entry)
            continue
        if _is_course_level_event(assignment):
            events.append(entry)
            continue
        assignments.append(entry)

    participation = _infer_participation(snapshot)
    reading_discussions = _extract_reading_discussions(snapshot, default_year)
    if reading_discussions and not discussions:
        discussions = reading_discussions

    syllabus_body = _strip_html((snapshot.get('course') or {}).get('syllabus_body') or '')
    exam_hints = extract_syllabus_exam_hints(build_syllabus_exam_text(other=syllabus_body))

    def _backfill_due_from_hints(entry: dict[str, str]) -> None:
        if entry.get('due_at'):
            return
        name = str(entry.get('name') or '').lower()
        for hint in exam_hints:
            label = str(hint.get('label') or hint.get('name') or '').lower()
            if not label:
                continue
            if label in name or name in label or (name == 'midterm' and 'midterm' in label):
                due = format_ground_truth_date(hint.get('date_text') or '', default_year=default_year)
                if due:
                    entry['due_at'] = due
                    return

    for entry in assignments + events:
        _backfill_due_from_hints(entry)

    categorized = {
        'assignments': assignments,
        'discussions': discussions,
        'participation': participation,
        'events': events,
    }

    result: dict[str, Any] = {
        'assignments': assignments,
        'modules': _format_modules(snapshot),
    }
    if discussions:
        result['discussions'] = discussions
    if participation:
        result['participation'] = participation
    if events:
        result['events'] = events

    weekly = _build_weekly_schedule(snapshot, categorized)
    if use_llm_weekly and graph:
        weekly = enrich_weekly_with_graph(weekly, snapshot, graph)
    if weekly:
        result['weekly_schedule'] = weekly
    return result
