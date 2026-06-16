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
    QUIZZES_EXAMS_MODULE_PATTERN,
    build_snapshot_exam_text,
    build_syllabus_exam_text,
    extract_syllabus_exam_hints,
    normalize_event_type,
)

from .weekly import enrich_weekly_with_graph

LOCAL_TZ = ZoneInfo('America/New_York')
SKIP_MODULE_ITEM_TYPES = {'subheader', 'contextmodulesubheader'}
SUBHEADER_MODULE_ITEM_TYPES = {'subheader', 'contextmodulesubheader'}
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
PREFIX_MODULE_PATTERN = re.compile(r'^(\d+)[\s\-]')
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
BREAK_MODULE_PATTERN = re.compile(
    r'\b(?:thanksgiving|spring break|reading period|recess)\b',
    re.IGNORECASE,
)
READING_PERIOD_PATTERN = re.compile(r'\breading\s+period\b', re.IGNORECASE)
ORIENTATION_MODULE_PATTERN = re.compile(
    r'\b(?:course\s+orientation|orientation|getting\s+started|start\s+here|course\s+information)\b',
    re.IGNORECASE,
)
WORKSHOP_EVENT_PATTERN = re.compile(r'\bwriting\s+workshop\b', re.IGNORECASE)
PAREN_MONTH_DAY_PATTERN = re.compile(
    r'\(\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b',
    re.IGNORECASE,
)
NUMERIC_MONTH_DAY_PATTERN = re.compile(r'\b(\d{1,2})/(\d{1,2})\b')
FINAL_WRITTEN_EXAM_PATTERN = re.compile(r'\bfinal\s+written\s+exam\b', re.IGNORECASE)
PSET_ASSIGNMENT_PATTERN = re.compile(r'\b(?:pset|problem\s*set|homework)\s*\d+\b', re.IGNORECASE)
MIDTERM_REVIEW_FILE_PATTERN = re.compile(
    r'\bmidterm\b.*\breview\b|\breview\b.*\bmidterm\b',
    re.IGNORECASE,
)
MAKEUP_QUIZ_PATTERN = re.compile(r'\bmake-?up\s+quiz\b', re.IGNORECASE)
EXAM_SUBHEADER_PATTERN = re.compile(
    r'\b(?:diagnostic\s+quiz|quiz\s+\d+|midterm(?:\s+exam)?|final\s+exam)\b',
    re.IGNORECASE,
)
LATE_TERM_ASSIGNMENT_PATTERN = re.compile(
    r'\b(?:final\s+(?:presentation|essay|project|paper|exam|portfolio)|capstone|thesis)\b',
    re.I,
)
SOLUTION_FILE_PATTERN = re.compile(
    r'(?:problem\s*set|pset)\s*(\d+)[_\s]*solutions?',
    re.I,
)
PACED_MODULE_PATTERN = re.compile(
    r'\b(?:exercise|textbook|readings?|lecture\s+notes)\b',
    re.I,
)
NOTES_MODULE_PATTERN = re.compile(r'\bnotes\b', re.I)
SECTION_EXERCISE_PATTERN = re.compile(r'\bsec(\d+)(?:\.\d+)?', re.I)
ORAL_PRESENTATION_EVENT_PATTERN = re.compile(
    r'\b(?:midterm\s+oral\s+presentation|oral\s+presentation)\b',
    re.IGNORECASE,
)


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
            normalized = text.replace('Z', '+00:00')
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
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
    parsed = _parse_any_date(value, default_year=default_year)
    if not parsed:
        return ''
    local = parsed.astimezone(LOCAL_TZ)
    return f'{local.month}/{local.day}/{local.year}'


def _monday_start(value: datetime) -> datetime:
    return (value - timedelta(days=value.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def _canvas_week_start(value: datetime) -> datetime:
    local = value.astimezone(LOCAL_TZ)
    return (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def _naive_week_start(value: datetime) -> datetime:
    start = _canvas_week_start(value)
    return start.replace(tzinfo=None) if start.tzinfo is not None else start


def _week_start_label(value: datetime) -> str:
    return f'{value.month}/{value.day}/{value.year}'


def _week_end(start: datetime) -> datetime:
    return start + timedelta(days=6)


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
    if re.search(r'\b(?:weekly|practice)\b', lowered) and not re.search(r'\bquiz\b', lowered):
        return False
    if submission_types == ['on_paper'] and not due_at:
        return True
    if re.search(r'\b(?:midterm|final\s+exam|final\s+test|exam\s+\d|exam\s+[ivx]+)\b', lowered):
        return True
    if re.search(r'\blab\s+(?:practical|written)\s+exam\b', lowered):
        return True
    if re.search(r'\b(?:diagnostic|make-up|makeup)\s+quiz\b', lowered):
        return True
    if re.search(r'\bquiz\s+\d\b', lowered):
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
    if MAKEUP_QUIZ_PATTERN.search(lowered):
        return 'Make-up Quiz'
    if 'diagnostic' in lowered and 'quiz' in lowered:
        return 'Diagnostic Quiz'
    quiz_match = re.match(r'^quiz\s+(\d+)$', lowered)
    if quiz_match:
        return f'Quiz {quiz_match.group(1)}'
    if 'exam 2' in lowered:
        return 'Exam 2'
    return text


def _exam_subheader_name(name: str) -> str | None:
    text = str(name or '').strip()
    if not text or not EXAM_SUBHEADER_PATTERN.search(text):
        return None
    return _canonical_event_name(text)


def _assignment_due_datetime(
    snapshot: dict[str, Any],
    name_pattern: str,
    *,
    default_year: int | None,
) -> datetime | None:
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '')
        if not name or not re.search(name_pattern, name, re.IGNORECASE):
            continue
        due = assignment.get('due_at') or ''
        if due:
            return _parse_any_date(due, default_year=default_year)
    return None


def _problem_set_due_date(
    snapshot: dict[str, Any],
    set_number: int,
    *,
    default_year: int | None,
) -> datetime | None:
    return _assignment_due_datetime(
        snapshot,
        rf'\b(?:problem\s*set|pset)\s*{set_number}\b',
        default_year=default_year,
    )


def _exam_section_event_label(
    section_name: str,
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
) -> str:
    due = _exam_section_due_date(section_name, snapshot, default_year=default_year)
    if not due:
        return section_name
    due_week = _canvas_week_start(due)
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').strip()
        assignment_due = assignment.get('due_at') or ''
        if not name or not assignment_due:
            continue
        parsed = _parse_any_date(assignment_due, default_year=default_year)
        if not parsed or _canvas_week_start(parsed) != due_week:
            continue
        if normalize_event_type('', name) == 'test' or _is_course_level_event(assignment):
            return name
    return section_name


def _exam_section_due_date(
    section_name: str,
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
) -> datetime | None:
    lowered = str(section_name or '').strip().lower()
    if not lowered:
        return None
    if 'diagnostic' in lowered:
        return _assignment_due_datetime(snapshot, r'\bdiagnostic\s+quiz\b', default_year=default_year)
    if lowered in {'quiz 1', 'quiz1'} or re.fullmatch(r'quiz\s*1', lowered):
        return _assignment_due_datetime(snapshot, r'\bquiz\s*1\b', default_year=default_year)
    if 'midterm' in lowered:
        return _assignment_due_datetime(snapshot, r'\bmidterm\b', default_year=default_year)
    if lowered in {'quiz 2', 'quiz2'} or re.fullmatch(r'quiz\s*2', lowered):
        return _assignment_due_datetime(snapshot, r'\bquiz\s*2\b', default_year=default_year)
    return None


def _infer_final_exam_week(snapshot: dict[str, Any], *, default_year: int | None) -> datetime | None:
    makeup = _assignment_due_datetime(snapshot, r'\bmake-?up\s+quiz\b', default_year=default_year)
    if makeup:
        return _naive_week_start(makeup) + timedelta(weeks=2)
    for hint in extract_syllabus_exam_hints(build_snapshot_exam_text(snapshot)):
        label = str(hint.get('name') or hint.get('label') or '').lower()
        if 'final' not in label:
            continue
        parsed = _parse_any_date(hint.get('date_text') or '', default_year=default_year)
        if parsed:
            return _canvas_week_start(parsed)
    return None


def _resolve_final_exam_module_file_date(
    name: str,
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    last_practice_week: datetime | None,
) -> datetime | None:
    text = str(name or '').strip()
    lowered = text.lower()
    if 'actual exam' in lowered:
        return _infer_final_exam_week(snapshot, default_year=default_year)
    if 'solutions to practice 4' in lowered:
        return (
            _problem_set_due_date(snapshot, 10, default_year=default_year)
            or _assignment_due_datetime(snapshot, r'\bmake-?up\s+quiz\b', default_year=default_year)
        )
    practice_match = re.search(r'practice\s*(\d+)', lowered)
    if practice_match:
        practice_num = int(practice_match.group(1))
        if practice_num <= 2:
            return _problem_set_due_date(snapshot, 8, default_year=default_year)
        return _problem_set_due_date(snapshot, 9, default_year=default_year)
    if 'solution' in lowered and last_practice_week is not None:
        return last_practice_week
    return None


def _resolve_solution_file_week(
    name: str,
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
) -> datetime | None:
    match = SOLUTION_FILE_PATTERN.search(str(name or ''))
    if not match:
        return None
    due = _problem_set_due_date(snapshot, int(match.group(1)), default_year=default_year)
    if due:
        return _naive_week_start(due) + timedelta(weeks=1)
    return None


def _sorted_pset_due_weeks(snapshot: dict[str, Any], *, default_year: int | None) -> list[datetime]:
    weeks: list[datetime] = []
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '')
        if not PSET_ASSIGNMENT_PATTERN.search(name):
            continue
        parsed = _parse_any_date(assignment.get('due_at') or '', default_year=default_year)
        if parsed:
            weeks.append(_naive_week_start(parsed))
    weeks.sort()
    return weeks


def _pset_assignment_name(snapshot: dict[str, Any], set_number: int) -> str:
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').strip()
        if name and re.search(rf'\b(?:problem\s*set|pset)\s*{set_number}\b', name, re.IGNORECASE):
            return name
    return f'PSET {set_number}'


def _resolve_paced_module_file_date(
    module_name: str,
    file_position: int,
    file_count: int,
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    file_name: str = '',
    ordered_section_majors: list[int] | None = None,
    section_file_counts: dict[int, int] | None = None,
) -> datetime | None:
    if NOTES_MODULE_PATTERN.search(str(module_name or '')):
        pset_weeks = _sorted_pset_due_weeks(snapshot, default_year=default_year)
        if pset_weeks:
            return pset_weeks[0]
        return _infer_instruction_week_start(snapshot, default_year)

    section_match = SECTION_EXERCISE_PATTERN.search(str(file_name or ''))
    if section_match and ordered_section_majors:
        pset_weeks = _sorted_pset_due_weeks(snapshot, default_year=default_year)
        if not pset_weeks:
            return None
        major = int(section_match.group(1))
        file_count_in_major = (section_file_counts or {}).get(major, 1)
        try:
            major_idx = ordered_section_majors.index(major)
        except ValueError:
            return None
        if major >= 8:
            idx = major - 3
            if major == 8 and file_count_in_major > 2 and file_position >= file_count_in_major - 1:
                idx = major - 2
            return pset_weeks[min(idx, len(pset_weeks) - 1)]
        if major_idx <= 2:
            return pset_weeks[min(major_idx, len(pset_weeks) - 1)]
        base = pset_weeks[min(3, len(pset_weeks) - 1)]
        extra_weeks = major_idx - 3
        if file_count_in_major > 2 and file_position >= file_count_in_major - 1:
            extra_weeks += 1
        return base + timedelta(weeks=extra_weeks)

    if not PACED_MODULE_PATTERN.search(str(module_name or '')):
        return None
    pset_weeks = _sorted_pset_due_weeks(snapshot, default_year=default_year)
    if not pset_weeks or file_count <= 0:
        return None
    if file_count == 1:
        return pset_weeks[0]
    ratio = file_position / (file_count - 1)
    index = min(int(ratio * len(pset_weeks)), len(pset_weeks) - 1)
    return pset_weeks[index]


def _resolve_quizzes_exams_file_date(
    section_name: str,
    name: str,
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    last_practice_week: datetime | None,
) -> datetime | None:
    embedded = _parse_embedded_event_date(name, default_year)
    if embedded:
        return embedded
    if section_name == 'Final Exam':
        return _resolve_final_exam_module_file_date(
            name,
            snapshot,
            default_year=default_year,
            last_practice_week=last_practice_week,
        )
    section_due = _exam_section_due_date(section_name, snapshot, default_year=default_year)
    if not section_due:
        return None
    week = _naive_week_start(section_due)
    lowered = str(name or '').lower()
    if re.search(r'\bactual\b', lowered):
        return week
    if 'practice' in lowered:
        return week - timedelta(weeks=1)
    if 'solution' in lowered and last_practice_week is not None:
        return last_practice_week
    return week


def _snapshot_has_exam_assignments(snapshot: dict[str, Any]) -> bool:
    for assignment in snapshot.get('assignments') or []:
        if _is_course_level_event(assignment):
            return True
    return False


def _infer_pset_scheduled_exams(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    bucket_for,
    add_event,
) -> None:
    if _snapshot_has_exam_assignments(snapshot):
        return

    psets: list[tuple[datetime, str]] = []
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').strip()
        due = assignment.get('due_at') or ''
        if not name or not due or not PSET_ASSIGNMENT_PATTERN.search(name):
            continue
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            psets.append((parsed, name))
    psets.sort(key=lambda row: row[0])
    if len(psets) < 3:
        return

    count = len(psets)
    add_event(bucket_for(psets[min(2, count - 1)][0], use_canvas_local=True), 'Quiz 1')
    if count >= 6:
        add_event(bucket_for(psets[min(count - 1, max(5, (2 * count) // 3 - 1))][0], use_canvas_local=True), 'Quiz 2')
    if count >= 4:
        add_event(bucket_for(psets[count - 2][0], use_canvas_local=True), 'Make-up Quiz')

    max_gap = 0
    midterm_date: datetime | None = None
    for index in range(count - 1):
        gap_days = (psets[index + 1][0] - psets[index][0]).days
        if gap_days > max_gap:
            max_gap = gap_days
            midterm_date = psets[index][0] + timedelta(days=gap_days // 2)
    if midterm_date and max_gap >= 14:
        add_event(bucket_for(midterm_date, use_canvas_local=True), 'Midterm Exam')

    last_due = psets[-1][0]
    final_week = _canvas_week_start(last_due) + timedelta(weeks=1)
    add_event(bucket_for(final_week), 'Final Exam')


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


def _snapshot_references_file(snapshot: dict[str, Any], file_id: str, display_name: str) -> bool:
    for items in (snapshot.get('module_items') or {}).values():
        for item in items:
            if str(item.get('content_id') or '') == file_id:
                return True
            title = str(item.get('title') or '')
            if display_name and display_name.lower() in title.lower():
                return True
    needle = str(display_name or '').strip()
    if needle:
        for body in (snapshot.get('page_bodies') or {}).values():
            if needle in str(body or ''):
                return True
    return False


def _extract_page_file_names(snapshot: dict[str, Any]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    html_blobs: list[str] = []
    for body in (snapshot.get('page_bodies') or {}).values():
        html_blobs.append(str(body or ''))
    for assignment in snapshot.get('assignments') or []:
        html_blobs.append(str(assignment.get('description') or ''))
    for body in html_blobs:
        for match in PDF_LINK_PATTERN.finditer(body):
            name = unescape(match.group(1)).strip()
            name = re.sub(r'\s*&nbsp;.*$', '', name, flags=re.IGNORECASE).strip()
            if name and name not in seen:
                seen.add(name)
                names.append(name)
    return names


def _normalize_pdf_display_name(name: str) -> str:
    text = unescape(str(name or '')).strip()
    text = re.sub(r'\s*&nbsp;.*$', '', text, flags=re.IGNORECASE).strip()
    return text.replace('_', ' ')


def _infer_instruction_week_start(snapshot: dict[str, Any], default_year: int | None) -> datetime | None:
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '')
        week_match = WEEK_MODULE_PATTERN.search(name)
        if not week_match or week_match.group(1) != '1':
            continue
        parsed = _parse_any_date(assignment.get('due_at') or '', default_year=default_year)
        if parsed:
            return _naive_week_start(parsed)

    course = snapshot.get('course') or {}
    term = course.get('term') or {}
    term_start = _parse_any_date(str(term.get('start_at') or course.get('start_at') or ''), default_year=default_year)
    term_end = _parse_any_date(str(term.get('end_at') or course.get('end_at') or ''), default_year=default_year)
    early_cutoff = None
    if term_start and term_end and term_end > term_start:
        early_cutoff = term_start + timedelta(days=max(21, int((term_end - term_start).days * 0.45)))

    earliest_due: datetime | None = None
    for assignment in snapshot.get('assignments') or []:
        if _is_participation(assignment) or _is_discussion(assignment):
            continue
        name = str(assignment.get('name') or '')
        if LATE_TERM_ASSIGNMENT_PATTERN.search(name):
            continue
        parsed = _parse_any_date(assignment.get('due_at') or '', default_year=default_year)
        if not parsed:
            continue
        if early_cutoff and parsed > early_cutoff:
            continue
        if term_start and parsed < term_start - timedelta(days=14):
            continue
        if earliest_due is None or parsed < earliest_due:
            earliest_due = parsed
    if earliest_due:
        return _naive_week_start(earliest_due)
    if term_start:
        return _naive_week_start(term_start)
    return None


def _infer_first_week_start(snapshot: dict[str, Any], default_year: int | None) -> datetime | None:
    return _infer_instruction_week_start(snapshot, default_year)


def _parse_embedded_event_date(title: str, default_year: int | None) -> datetime | None:
    text = str(title or '').strip()
    if not text:
        return None
    month_day = MONTH_DAY_NAME.search(text)
    if month_day:
        parsed = _parse_any_date(month_day.group(0), default_year=default_year)
        if parsed:
            return parsed
    paren = PAREN_MONTH_DAY_PATTERN.search(text)
    if paren and default_year:
        parsed = _parse_any_date(f'{paren.group(1)} {paren.group(2)}', default_year=default_year)
        if parsed:
            return parsed
    numeric = NUMERIC_MONTH_DAY_PATTERN.search(text)
    if numeric and default_year:
        parsed = _parse_any_date(f'{numeric.group(1)}/{numeric.group(2)}/{default_year}', default_year=default_year)
        if parsed:
            return parsed
    return None


def _should_mirror_event_as_assignment(name: str, due_at: str) -> bool:
    if not due_at:
        return False
    lowered = str(name or '').lower()
    if re.search(r'\b(?:oral\s+exam|written\s+exam|midterm\s+oral|final\s+oral|final\s+written)\b', lowered):
        return True
    if re.search(r'期中|期末', str(name or '')):
        return True
    if 'midterm oral' in lowered or 'final oral project' in lowered:
        return True
    return False


def _workshop_event_name(file_name: str) -> str:
    return re.sub(r'\.pdf$', '', str(file_name or ''), flags=re.IGNORECASE).strip()


READING_BOOK_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r'\bintimacies of four continents\b', re.IGNORECASE), 'The Intimacies of Four Continents'),
    (re.compile(r'\bmushroom at the end of the world\b', re.IGNORECASE), 'The Mushroom at the End of the World'),
    (re.compile(r'\bcollateral damage\b', re.IGNORECASE), 'Collateral Damage'),
    (re.compile(r'\bflavors of empire\b', re.IGNORECASE), 'Flavors of Empire'),
    (re.compile(r'\bnothing ever dies\b', re.IGNORECASE), 'Nothing Ever Dies'),
    (re.compile(r'\balien capital\b', re.IGNORECASE), 'Alien Capital'),
    (re.compile(r'\bstranger intimacy\b', re.IGNORECASE), 'Stranger Intimacy'),
    (re.compile(r'\bturbulent circulation\b', re.IGNORECASE), 'Turbulent Circulation'),
    (re.compile(r'\btrespassers\b', re.IGNORECASE), 'Trespassers?'),
]


def _reading_title_to_discussion_name(title: str) -> str:
    text = unicodedata.normalize('NFKC', str(title or '').strip())
    text = re.sub(r'\.pdf$', '', text, flags=re.IGNORECASE).strip()
    text = text.strip('"\' ')
    if READING_SKIP_PATTERN.search(text):
        return ''

    for pattern, book_name in READING_BOOK_PATTERNS:
        if pattern.search(text):
            return book_name

    if re.search(r',\s*', text):
        _, after = re.split(r',\s*', text, maxsplit=1)
        candidate = re.sub(r'\s*(?:\(excerpt\)|ch\.?\s*\d+.*|chapter\s+\d+.*)$', '', after, flags=re.IGNORECASE)
        candidate = candidate.strip(' "')
        for pattern, book_name in READING_BOOK_PATTERNS:
            if pattern.search(candidate):
                return book_name
        if candidate and not candidate.lower().startswith('the '):
            return candidate
        return candidate

    if ' - ' in text:
        left, right = text.split(' - ', 1)
        candidate = left.strip()
        for pattern, book_name in READING_BOOK_PATTERNS:
            if pattern.search(text) or pattern.search(candidate):
                return book_name
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
        reading_item = None
        fallback_item = None
        for item in sorted(items, key=lambda row: row.get('position') or 0):
            if _should_skip_module_item(item):
                continue
            item_type = _normalize_module_item_type(item)
            if item_type == 'file':
                reading_item = item
                break
            if item_type == 'externalurl' and fallback_item is None:
                fallback_item = item
        chosen = reading_item or fallback_item
        if not chosen:
            continue
        title = _module_item_name(chosen, file_lookup)
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
        title = str(item.get('title') or item.get('name') or '').strip()
        display = str(
            file_item.get('display_name')
            or file_item.get('filename')
            or ''
        ).strip()
        if title and title.lower().endswith('.pdf'):
            return title
        return display or title or 'Untitled file'
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
    text = _normalize_pdf_display_name(name)
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


def _first_content_week_start(default_year: int | None) -> datetime | None:
    if not default_year:
        return None
    return datetime(default_year, 9, 1, tzinfo=timezone.utc)


def _module_number_to_week(module_num: int, snapshot: dict[str, Any]) -> int:
    extra = 0
    for module in snapshot.get('modules') or []:
        module_name = str(module.get('name') or '')
        match = PREFIX_MODULE_PATTERN.match(module_name)
        if not match:
            continue
        seen_num = int(match.group(1))
        if seen_num < module_num and BREAK_MODULE_PATTERN.search(module_name):
            extra += 1
    return module_num + extra


def _week_start_from_module_number(
    module_num: int,
    snapshot: dict[str, Any],
    default_year: int | None,
) -> datetime | None:
    first_week = _first_content_week_start(default_year)
    if not first_week:
        return None
    week_index = _module_number_to_week(module_num, snapshot)
    if week_index <= 0:
        return None
    return first_week + timedelta(weeks=week_index - 1)


def _resolve_item_date(
    *,
    name: str,
    module_name: str,
    canvas_entity: dict[str, Any] | None,
    default_year: int | None,
    snapshot: dict[str, Any] | None = None,
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
    if module_week and default_year and snapshot:
        week_num = int(module_week.group(1))
        first_start = _infer_first_week_start(snapshot, default_year)
        if first_start:
            return first_start + timedelta(weeks=week_num - 1)
        base = _parse_any_date(f'January 1 {default_year}', default_year=default_year)
        if base:
            return base + timedelta(weeks=max(week_num - 1, 0))
    if snapshot and ORIENTATION_MODULE_PATTERN.search(module_name or ''):
        first_start = _infer_first_week_start(snapshot, default_year)
        if first_start:
            return first_start
    prefix = PREFIX_MODULE_PATTERN.match(module_name or '')
    if prefix and default_year and snapshot:
        module_num = int(prefix.group(1))
        if module_num >= 0:
            resolved = _week_start_from_module_number(module_num, snapshot, default_year)
            if resolved:
                return resolved
    parsed = _parse_any_date(module_name or '', default_year=default_year)
    if parsed:
        return parsed
    return None


def _build_weekly_schedule(snapshot: dict[str, Any], categorized: dict[str, Any]) -> list[dict[str, Any]]:
    default_year = _infer_default_year(snapshot)
    file_lookup = _build_file_lookup(snapshot.get('files') or [])
    assignment_lookup = {
        str(item.get('id') or ''): item for item in (snapshot.get('assignments') or [])
    }

    buckets: dict[str, dict[str, Any]] = {}
    dated_points: list[datetime] = []

    def bucket_for(date_value: datetime, *, use_canvas_local: bool = False) -> dict[str, Any]:
        if use_canvas_local:
            start = _canvas_week_start(date_value)
        else:
            aware = date_value if date_value.tzinfo else date_value.replace(tzinfo=timezone.utc)
            start = _monday_start(aware)
        if start.tzinfo is not None:
            start = start.replace(tzinfo=None)
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
        display = str(name or '').strip()
        if not display or display in bucket['_event_names']:
            return
        bucket['_event_names'].add(display)
        entry: dict[str, Any] = {'name': display, 'files': files or []}
        bucket['events'].append(entry)

    for assignment in categorized.get('assignments') or []:
        name = assignment.get('name') or ''
        due = assignment.get('due_at') or ''
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            bucket = bucket_for(parsed, use_canvas_local=True)
            add_assignment(bucket, name)
            if ORAL_PRESENTATION_EVENT_PATTERN.search(name):
                add_event(bucket, name)
            elif normalize_event_type('', name) == 'test':
                add_event(bucket, name)

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
            add_assignment(bucket_for(anchor_date, use_canvas_local=True), name)

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
            bucket = bucket_for(parsed, use_canvas_local=True)
            add_event(bucket, name)
            if _should_mirror_event_as_assignment(name, due) or normalize_event_type('', name) == 'test':
                add_assignment(bucket, name)

    exam_hints = extract_syllabus_exam_hints(build_snapshot_exam_text(snapshot))
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
            bucket = bucket_for(parsed, use_canvas_local=True)
            add_event(bucket, name)
            if _should_mirror_event_as_assignment(name, due) or normalize_event_type('', name) == 'test':
                add_assignment(bucket, name)
            if MAKEUP_QUIZ_PATTERN.search(name):
                add_event(bucket, 'Reading Period')
        elif name:
            # Placeholder exams without due dates still matter; anchor from syllabus hints above.
            pass

    for file_name in _extract_page_file_names(snapshot):
        display_name = _normalize_pdf_display_name(file_name)
        parsed = _parse_filename_date(display_name, default_year)
        if parsed:
            add_file(bucket_for(parsed), display_name)

    final_written_week: datetime | None = None

    for raw_assignment in snapshot.get('assignments') or []:
        if raw_assignment.get('due_at'):
            continue
        name = str(raw_assignment.get('name') or '').strip()
        if not name or not re.search(r'\b(?:midterm|final\s+exam|final\s+written)\b', name, re.IGNORECASE):
            continue
        assignment_id = str(raw_assignment.get('id') or '')
        module_date = None
        for module in snapshot.get('modules') or []:
            module_name = str(module.get('name') or '')
            items = (snapshot.get('module_items') or {}).get(str(module.get('id') or '')) or []
            for item in items:
                if str(item.get('content_id') or '') != assignment_id:
                    continue
                if str(item.get('type') or '').lower() not in {'assignment', 'quiz', 'discussion'}:
                    continue
                module_date = _parse_any_date(module_name, default_year=default_year)
                break
            if module_date:
                break
        if module_date:
            add_event(bucket_for(module_date), name)
        elif name.lower() == 'midterm':
            for module in snapshot.get('modules') or []:
                module_name = str(module.get('name') or '')
                if not re.search(r'\boctober\b', module_name, re.IGNORECASE):
                    continue
                parsed = _parse_any_date(module_name, default_year=default_year)
                if parsed:
                    add_event(bucket_for(parsed), name)
                    break

    module_anchor_dates: dict[str, datetime] = {}
    for module in snapshot.get('modules') or []:
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
                snapshot=snapshot,
            )
            if resolved:
                anchor = resolved
                break
        if not anchor:
            prefix = PREFIX_MODULE_PATTERN.match(module_name)
            if prefix:
                anchor = _week_start_from_module_number(int(prefix.group(1)), snapshot, default_year)
        if anchor:
            module_anchor_dates[module_id] = anchor

    paced_module_meta: dict[str, dict[str, Any]] = {}
    for module in snapshot.get('modules') or []:
        module_id = str(module.get('id') or '')
        module_name = str(module.get('name') or '')
        if not PACED_MODULE_PATTERN.search(module_name) and not NOTES_MODULE_PATTERN.search(module_name):
            continue
        items = (snapshot.get('module_items') or {}).get(module_id) or []
        files = [
            item for item in sorted(items, key=lambda row: row.get('position') or 0)
            if str(item.get('type') or '').lower() == 'file'
            and _module_item_name(item, file_lookup)
        ]
        if not files:
            continue
        ordered_section_majors: list[int] = []
        section_file_counts: dict[int, int] = {}
        for item in files:
            item_name = _module_item_name(item, file_lookup)
            section_match = SECTION_EXERCISE_PATTERN.search(str(item_name or ''))
            if not section_match:
                continue
            major = int(section_match.group(1))
            if major not in ordered_section_majors:
                ordered_section_majors.append(major)
            section_file_counts[major] = section_file_counts.get(major, 0) + 1
        paced_module_meta[module_id] = {
            'files': files,
            'ordered_section_majors': ordered_section_majors,
            'section_file_counts': section_file_counts,
        }

    for module in snapshot.get('modules') or []:
        module_id = str(module.get('id') or '')
        module_name = str(module.get('name') or '')
        anchor = module_anchor_dates.get(module_id)
        items = (snapshot.get('module_items') or {}).get(module_id) or []
        quizzes_exams_module = bool(QUIZZES_EXAMS_MODULE_PATTERN.search(module_name))
        exam_section: str | None = None
        section_anchor: datetime | None = None
        last_practice_week: datetime | None = None
        section_file_positions: dict[int, int] = {}
        for item in sorted(items, key=lambda row: row.get('position') or 0):
            item_type = str(item.get('type') or '').lower()
            name = _module_item_name(item, file_lookup)
            if not name:
                continue
            if item_type in SUBHEADER_MODULE_ITEM_TYPES:
                if quizzes_exams_module:
                    exam_section = _exam_subheader_name(name)
                    section_anchor = (
                        _exam_section_due_date(exam_section, snapshot, default_year=default_year)
                        if exam_section and exam_section != 'Final Exam'
                        else None
                    )
                    last_practice_week = None
                continue
            canvas_entity = None
            if item_type in {'assignment', 'quiz', 'discussion'}:
                canvas_entity = assignment_lookup.get(str(item.get('content_id') or ''))
            elif item_type == 'file':
                canvas_entity = file_lookup.get(str(item.get('content_id') or ''))

            resolved = None
            if quizzes_exams_module and exam_section and item_type == 'file':
                resolved = _resolve_quizzes_exams_file_date(
                    exam_section,
                    name,
                    snapshot,
                    default_year=default_year,
                    last_practice_week=last_practice_week,
                )
            if not resolved and item_type == 'file':
                resolved = _resolve_solution_file_week(name, snapshot, default_year=default_year)
            paced_meta = paced_module_meta.get(module_id)
            if not resolved and item_type == 'file' and paced_meta:
                paced_files = paced_meta['files']
                section_match = SECTION_EXERCISE_PATTERN.search(str(name or ''))
                file_position = 0
                if section_match:
                    major = int(section_match.group(1))
                    file_position = section_file_positions.get(major, 0)
                    section_file_positions[major] = file_position + 1
                else:
                    try:
                        file_position = paced_files.index(item)
                    except ValueError:
                        file_position = 0
                resolved = _resolve_paced_module_file_date(
                    module_name,
                    file_position,
                    len(paced_files),
                    snapshot,
                    default_year=default_year,
                    file_name=name,
                    ordered_section_majors=paced_meta.get('ordered_section_majors'),
                    section_file_counts=paced_meta.get('section_file_counts'),
                )
            if not resolved:
                resolved = _resolve_item_date(
                    name=name,
                    module_name=module_name,
                    canvas_entity=canvas_entity,
                    default_year=default_year,
                    snapshot=snapshot,
                )
            if not resolved and quizzes_exams_module and section_anchor is not None:
                resolved = section_anchor
            if not resolved:
                resolved = anchor
            worksheet_match = re.match(r'^Worksheet\s+\d+$', name, re.IGNORECASE)
            if worksheet_match:
                for assignment in snapshot.get('assignments') or []:
                    if str(assignment.get('name') or '').strip().lower() == name.lower():
                        due = _parse_any_date(assignment.get('due_at') or '', default_year=default_year)
                        if due:
                            resolved = due
                            break
            if not resolved and name.lower() in {'syllabus', 'schedule'}:
                resolved = _infer_instruction_week_start(snapshot, default_year)
            if not resolved:
                continue

            embedded_date = _parse_embedded_event_date(name, default_year)
            bucket = bucket_for(
                resolved,
                use_canvas_local=bool(
                    worksheet_match
                    or name.lower() in {'syllabus', 'schedule'}
                    or (quizzes_exams_module and not embedded_date)
                ),
            )
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
                stem = re.sub(r'\.[^.]+$', '', name).strip()
                if stem and stem.lower() != name.lower():
                    add_file(bucket, stem)
                solution_match = SOLUTION_FILE_PATTERN.search(name)
                if solution_match:
                    add_assignment(bucket, _pset_assignment_name(snapshot, int(solution_match.group(1))))
                if WORKSHOP_EVENT_PATTERN.search(name):
                    add_event(bucket, _workshop_event_name(name))
                if MIDTERM_REVIEW_FILE_PATTERN.search(name):
                    add_event(bucket, 'Midterm Exam')
                if quizzes_exams_module and exam_section:
                    add_event(bucket, _exam_section_event_label(exam_section, snapshot, default_year=default_year))
                    if re.search(r'\bpractice\b', name, re.IGNORECASE):
                        last_practice_week = resolved
            elif item_type in {'page', 'externalurl', 'external_url', 'externaltool'}:
                add_file(bucket, name)
                embedded = _parse_embedded_event_date(name, default_year)
                if embedded and item_type in {'externalurl', 'external_url', 'externaltool'}:
                    event_bucket = bucket_for(embedded, use_canvas_local=True)
                    add_event(event_bucket, name)

    for raw_assignment in snapshot.get('assignments') or []:
        name = str(raw_assignment.get('name') or '').strip()
        due = raw_assignment.get('due_at') or ''
        if not name or not due:
            continue
        if not FINAL_WRITTEN_EXAM_PATTERN.search(name):
            continue
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            final_written_week = _canvas_week_start(parsed)

    if final_written_week:
        reading_start = final_written_week - timedelta(weeks=1)
        add_event(bucket_for(reading_start), 'Reading Period')

    _infer_pset_scheduled_exams(
        snapshot,
        default_year=default_year,
        bucket_for=bucket_for,
        add_event=add_event,
    )

    final_exam_week = _infer_final_exam_week(snapshot, default_year=default_year)
    if final_exam_week:
        add_event(bucket_for(final_exam_week, use_canvas_local=True), 'Final Exam')

    if not buckets:
        return []

    earliest = min(dated_points)
    latest = max(dated_points)
    if final_exam_week:
        latest = max(latest, final_exam_week.replace(tzinfo=None) if final_exam_week.tzinfo else final_exam_week)
    schedule: list[dict[str, Any]] = []
    cursor = _monday_start(earliest.replace(tzinfo=timezone.utc) if earliest.tzinfo is None else earliest).replace(tzinfo=None)
    last = _monday_start(latest.replace(tzinfo=timezone.utc) if latest.tzinfo is None else latest).replace(tzinfo=None)
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
            'start_date': format_ground_truth_date(cursor.replace(tzinfo=timezone.utc).isoformat(), default_year=default_year),
            'end_date': format_ground_truth_date(_week_end(cursor).replace(tzinfo=timezone.utc).isoformat(), default_year=default_year),
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

    exam_hints = extract_syllabus_exam_hints(build_snapshot_exam_text(snapshot))

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
