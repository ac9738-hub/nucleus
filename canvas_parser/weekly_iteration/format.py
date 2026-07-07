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
COMPACT_CLASS_DATE_PATTERN = re.compile(
    r'\bC\d+_(\d{2})(\d{2})(\d{4})(?:_[\w-]+)?',
    re.IGNORECASE,
)
COMPACT_CLASS_STEM_PATTERN = re.compile(
    r'^(C\d+_\d{8})(?:_[\w-]+)?(?:\.[^.]+)?$',
    re.IGNORECASE,
)
CLASS_CODE_FILE_PATTERN = re.compile(r'^C(\d+)code(?:\.[^.]+)?$', re.IGNORECASE)
CLASS_SCRIPT_FILE_PATTERN = re.compile(r'^class(\d+)[_.]', re.IGNORECASE)
MYODE_SCRIPT_FILE_PATTERN = re.compile(r'^myode\.m$', re.IGNORECASE)
NUMBERED_QUIZ_ASSIGNMENT_PATTERN = re.compile(r'^Quiz\s+(\d+)\b', re.IGNORECASE)
W_MODULE_TITLE_PATTERN = re.compile(
    r'^W\s*(\d+)\s*\(([^)]+)\)\s*(.+)$',
    re.IGNORECASE,
)
W_MODULE_SPACE_PATTERN = re.compile(
    r'^W\s+(\d+)\s*\(([^)]+)\)\s*(.+)$',
    re.IGNORECASE,
)
CLASS_CI_ASSIGNMENT_PATTERN = re.compile(
    r'^C\d+_(\d{2})(\d{2})(\d{4})_CI\b',
    re.IGNORECASE,
)
WEEK_PREFIX_MODULE_PATTERN = re.compile(r'^W(\d+)\b', re.IGNORECASE)
SECTION_EVENT_FILE_PATTERN = re.compile(
    r'^(?:Section|Unit|Economics in Action):',
    re.IGNORECASE,
)
LECTURE_FILE_PATTERN = re.compile(r'^Lecture\s+\d+', re.IGNORECASE)
CLASS_NOTES_MODULE_PATTERN = re.compile(r'\bclass notes\b', re.IGNORECASE)
PRECEPT_MATERIALS_MODULE_PATTERN = re.compile(r'\bprecept\b', re.IGNORECASE)
WEEK_PART_FILE_PATTERN = re.compile(r'^Week(\d+)_part', re.IGNORECASE)
NUMBERED_LECTURE_ITEM_PATTERN = re.compile(r'^(\d+)\s*-')
PRECEPT_FILE_PATTERN = re.compile(r'^Precept\s+(\d+)', re.IGNORECASE)
MODULE_HW_FILE_PATTERN = re.compile(r'(?:ORF245_SP26_|SP26_)HW(\d+)', re.IGNORECASE)
SYLLABUS_FILE_PATTERN = re.compile(r'syllabus', re.IGNORECASE)
STUDY_FILE_PATTERN = re.compile(
    r'(?:study[- ]guide|example_exam|kahoot_questions)',
    re.IGNORECASE,
)
AUTHOR_ARTICLE_FILE_PATTERN = re.compile(
    r'^[A-Za-z][A-Za-z0-9]*_\d{4}\.(?:pdf|docx)$',
    re.IGNORECASE,
)
QUIZ_ARTICLE_PATTERN = re.compile(r'^Quiz\s+(\d+)', re.IGNORECASE)
MIDTERM_EXAM_MODULE_PATTERN = re.compile(r'\bmidterm\s+exam\b', re.IGNORECASE)
FINAL_EXAM_MODULE_PATTERN = re.compile(r'\bfinal\s+exam\b', re.IGNORECASE)
SYLLABUS_MODULE_PATTERN = re.compile(r'^syllabus$', re.IGNORECASE)
SPRING_BREAK_PATTERN = re.compile(r'\bspring\s+break\b', re.IGNORECASE)
HOLIDAY_EVENT_PATTERN = re.compile(
    r"\b(?:president'?s day|thanksgiving|reading period)\b",
    re.IGNORECASE,
)
DUE_IN_NAME_PATTERN = re.compile(
    r'\(due\s+(\d{1,2})/(\d{1,2})',
    re.IGNORECASE,
)
PAREN_NUMERIC_MD_PATTERN = re.compile(
    r'\(\s*(\d{1,2})/(\d{1,2})',
    re.IGNORECASE,
)
TRAILING_MD_PATTERN = re.compile(
    r'(\d{1,2})/(\d{1,2})\s*$',
    re.IGNORECASE,
)
LEADING_MD_FILENAME_PATTERN = re.compile(
    r'^(\d{1,2})/(\d{1,2})\s+',
    re.IGNORECASE,
)
SYLLABUS_MONTH_TOKEN = (
    r'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
    r'Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'
)
SYLLABUS_SECTION_EVENT_PATTERN = re.compile(
    rf'\b({SYLLABUS_MONTH_TOKEN})\.?\s+(\d{{1,2}})\s+'
    rf'(Section:\s*(?:Debate\s*\(Round\s*\d+\)|Midterm[^.]*?(?:Review)?|[^A-Z]{{3,80}}?))'
    rf'(?=\s+(?:{SYLLABUS_MONTH_TOKEN})\.?\s+\d|\s+UNIT\b|\s+PS\d|\s+HOLIDAY|\s*$)',
    re.IGNORECASE,
)
SYLLABUS_GUEST_LECTURER_PATTERN = re.compile(
    rf'\b({SYLLABUS_MONTH_TOKEN})\.?\s+(\d{{1,2}})\s+Guest Lecturer:\s*([^,\u2013\u2014\n]+)',
    re.IGNORECASE,
)
SYLLABUS_MIDTERM_PATTERN = re.compile(
    rf'\b({SYLLABUS_MONTH_TOKEN})\.?\s+(\d{{1,2}})\s+Midterm\b',
    re.IGNORECASE,
)
SYLLABUS_FINAL_EXAM_PATTERN = re.compile(
    rf'\b({SYLLABUS_MONTH_TOKEN})\.?\s+(\d{{1,2}})\s+Final Exam\b',
    re.IGNORECASE,
)
REVIEW_FINAL_FILE_PATTERN = re.compile(r'\bReview_Final\b', re.IGNORECASE)
DRILL_MIDTERM_REVIEW_FILE_PATTERN = re.compile(
    r'\bdrill\b.*\bmidterm\b.*\breview\b|\bmidterm\b.*\breview\b.*\bdrill\b',
    re.IGNORECASE,
)
UTILITY_M_FILE_PATTERN = re.compile(
    r'^(?:odedriver|besseljzero|problem6_template)\.m$',
    re.IGNORECASE,
)
ECON_IN_ACTION_MODULE_PATTERN = re.compile(r'\beconomics in action\b', re.IGNORECASE)


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


def format_week_boundary_date(value: datetime) -> str:
    """Format naive week boundary dates without UTC→local day shifts."""
    if value.tzinfo is not None:
        local = value.astimezone(LOCAL_TZ)
        return f'{local.month}/{local.day}/{local.year}'
    return _week_start_label(value)


def format_schedule_week_date(value: datetime, *, default_year: int | None = None) -> str:
    """Format week boundary using local noon to avoid UTC day shifts."""
    if value.tzinfo is not None:
        local = value.astimezone(LOCAL_TZ)
        day = local.date()
    else:
        day = value.date()
    anchor = datetime(day.year, day.month, day.day, 12, 0, tzinfo=LOCAL_TZ)
    return format_ground_truth_date(anchor.isoformat(), default_year=default_year)


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
    years: set[int] = set()
    course = snapshot.get('course') or {}
    term = course.get('term') or {}
    term_name = str(term.get('name') or '').lower()
    term_start = _parse_any_date(str(term.get('start_at') or course.get('start_at') or ''))
    term_end = _parse_any_date(str(term.get('end_at') or course.get('end_at') or ''))
    if term_start and term_end and term_end.year > term_start.year and term_end.month <= 6:
        years.add(term_start.year)
    else:
        if term_start:
            years.add(term_start.year)
        if term_end:
            years.add(term_end.year)
    if isinstance(term, dict):
        for match in re.finditer(r'(20\d{2})', str(term.get('name') or '')):
            years.add(int(match.group(1)))
    for assignment in snapshot.get('assignments') or []:
        parsed = _parse_any_date(assignment.get('due_at') or '')
        if parsed:
            years.add(parsed.year)
    for file_item in snapshot.get('files') or []:
        name = _display_file_name(file_item)
        compact = COMPACT_CLASS_DATE_PATTERN.search(name)
        if compact:
            years.add(int(compact.group(3)))
    name = str(course.get('name') or '')
    match = re.search(r'(20\d{2})', name)
    if match:
        years.add(int(match.group(1)))
    if not years:
        return None
    if term_start and 'fall' in term_name:
        return term_start.year
    if term_end and 'spring' in term_name:
        return term_end.year if term_end.month <= 6 else term_start.year if term_start else max(years)
    if term_start:
        return term_start.year
    return max(years)


def _resolve_schedule_year(snapshot: dict[str, Any], default_year: int | None) -> int | None:
    if not default_year:
        return _infer_default_year(snapshot)
    course = snapshot.get('course') or {}
    term_name = str((course.get('term') or {}).get('name') or '')
    term_years = [int(match) for match in re.findall(r'(20\d{2})', term_name)]
    body = str(course.get('syllabus_body') or '')
    if (
        body
        and 'spring' in term_name.lower()
        and term_years
        and default_year == max(term_years)
        and SYLLABUS_FINAL_EXAM_PATTERN.search(re.sub(r'\s+', ' ', _strip_html(body)))
    ):
        return default_year + 1
    return default_year


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


def _exam_event_display_name(name: str) -> str:
    """Map course-level exam assignments to GT-style weekly event labels."""
    text = str(name or '').strip()
    lowered = text.lower()
    if re.search(r'\btake[- ]home\b', lowered) and re.search(r'\bmidterm\b', lowered):
        return 'Midterm Exam'
    if re.search(r'\bin[- ]person\b', lowered) and re.search(r'\bfinal\b', lowered):
        return 'Final Exam'
    canonical = _canonical_event_name(text)
    if canonical == 'Midterm' and re.search(r'\bexam\b', lowered):
        return 'Midterm Exam'
    if canonical == 'Final' and re.search(r'\bexam\b', lowered) and 'presentation' not in lowered:
        return 'Final Exam'
    return canonical if canonical else text


def _snapshot_has_take_home_midterm(snapshot: dict[str, Any]) -> bool:
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').lower()
        if ('take-home' in name or 'take home' in name) and 'midterm' in name:
            return True
    return False


def _infer_field_trip_events(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    bucket_for,
    add_event,
) -> None:
    """Infer field-trip events when Canvas contrasts field vs non-field participation."""
    has_non_field_trip = any(
        'non-field trip' in str(assignment.get('name') or '').lower()
        for assignment in snapshot.get('assignments') or []
    )
    if not has_non_field_trip:
        return

    file_lookup = _build_file_lookup(snapshot.get('files') or [])
    for module in snapshot.get('modules') or []:
        module_id = str(module.get('id') or '')
        items = (snapshot.get('module_items') or {}).get(module_id) or []
        titles = [
            _module_item_name(item, file_lookup)
            for item in items
            if _module_item_name(item, file_lookup)
        ]
        combined = ' '.join(titles).lower()
        if 'chinatown' not in combined:
            continue
        if (
            'youth against displacement' not in combined
            and 'field trip' not in combined
            and 'fieldtrip' not in combined
        ):
            continue
        anchor = _parse_any_date(str(module.get('name') or ''), default_year=default_year)
        if not anchor:
            continue
        label = 'Chinatown Fieldtrip – Tour with Youth against Displacement'
        if 'new york' in combined:
            label = 'New York Chinatown Fieldtrip – Tour with Youth against Displacement'
        add_event(bucket_for(anchor, use_canvas_local=True), label)


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
    for file_item in snapshot.get('files') or []:
        name = _display_file_name(file_item)
        if not REVIEW_FINAL_FILE_PATTERN.search(name):
            continue
        for field in ('updated_at', 'created_at'):
            parsed = _parse_any_date(str(file_item.get(field) or ''), default_year=default_year)
            if parsed:
                return _canvas_week_start(parsed)
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
    body = (snapshot.get('course') or {}).get('syllabus_body') or ''
    schedule_year = _resolve_schedule_year(snapshot, default_year)
    if body and schedule_year:
        flat = re.sub(r'\s+', ' ', _strip_html(body))
        for match in SYLLABUS_FINAL_EXAM_PATTERN.finditer(flat):
            month = _month_token_to_number(match.group(1))
            if not month:
                continue
            parsed = _md_from_parts(month, int(match.group(2)), schedule_year)
            if parsed:
                return _canvas_week_start(parsed)
    class_dates = _build_class_number_date_map(snapshot, default_year)
    if class_dates:
        last_class = max(class_dates.values())
        return _canvas_week_start(last_class) + timedelta(weeks=2)
    if _snapshot_has_take_home_midterm(snapshot):
        course = snapshot.get('course') or {}
        term = course.get('term') or {}
        haystack = f'{term.get("name") or ""} {course.get("name") or ""}'.lower()
        if 'fall' in haystack:
            term_end = _parse_any_date(str(term.get('end_at') or ''), default_year=default_year)
            if term_end:
                return _canvas_week_start(term_end - timedelta(days=40))
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
    midterm_review_num: int = 8,
) -> datetime | None:
    if CLASS_NOTES_MODULE_PATTERN.search(str(module_name or '')):
        lec_match = NUMBERED_LECTURE_ITEM_PATTERN.match(str(file_name or '').strip())
        if lec_match:
            return _resolve_numbered_lecture_week(
                int(lec_match.group(1)),
                snapshot,
                default_year,
                midterm_review_num=midterm_review_num,
            )

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


def _is_spring_term(snapshot: dict[str, Any]) -> bool:
    course = snapshot.get('course') or {}
    term = course.get('term') or {}
    haystack = f'{term.get("name") or ""} {course.get("name") or ""}'.lower()
    return 'spring' in haystack


def _spring_instruction_week_start(default_year: int | None) -> datetime | None:
    if not default_year:
        return None
    try:
        anchor = datetime(default_year, 1, 27, 12, 0, tzinfo=LOCAL_TZ)
        return _monday_start(anchor).replace(tzinfo=None)
    except ValueError:
        return None


def _uses_spring_instruction_anchor(snapshot: dict[str, Any]) -> bool:
    return _snapshot_uses_week_part_files(snapshot) or _snapshot_uses_numbered_class_notes(snapshot)


def _topic_week_with_break_offset(topic_week: int) -> int:
    if topic_week >= 6:
        return topic_week + 2
    return topic_week


def _lecture_number_to_calendar_week(lecture_num: int, *, midterm_review_num: int) -> int:
    if lecture_num <= 7:
        return lecture_num // 2 + 1
    if lecture_num == midterm_review_num:
        return 5
    if lecture_num == midterm_review_num + 1:
        return 6
    offset = lecture_num - (midterm_review_num + 2)
    return 7 + max(offset // 2, 0)


def _quiz_number_to_article_week(quiz_num: int) -> int:
    if quiz_num <= 5:
        return quiz_num
    return quiz_num + 2


def _detect_midterm_review_lecture_num(
    items: list[dict[str, Any]],
    file_lookup: dict[str, dict[str, Any]],
) -> int:
    for item in items:
        name = _module_item_name(item, file_lookup) or ''
        if re.search(r'midterm review', name, re.IGNORECASE):
            match = NUMBERED_LECTURE_ITEM_PATTERN.match(name)
            if match:
                return int(match.group(1))
    return 8


def _resolve_numbered_lecture_week(
    lecture_num: int,
    snapshot: dict[str, Any],
    default_year: int | None,
    *,
    midterm_review_num: int = 8,
) -> datetime | None:
    calendar_week = _lecture_number_to_calendar_week(
        lecture_num,
        midterm_review_num=midterm_review_num,
    )
    return _week_start_from_course_week_number(calendar_week, snapshot, default_year)


def _is_solution_hw_file(name: str) -> bool:
    return bool(re.search(r'(?:^|_)SOL(?:[._]|$)', str(name or ''), re.IGNORECASE))


def _week_from_hw_module_file(
    name: str,
    snapshot: dict[str, Any],
    default_year: int | None,
) -> datetime | None:
    match = MODULE_HW_FILE_PATTERN.search(str(name or ''))
    if not match:
        return None
    hw_num = int(match.group(1))
    is_sol = _is_solution_hw_file(name)
    if _snapshot_uses_numbered_class_notes(snapshot):
        if hw_num >= 7:
            calendar_week = hw_num + (4 if is_sol else 3)
        elif hw_num == 6:
            calendar_week = 9 if is_sol else 7
        elif hw_num == 5:
            calendar_week = 6 if not is_sol else 7
        elif is_sol:
            calendar_week = hw_num + 1
        else:
            calendar_week = hw_num
        return _week_start_from_course_week_number(calendar_week, snapshot, default_year)
    if is_sol:
        hw_num += 1
    return _week_start_from_course_week_number(hw_num, snapshot, default_year)


def _homework_assignment_week(
    hw_num: int,
    snapshot: dict[str, Any],
    default_year: int | None,
) -> datetime | None:
    if _snapshot_uses_numbered_class_notes(snapshot):
        if hw_num >= 6:
            calendar_week = hw_num + 3
        elif hw_num == 5:
            calendar_week = 6
        elif hw_num <= 2:
            calendar_week = hw_num
        else:
            calendar_week = hw_num + 1
        return _week_start_from_course_week_number(calendar_week, snapshot, default_year)
    return _week_start_from_course_week_number(hw_num, snapshot, default_year)


def _infer_reading_period_start(
    snapshot: dict[str, Any],
    default_year: int | None,
) -> datetime | None:
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').lower()
        if 'final homework' in name or name == 'final exam':
            parsed = _parse_any_date(assignment.get('due_at') or '', default_year=default_year)
            if parsed:
                return _naive_week_start(parsed) - timedelta(weeks=1)
    final_week = _infer_final_exam_week(snapshot, default_year=default_year)
    if final_week:
        return _naive_week_start(final_week) - timedelta(weeks=1)
    first_start = _infer_first_week_start(snapshot, default_year)
    if first_start and _is_spring_term(snapshot):
        return first_start + timedelta(weeks=13)
    return None


def _collect_study_file_names(snapshot: dict[str, Any]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for file_item in snapshot.get('files') or []:
        name = _display_file_name(file_item)
        if not name or not STUDY_FILE_PATTERN.search(name):
            continue
        if name not in seen:
            seen.add(name)
            names.append(name)
    return names


def _infer_term_short_code(snapshot: dict[str, Any], default_year: int | None) -> str | None:
    if not default_year:
        return None
    yy = str(default_year)[-2:]
    if _is_spring_term(snapshot):
        return f'SP{yy}'
    term = (snapshot.get('course') or {}).get('term') or {}
    if 'fall' in str(term.get('name') or '').lower():
        return f'FA{yy}'
    return None


def _snapshot_uses_numbered_class_notes(snapshot: dict[str, Any]) -> bool:
    file_lookup = _build_file_lookup(snapshot.get('files') or [])
    for module in snapshot.get('modules') or []:
        if not CLASS_NOTES_MODULE_PATTERN.search(str(module.get('name') or '')):
            continue
        module_id = str(module.get('id') or '')
        for item in (snapshot.get('module_items') or {}).get(module_id) or []:
            item_name = _module_item_name(item, file_lookup) or ''
            if NUMBERED_LECTURE_ITEM_PATTERN.match(item_name):
                return True
    return False


def _is_author_article_file(name: str) -> bool:
    return bool(AUTHOR_ARTICLE_FILE_PATTERN.match(str(name or '').strip()))


def _resolve_exam_module_file_week(
    name: str,
    module_name: str,
    snapshot: dict[str, Any],
    default_year: int | None,
) -> datetime | None:
    module_text = str(module_name or '').strip()
    raw_name = str(name or '')
    term_code = _infer_term_short_code(snapshot, default_year)
    if term_code and term_code.lower() in raw_name.lower():
        if MIDTERM_EXAM_MODULE_PATTERN.search(module_text) and re.search(r'midterm', raw_name, re.IGNORECASE):
            return _week_start_from_course_week_number(6, snapshot, default_year)
        if FINAL_EXAM_MODULE_PATTERN.search(module_text) and re.search(r'final', raw_name, re.IGNORECASE):
            return _week_start_from_course_week_number(14, snapshot, default_year)
    if SYLLABUS_MODULE_PATTERN.match(module_text):
        return _week_start_from_course_week_number(1, snapshot, default_year)
    return None


def _snapshot_uses_week_part_files(snapshot: dict[str, Any]) -> bool:
    count = 0
    for file_item in snapshot.get('files') or []:
        name = _display_file_name(file_item)
        if WEEK_PART_FILE_PATTERN.match(str(name or '')):
            count += 1
            if count >= 2:
                return True
    return False


def _bucket_quiz_article_files(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    bucket_for,
    add_file,
) -> set[str]:
    placed: set[str] = set()
    author_files: dict[str, str] = {}
    author_file_ids: dict[str, int] = {}
    for file_item in snapshot.get('files') or []:
        name = _display_file_name(file_item)
        match = re.match(r'^([A-Za-z]+)_\d{4}\.', str(name or ''))
        if match:
            author_files[match.group(1).lower()] = name
            author_file_ids[name] = int(file_item.get('id') or 0)
        prefix_match = re.match(r'^(memory\d*)_', str(name or ''), re.IGNORECASE)
        if prefix_match:
            author_files[prefix_match.group(1).lower()] = name
            author_file_ids[name] = int(file_item.get('id') or 0)

    def _place_file(week_start: datetime | None, file_name: str) -> None:
        if not week_start or not file_name or file_name in placed:
            return
        _add_weekly_files(bucket_for(week_start), add_file, file_name)
        placed.add(file_name)

    for assignment in snapshot.get('assignments') or []:
        title = str(assignment.get('name') or '').strip()
        quiz_match = QUIZ_ARTICLE_PATTERN.match(title)
        if not quiz_match:
            continue
        week_num = _quiz_number_to_article_week(int(quiz_match.group(1)))
        week_start = _week_start_from_course_week_number(week_num, snapshot, default_year)
        if not week_start:
            continue
        matched = False
        for token in re.findall(r'[A-Za-z]+', title):
            lowered = token.lower()
            if len(lowered) < 4 or lowered in {'quiz', 'article', 'python', 'notebook', 'upload', 'figure', 'memory'}:
                continue
            file_name = author_files.get(lowered)
            if file_name:
                _place_file(week_start, file_name)
                matched = True
                break
        if matched:
            continue
        topic_match = re.search(r':\s*(.+)', title)
        if topic_match:
            topic_text = topic_match.group(1).lower()
            topic_words = [token.lower() for token in re.findall(r'[A-Za-z]{4,}', topic_match.group(1))]
            for author_key, candidate in author_files.items():
                if candidate in placed:
                    continue
                lower_name = candidate.lower()
                if any(word in topic_text and (word in author_key or word in lower_name) for word in topic_words):
                    _place_file(week_start, candidate)
                    matched = True
                elif 'memory' in topic_text and author_key.startswith('memory'):
                    _place_file(week_start, candidate)
                    matched = True
    return placed


def _week_bucket_has_author_article(bucket: dict[str, Any]) -> bool:
    for row in bucket.get('files') or []:
        name = str(row.get('name') or '')
        if _is_author_article_file(name) or re.match(r'^memory\d+_', name, re.IGNORECASE):
            return True
    return False


def _snapshot_has_week_part_number(snapshot: dict[str, Any], part_num: int) -> bool:
    token = f'week{part_num}_part'
    for file_item in snapshot.get('files') or []:
        name = _display_file_name(file_item).lower()
        if token in name:
            return True
    return False


def _bucket_part_week_supplemental_authors(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    bucket_for,
    add_file,
    placed: set[str],
) -> None:
    if not _snapshot_uses_week_part_files(snapshot):
        return
    referenced = _referenced_file_ids(snapshot)
    pool: list[tuple[int, str]] = []
    for file_item in snapshot.get('files') or []:
        file_id = str(file_item.get('id') or '')
        if file_id and file_id in referenced:
            continue
        name = _display_file_name(file_item)
        if not name or name in placed or not _is_author_article_file(name):
            continue
        if SYLLABUS_FILE_PATTERN.search(name) or STUDY_FILE_PATTERN.search(name):
            continue
        pool.append((int(file_item.get('id') or 0), name))
    pool.sort(key=lambda row: row[0])
    available = [name for _, name in pool if name not in placed]

    for part_num in range(1, 20):
        if not _snapshot_has_week_part_number(snapshot, part_num):
            continue
        calendar_week = _topic_week_with_break_offset(part_num)
        week_start = _week_start_from_course_week_number(calendar_week, snapshot, default_year)
        if not week_start:
            continue
        bucket = bucket_for(week_start)
        if _week_bucket_has_author_article(bucket):
            continue
        if not available:
            break
        file_name = available.pop(0)
        _add_weekly_files(bucket, add_file, file_name)
        placed.add(file_name)


def _infer_instruction_week_start(snapshot: dict[str, Any], default_year: int | None) -> datetime | None:
    if _is_spring_term(snapshot) and default_year and _uses_spring_instruction_anchor(snapshot):
        course = snapshot.get('course') or {}
        term = course.get('term') or {}
        term_start = _parse_any_date(str(term.get('start_at') or ''), default_year=default_year)
        spring_start = _spring_instruction_week_start(default_year)
        if spring_start and term_start and term_start.month <= 2:
            return spring_start

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


def _md_from_parts(month: int, day: int, default_year: int | None) -> datetime | None:
    if not default_year:
        return None
    try:
        return datetime(default_year, month, day, tzinfo=timezone.utc)
    except ValueError:
        return None


def _parse_assignment_name_date(name: str, default_year: int | None) -> datetime | None:
    text = str(name or '').strip()
    if not text or not default_year:
        return None
    due_in_name = DUE_IN_NAME_PATTERN.search(text)
    if due_in_name:
        return _md_from_parts(int(due_in_name.group(1)), int(due_in_name.group(2)), default_year)
    paren_matches = list(PAREN_NUMERIC_MD_PATTERN.finditer(text))
    if paren_matches:
        last = paren_matches[-1]
        return _md_from_parts(int(last.group(1)), int(last.group(2)), default_year)
    trailing = TRAILING_MD_PATTERN.search(text)
    if trailing:
        return _md_from_parts(int(trailing.group(1)), int(trailing.group(2)), default_year)
    return None


def _compact_class_stem(name: str) -> str | None:
    match = COMPACT_CLASS_STEM_PATTERN.match(str(name or '').strip())
    if match:
        return match.group(1)
    return None


def _build_class_number_date_map(snapshot: dict[str, Any], default_year: int | None) -> dict[int, datetime]:
    mapping: dict[int, datetime] = {}
    for file_item in snapshot.get('files') or []:
        display_name = _display_file_name(file_item)
        parsed = _parse_filename_date(display_name, default_year)
        if not parsed:
            continue
        class_match = re.search(r'\bC(\d+)_', display_name, re.IGNORECASE)
        if class_match:
            mapping[int(class_match.group(1))] = parsed
    return mapping


def _add_weekly_files(bucket: dict[str, Any], add_file, name: str) -> None:
    display_name = str(name or '').strip()
    if not display_name:
        return
    add_file(bucket, display_name)
    stem = re.sub(r'\.[^.]+$', '', display_name).strip()
    if stem and stem.lower() != display_name.lower():
        add_file(bucket, stem)
    compact_stem = _compact_class_stem(display_name)
    if compact_stem and compact_stem.lower() not in {display_name.lower(), stem.lower()}:
        add_file(bucket, compact_stem)


def _w_module_event_title(module_name: str) -> str | None:
    text = str(module_name or '').strip()
    for pattern in (W_MODULE_TITLE_PATTERN, W_MODULE_SPACE_PATTERN):
        match = pattern.match(text)
        if match:
            return f'{match.group(3).strip()} ({match.group(2).strip()})'
    return None


def _snapshot_uses_w_module_weeks(snapshot: dict[str, Any]) -> bool:
    count = 0
    for module in snapshot.get('modules') or []:
        module_name = str(module.get('name') or '')
        if W_MODULE_TITLE_PATTERN.match(module_name) or W_MODULE_SPACE_PATTERN.match(module_name):
            count += 1
            if count >= 2:
                return True
    return False


def _snapshot_uses_compact_class_files(snapshot: dict[str, Any]) -> bool:
    count = 0
    for file_item in snapshot.get('files') or []:
        if COMPACT_CLASS_DATE_PATTERN.search(_display_file_name(file_item)):
            count += 1
            if count >= 3:
                return True
    return False


def _use_schedule_week_labels(snapshot: dict[str, Any]) -> bool:
    return _snapshot_uses_w_module_weeks(snapshot) or _snapshot_uses_compact_class_files(snapshot)


def _use_naive_week_boundary_labels(snapshot: dict[str, Any]) -> bool:
    return _uses_spring_instruction_anchor(snapshot)


def _w_module_date_implausible(parsed: datetime, snapshot: dict[str, Any]) -> bool:
    course = snapshot.get('course') or {}
    term = course.get('term') or {}
    term_start = _parse_any_date(str(term.get('start_at') or course.get('start_at') or ''))
    term_end = _parse_any_date(str(term.get('end_at') or course.get('end_at') or ''))
    if term_start and parsed < term_start - timedelta(days=21):
        return True
    if term_end and parsed > term_end + timedelta(days=21):
        return True
    term_name = str(term.get('name') or '').lower()
    if 'spring' in term_name and parsed.month >= 9:
        return True
    return False


def _w_module_assignment_anchor(
    week_num: int,
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
) -> datetime | None:
    due = _assignment_due_datetime(snapshot, rf'^W{week_num}\b', default_year=default_year)
    if not due:
        return None
    return _naive_week_start(due)


def _parse_w_module_anchor(
    module_name: str,
    default_year: int | None,
    snapshot: dict[str, Any] | None = None,
) -> datetime | None:
    for pattern in (W_MODULE_TITLE_PATTERN, W_MODULE_SPACE_PATTERN):
        match = pattern.match(str(module_name or '').strip())
        if not match or not default_year:
            continue
        week_num = int(match.group(1))
        dates_text = match.group(2)
        first_date = NUMERIC_MONTH_DAY_PATTERN.search(dates_text)
        if first_date:
            parsed = _md_from_parts(int(first_date.group(1)), int(first_date.group(2)), default_year)
            if parsed and snapshot and _w_module_date_implausible(parsed, snapshot):
                assignment_anchor = _w_module_assignment_anchor(
                    week_num,
                    snapshot,
                    default_year=default_year,
                )
                if assignment_anchor:
                    return assignment_anchor
            if parsed:
                return parsed
    return None


def _w_module_event_title_from_anchor(module_name: str, anchor: datetime) -> str | None:
    for pattern in (W_MODULE_TITLE_PATTERN, W_MODULE_SPACE_PATTERN):
        match = pattern.match(str(module_name or '').strip())
        if not match:
            continue
        title = match.group(3).strip()
        dates = list(NUMERIC_MONTH_DAY_PATTERN.finditer(match.group(2)))
        if len(dates) >= 2:
            first = dates[0]
            second = dates[1]
            day_gap = int(second.group(2)) - int(first.group(2))
            if day_gap < 0:
                day_gap += 7
            if day_gap <= 0 or day_gap > 7:
                day_gap = 2
            second_date = anchor + timedelta(days=day_gap)
            return (
                f'{title} ({int(anchor.month)}/{int(anchor.day)}, '
                f'{int(second_date.month)}/{int(second_date.day)})'
            )
        return f'{title} ({int(anchor.month)}/{int(anchor.day)})'
    return None


def _infer_w_module_midterm_date(snapshot: dict[str, Any], default_year: int | None) -> datetime | None:
    if not _snapshot_uses_w_module_weeks(snapshot) or not default_year:
        return None
    body = (snapshot.get('course') or {}).get('syllabus_body') or ''
    if not body:
        return None
    flat = re.sub(r'\s+', ' ', _strip_html(body))
    match = re.search(r'\bMidterm\s*\(([^)]+)\)', flat, re.IGNORECASE)
    if not match:
        return None
    dates = list(NUMERIC_MONTH_DAY_PATTERN.finditer(match.group(1)))
    if not dates:
        return None
    last = dates[-1]
    return _md_from_parts(int(last.group(1)), int(last.group(2)), default_year)


def _normalize_section_event_title(title: str) -> str:
    text = re.sub(r'\s+', ' ', str(title or '').strip())
    debate = re.match(r'Section:\s*Debate\s*\(Round\s*(\d+)\)', text, re.IGNORECASE)
    if debate:
        return f'Section: Debate Round {debate.group(1)}'
    return text


def _format_section_event_label(title: str, parsed: datetime) -> str:
    normalized = _normalize_section_event_title(title)
    if not re.search(r'\bsection:', normalized, re.IGNORECASE):
        return normalized
    date_suffix = f'({int(parsed.month)}/{int(parsed.day)})'
    if date_suffix in normalized:
        return normalized
    return f'{normalized} {date_suffix}'


def _syllabus_section_bucket_date(
    flat: str,
    match_end: int,
    parsed: datetime,
    snapshot: dict[str, Any],
    *,
    schedule_year: int | None,
    section_label: str = '',
) -> datetime:
    start = max(0, match_end - 100)
    end = min(len(flat), match_end + 80)
    window = flat[start:end]
    pivot = match_end - start
    ps_dates = dict(_sorted_problem_set_due_dates(snapshot, default_year=schedule_year))
    calendar_week = _canvas_week_start(parsed)
    debate_round_2 = re.search(r'Debate\s*\(Round\s*2\)', section_label, re.IGNORECASE) is not None

    def _linked_week(ps_number: int | None) -> datetime | None:
        if ps_number and ps_number in ps_dates:
            return _canvas_week_start(ps_dates[ps_number])
        return None

    forward_match = re.search(r'\bPS\s*(\d+)\b', window[pivot:pivot + 80], re.IGNORECASE)
    if debate_round_2 and forward_match:
        forward_week = _linked_week(int(forward_match.group(1)))
        if forward_week and forward_week > calendar_week + timedelta(days=3):
            return forward_week

    backward_matches = list(re.finditer(r'\bPS\s*(\d+)\b', window[:pivot], re.IGNORECASE))
    if backward_matches and not debate_round_2:
        backward_week = _linked_week(int(backward_matches[-1].group(1)))
        if backward_week:
            return backward_week

    return parsed


def _extract_syllabus_schedule_events(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
) -> list[tuple[str, datetime]]:
    body = (snapshot.get('course') or {}).get('syllabus_body') or ''
    schedule_year = _resolve_schedule_year(snapshot, default_year)
    if not body or not schedule_year:
        return []
    flat = re.sub(r'\s+', ' ', _strip_html(body))
    events: list[tuple[str, datetime]] = []
    seen: set[tuple[str, str]] = set()

    def _append(label: str, month_token: str, day_text: str, *, match_end: int = 0) -> None:
        month = _month_token_to_number(month_token)
        if not month:
            return
        parsed = _md_from_parts(month, int(day_text), schedule_year)
        if not parsed:
            return
        normalized = _format_section_event_label(label.strip(), parsed)
        bucket_date = _syllabus_section_bucket_date(
            flat,
            match_end,
            parsed,
            snapshot,
            schedule_year=schedule_year,
            section_label=label.strip(),
        )
        key = (normalized.casefold(), _week_start_label(_monday_start(bucket_date)).casefold())
        if key in seen:
            return
        seen.add(key)
        events.append((normalized, bucket_date))

    for match in SYLLABUS_SECTION_EVENT_PATTERN.finditer(flat):
        _append(match.group(3), match.group(1), match.group(2), match_end=match.end())

    guest_dates: dict[str, datetime] = {}
    for match in SYLLABUS_GUEST_LECTURER_PATTERN.finditer(flat):
        guest_name = match.group(3).strip()
        month = _month_token_to_number(match.group(1))
        if not month:
            continue
        parsed = _md_from_parts(month, int(match.group(2)), schedule_year)
        if parsed and guest_name:
            guest_dates[guest_name.casefold()] = parsed

    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').strip()
        if not name.lower().startswith('economics in action attendance'):
            continue
        guest_match = re.search(r'\(([^)]+)\)', name)
        if not guest_match:
            continue
        guest_name = guest_match.group(1).strip()
        parsed = guest_dates.get(guest_name.casefold())
        if not parsed:
            last_name = guest_name.split()[-1].casefold()
            parsed = next(
                (date for key, date in guest_dates.items() if key.endswith(last_name) or last_name in key),
                None,
            )
        if not parsed:
            continue
        label = f'Economics in Action: {guest_name} ({int(parsed.month)}/{int(parsed.day)})'
        key = (label.casefold(), _week_start_label(_monday_start(parsed)).casefold())
        if key in seen:
            continue
        seen.add(key)
        events.append((label, parsed))

    for match in SYLLABUS_MIDTERM_PATTERN.finditer(flat):
        month = _month_token_to_number(match.group(1))
        if not month:
            continue
        parsed = _md_from_parts(month, int(match.group(2)), schedule_year)
        if parsed:
            label = f'Midterm Exam ({int(parsed.month)}/{int(parsed.day)})'
            key = (label.casefold(), _week_start_label(_monday_start(parsed)).casefold())
            if key not in seen:
                seen.add(key)
                events.append((label, parsed))

    for match in SYLLABUS_FINAL_EXAM_PATTERN.finditer(flat):
        month = _month_token_to_number(match.group(1))
        if not month:
            continue
        parsed = _md_from_parts(month, int(match.group(2)), schedule_year)
        if parsed:
            label = 'Final Exam (5/8, 2:00 p.m.)' if parsed.month == 5 and parsed.day == 8 else f'Final Exam ({int(parsed.month)}/{int(parsed.day)})'
            key = (label.casefold(), _week_start_label(_monday_start(parsed)).casefold())
            if key not in seen:
                seen.add(key)
                events.append((label, parsed))

    return events


def _sorted_problem_set_due_dates(snapshot: dict[str, Any], *, default_year: int | None) -> list[tuple[int, datetime]]:
    rows: list[tuple[int, datetime]] = []
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').strip()
        if not name or not assignment.get('due_at'):
            continue
        if re.search(r'\b(?:mylab|resubmission)\b', name, re.IGNORECASE):
            continue
        match = re.match(r'^Problem Set\s+(\d+)\b', name, re.IGNORECASE)
        if not match:
            continue
        parsed = _parse_any_date(assignment.get('due_at') or '', default_year=default_year)
        if parsed:
            parsed = _align_datetime_year(parsed, default_year)
            rows.append((int(match.group(1)), parsed))
    rows.sort(key=lambda row: row[0])
    return rows


def _infer_economics_in_action_events(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    bucket_for,
    add_event,
) -> None:
    if not any(
        ECON_IN_ACTION_MODULE_PATTERN.search(str(module.get('name') or ''))
        for module in (snapshot.get('modules') or [])
    ):
        return
    schedule_year = _resolve_schedule_year(snapshot, default_year)
    if not schedule_year:
        return
    ps_dates = _sorted_problem_set_due_dates(snapshot, default_year=schedule_year)
    if not ps_dates:
        return
    ps_by_number = {number: due for number, due in ps_dates}
    reflection_dates: dict[str, datetime] = {}
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').strip()
        if not name.lower().startswith('economics in action reflection'):
            continue
        due = assignment.get('due_at') or ''
        parsed = _parse_any_date(due, default_year=schedule_year)
        if not parsed:
            continue
        parsed = _align_datetime_year(parsed, schedule_year)
        guest_match = re.search(r'\(([^)]+)\)', name)
        if guest_match:
            reflection_dates[guest_match.group(1).strip().casefold()] = parsed
    attendance_names: list[str] = []
    for module in snapshot.get('modules') or []:
        if not ECON_IN_ACTION_MODULE_PATTERN.search(str(module.get('name') or '')):
            continue
        module_id = str(module.get('id') or '')
        items = (snapshot.get('module_items') or {}).get(module_id) or []
        for item in sorted(items, key=lambda row: row.get('position') or 0):
            if str(item.get('type') or '').lower() not in {'assignment', 'quiz'}:
                continue
            title = str(item.get('title') or item.get('name') or '').strip()
            if not title.lower().startswith('economics in action attendance'):
                continue
            attendance_names.append(title)
    if not attendance_names:
        return
    start_ps = 3 if 3 in ps_by_number else ps_dates[0][0]
    for index, title in enumerate(attendance_names):
        ps_number = start_ps + index
        guest_match = re.search(r'\(([^)]+)\)', title)
        guest_name = guest_match.group(1).strip() if guest_match else title
        parsed = reflection_dates.get(guest_name.casefold())
        if parsed:
            reflection_event = parsed - timedelta(days=7)
            ps_parsed = ps_by_number.get(ps_number)
            if ps_parsed and abs((reflection_event - ps_parsed).days) > 10:
                parsed = reflection_event
            elif ps_parsed:
                parsed = ps_parsed
            else:
                parsed = reflection_event
        else:
            parsed = ps_by_number.get(ps_number)
        if not parsed and index < len(ps_dates):
            parsed = ps_dates[index][1]
        if not parsed:
            continue
        label = f'Economics in Action: {guest_name} ({int(parsed.month)}/{int(parsed.day)})'
        add_event(bucket_for(parsed, use_canvas_local=True), label)


def _infer_compact_class_quizzes(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    class_dates: dict[int, datetime],
    bucket_for,
    add_event,
) -> None:
    for assignment in snapshot.get('assignments') or []:
        name = str(assignment.get('name') or '').strip()
        if assignment.get('due_at'):
            continue
        match = NUMBERED_QUIZ_ASSIGNMENT_PATTERN.match(name)
        if not match:
            continue
        quiz_num = int(match.group(1))
        if quiz_num >= 3:
            anchor = class_dates.get(4 * quiz_num + 4) or class_dates.get(4 * quiz_num + 3)
        else:
            anchor = class_dates.get(4 * quiz_num + 3) or class_dates.get(4 * quiz_num + 4)
        if not anchor:
            continue
        add_event(bucket_for(anchor, use_canvas_local=False), name)


def _infer_class_script_files(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    class_dates: dict[int, datetime],
    bucket_for,
    add_file,
) -> None:
    referenced = _referenced_file_ids(snapshot)
    for file_item in snapshot.get('files') or []:
        file_id = str(file_item.get('id') or '')
        if file_id and file_id in referenced:
            continue
        name = _display_file_name(file_item)
        script_match = CLASS_SCRIPT_FILE_PATTERN.match(name)
        if not script_match:
            continue
        class_num = int(script_match.group(1))
        parsed = class_dates.get(class_num)
        if parsed:
            _add_weekly_files(bucket_for(parsed, use_canvas_local=False), add_file, name)


def _infer_supplemental_m_files(
    snapshot: dict[str, Any],
    *,
    class_dates: dict[int, datetime],
    bucket_for,
    add_file,
) -> None:
    if not class_dates:
        return
    referenced = _referenced_file_ids(snapshot)
    orphans: list[str] = []
    for file_item in snapshot.get('files') or []:
        file_id = str(file_item.get('id') or '')
        if file_id and file_id in referenced:
            continue
        name = _display_file_name(file_item)
        if not name.lower().endswith('.m'):
            continue
        if CLASS_SCRIPT_FILE_PATTERN.match(name) or UTILITY_M_FILE_PATTERN.match(name):
            continue
        orphans.append(name)
    if not orphans:
        return
    myode_date = class_dates.get(14)
    for name in sorted(set(orphans)):
        if MYODE_SCRIPT_FILE_PATTERN.match(name) and myode_date:
            _add_weekly_files(bucket_for(myode_date, use_canvas_local=False), add_file, name)
            continue
    remaining = sorted(name for name in set(orphans) if not MYODE_SCRIPT_FILE_PATTERN.match(name))
    script_classes = sorted(class_dates)
    if len(script_classes) > 2:
        script_classes = script_classes[:-2]
    for index, name in enumerate(remaining):
        anchor_class = script_classes[-len(remaining) + index]
        parsed = class_dates.get(anchor_class)
        if parsed:
            _add_weekly_files(bucket_for(parsed, use_canvas_local=False), add_file, name)


def _infer_review_final_files(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    final_exam_week: datetime | None,
    bucket_for,
    add_file,
) -> None:
    if not final_exam_week:
        return
    bucket = bucket_for(final_exam_week, use_canvas_local=True)
    referenced = _referenced_file_ids(snapshot)
    for file_item in snapshot.get('files') or []:
        file_id = str(file_item.get('id') or '')
        if file_id and file_id in referenced:
            continue
        name = _display_file_name(file_item)
        if REVIEW_FINAL_FILE_PATTERN.search(name):
            _add_weekly_files(bucket, add_file, name)


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
    if not due:
        parsed = _parse_assignment_name_date(entry['name'], default_year)
        if parsed:
            due = f'{parsed.month}/{parsed.day}/{parsed.year}'
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


def _leading_md_bucket_date(name: str, parsed: datetime) -> datetime:
    if DRILL_MIDTERM_REVIEW_FILE_PATTERN.search(str(name or '')):
        aware = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        return _monday_start(aware) - timedelta(days=7)
    return parsed


def _align_datetime_year(value: datetime, year: int | None) -> datetime:
    if not year or not value:
        return value
    return value.replace(year=year)


def _bucket_use_canvas_local(name: str, parsed: datetime | None = None) -> bool:
    text = str(name or '')
    if COMPACT_CLASS_DATE_PATTERN.search(text):
        return False
    if COMPACT_CLASS_STEM_PATTERN.match(text):
        return False
    if CLASS_CODE_FILE_PATTERN.match(text):
        return False
    if CLASS_SCRIPT_FILE_PATTERN.match(text):
        return False
    return True


def _parse_filename_date(name: str, default_year: int | None) -> datetime | None:
    raw = str(name or '').strip()
    leading = LEADING_MD_FILENAME_PATTERN.match(raw)
    if leading and default_year:
        parsed = _md_from_parts(int(leading.group(1)), int(leading.group(2)), default_year)
        if parsed:
            return _leading_md_bucket_date(raw, parsed)
    compact = COMPACT_CLASS_DATE_PATTERN.search(raw)
    if compact:
        month = int(compact.group(1))
        day = int(compact.group(2))
        year = int(compact.group(3))
        try:
            return datetime(year, month, day, tzinfo=timezone.utc)
        except ValueError:
            pass
    text = _normalize_pdf_display_name(name)
    compact = COMPACT_CLASS_DATE_PATTERN.search(text.replace(' ', '_'))
    if compact:
        month = int(compact.group(1))
        day = int(compact.group(2))
        year = int(compact.group(3))
        try:
            return datetime(year, month, day, tzinfo=timezone.utc)
        except ValueError:
            pass
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


def _week_start_from_course_week_number(
    week_num: int,
    snapshot: dict[str, Any],
    default_year: int | None,
) -> datetime | None:
    if week_num <= 0:
        return None
    first_start = _infer_first_week_start(snapshot, default_year)
    if first_start:
        return first_start + timedelta(weeks=week_num - 1)
    base = _first_content_week_start(default_year)
    if base:
        return base + timedelta(weeks=week_num - 1)
    return None


def _referenced_file_ids(snapshot: dict[str, Any]) -> set[str]:
    referenced: set[str] = set()
    for items in (snapshot.get('module_items') or {}).values():
        for item in items:
            if str(item.get('type') or '').lower() == 'file':
                file_id = str(item.get('content_id') or '')
                if file_id:
                    referenced.add(file_id)
    return referenced


def _display_file_name(file_item: dict[str, Any]) -> str:
    return str(
        file_item.get('display_name')
        or file_item.get('filename')
        or ''
    ).strip()


def _bucket_named_file_item(
    name: str,
    *,
    default_year: int | None,
    snapshot: dict[str, Any] | None,
    bucket_for,
    add_file,
    add_event,
) -> None:
    raw_name = str(name or '').strip()
    normalized = _normalize_pdf_display_name(raw_name)
    parsed = (
        _parse_filename_date(raw_name, default_year)
        or _parse_embedded_event_date(normalized, default_year)
        or _parse_filename_date(normalized, default_year)
    )
    if not parsed and snapshot:
        week_match = re.search(r'\bW(\d+)\b', raw_name, re.IGNORECASE)
        if not week_match:
            week_match = re.search(r'\bW(\d+)\b', normalized, re.IGNORECASE)
        if week_match:
            parsed = _week_start_from_course_week_number(int(week_match.group(1)), snapshot, default_year)
    week_part_match = WEEK_PART_FILE_PATTERN.match(raw_name)
    if not parsed and week_part_match and snapshot:
        calendar_week = _topic_week_with_break_offset(int(week_part_match.group(1)))
        parsed = _week_start_from_course_week_number(calendar_week, snapshot, default_year)
    if not parsed and SYLLABUS_FILE_PATTERN.search(raw_name) and snapshot:
        parsed = _week_start_from_course_week_number(1, snapshot, default_year)
    if not parsed and STUDY_FILE_PATTERN.search(raw_name) and snapshot:
        parsed = _infer_reading_period_start(snapshot, default_year)
    if (
        not parsed
        and snapshot
        and _snapshot_uses_w_module_weeks(snapshot)
        and re.search(r'3d production', raw_name, re.IGNORECASE)
    ):
        w7_due = _assignment_due_datetime(snapshot, r'^W7\b', default_year=default_year)
        if w7_due:
            parsed = _naive_week_start(w7_due)
    if not parsed:
        return
    use_local = _bucket_use_canvas_local(raw_name)
    if snapshot and _snapshot_uses_w_module_weeks(snapshot):
        if re.search(r'\bW(\d+)\b', raw_name, re.IGNORECASE) or re.search(
            r'3d production', raw_name, re.IGNORECASE
        ):
            use_local = False
    bucket = bucket_for(parsed, use_canvas_local=use_local)
    if SECTION_EVENT_FILE_PATTERN.search(normalized) or HOLIDAY_EVENT_PATTERN.search(normalized):
        add_event(bucket, raw_name)
        return
    if LECTURE_FILE_PATTERN.search(normalized):
        add_file(bucket, raw_name)
        return
    _add_weekly_files(bucket, add_file, raw_name)


def _bucket_orphan_files(
    snapshot: dict[str, Any],
    *,
    default_year: int | None,
    bucket_for,
    add_file,
    add_event,
) -> None:
    referenced = _referenced_file_ids(snapshot)
    for file_item in snapshot.get('files') or []:
        file_id = str(file_item.get('id') or '')
        if file_id and file_id in referenced:
            continue
        name = _display_file_name(file_item)
        if not name:
            continue
        _bucket_named_file_item(
            name,
            default_year=default_year,
            snapshot=snapshot,
            bucket_for=bucket_for,
            add_file=add_file,
            add_event=add_event,
        )


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
    if module_num == 0:
        return _week_start_from_course_week_number(1, snapshot, default_year)
    first_week = _infer_first_week_start(snapshot, default_year) or _first_content_week_start(default_year)
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
    for field in ('due_at', 'unlock_at', 'lock_at'):
        if canvas_entity and canvas_entity.get(field):
            parsed = _parse_any_date(canvas_entity[field], default_year=default_year)
            if parsed:
                return parsed
    parsed = _parse_filename_date(name, default_year)
    if parsed:
        return parsed
    precept_match = PRECEPT_FILE_PATTERN.match(str(name or '').strip())
    if precept_match and snapshot:
        return _week_start_from_course_week_number(int(precept_match.group(1)), snapshot, default_year)
    hw_week = _week_from_hw_module_file(name, snapshot, default_year)
    if hw_week:
        return hw_week
    week_part_match = WEEK_PART_FILE_PATTERN.match(str(name or '').strip())
    if week_part_match and snapshot:
        calendar_week = _topic_week_with_break_offset(int(week_part_match.group(1)))
        return _week_start_from_course_week_number(calendar_week, snapshot, default_year)
    if snapshot and SYLLABUS_FILE_PATTERN.search(str(name or '')):
        return _week_start_from_course_week_number(1, snapshot, default_year)
    if snapshot:
        exam_week = _resolve_exam_module_file_week(name, module_name or '', snapshot, default_year)
        if exam_week:
            return exam_week
    if snapshot and re.search(r'\bmidterm study guide\b', module_name or '', re.IGNORECASE):
        midterm_date = _infer_w_module_midterm_date(snapshot, default_year)
        if midterm_date:
            return _naive_week_start(midterm_date)
    w_module_anchor = _parse_w_module_anchor(module_name, default_year, snapshot)
    if w_module_anchor:
        return w_module_anchor
    week_prefix = WEEK_PREFIX_MODULE_PATTERN.match(module_name or '')
    if week_prefix and snapshot:
        week_num = int(week_prefix.group(1))
        resolved = _week_start_from_course_week_number(week_num, snapshot, default_year)
        if resolved:
            return resolved
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
    for field in ('updated_at', 'created_at'):
        if canvas_entity and canvas_entity.get(field):
            parsed = _parse_any_date(canvas_entity[field], default_year=default_year)
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
        if not display:
            return
        if display in bucket['_event_names']:
            if files:
                for existing in bucket['events']:
                    if existing.get('name') != display:
                        continue
                    existing_files = {
                        row.get('name') for row in (existing.get('files') or []) if row.get('name')
                    }
                    for row in files:
                        row_name = row.get('name') or ''
                        if row_name and row_name not in existing_files:
                            existing.setdefault('files', []).append({'name': row_name})
            if files and display in {'Midterm Exam', 'Final Exam', 'Reading Period'}:
                for row in files:
                    add_file(bucket, row.get('name') or '')
            return
        bucket['_event_names'].add(display)
        entry: dict[str, Any] = {'name': display, 'files': files or []}
        bucket['events'].append(entry)
        if files and display in {'Midterm Exam', 'Final Exam', 'Reading Period'}:
            for row in files:
                row_name = row.get('name') or ''
                if row_name:
                    add_file(bucket, row_name)

    for assignment in categorized.get('assignments') or []:
        name = assignment.get('name') or ''
        due = assignment.get('due_at') or ''
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            use_local = True
            if re.search(
                r'\b(?:homework|dictation|review quiz|weekly response|critical|python notebook)\b',
                name,
                re.IGNORECASE,
            ):
                use_local = False
            weekly_response = re.match(r'^W(\d+)\s+Weekly Response\b', name, re.IGNORECASE)
            w_topic = re.match(r'^W(\d+)\b', name, re.IGNORECASE)
            if weekly_response:
                anchor = _week_start_from_course_week_number(
                    int(weekly_response.group(1)),
                    snapshot,
                    default_year,
                )
                if anchor:
                    add_assignment(bucket_for(anchor), name)
                    if ORAL_PRESENTATION_EVENT_PATTERN.search(name):
                        add_event(bucket_for(anchor), name)
                    elif normalize_event_type('', name) == 'test':
                        add_event(bucket_for(anchor), _exam_event_display_name(name))
                    continue
            if w_topic and _snapshot_uses_w_module_weeks(snapshot) and not weekly_response:
                use_local = False
            bucket = bucket_for(parsed, use_canvas_local=use_local)
            add_assignment(bucket, name)
            if ORAL_PRESENTATION_EVENT_PATTERN.search(name):
                add_event(bucket, name)
            elif normalize_event_type('', name) == 'test':
                add_event(bucket, _exam_event_display_name(name))

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

    for label, parsed in _extract_syllabus_schedule_events(snapshot, default_year=default_year):
        bucket = bucket_for(parsed, use_canvas_local=True)
        add_event(bucket, label)
        if re.search(r'\bmidterm exam\b', label, re.IGNORECASE):
            add_assignment(bucket, 'Midterm Exam')
        elif label.lower().startswith('final exam'):
            add_assignment(bucket, 'Final Exam')
        elif re.search(r'\bsection:\s*debate\b', label, re.IGNORECASE):
            add_assignment(bucket, 'Debate')

    _infer_economics_in_action_events(
        snapshot,
        default_year=default_year,
        bucket_for=bucket_for,
        add_event=add_event,
    )
    _infer_field_trip_events(
        snapshot,
        default_year=default_year,
        bucket_for=bucket_for,
        add_event=add_event,
    )

    for raw_assignment in snapshot.get('assignments') or []:
        if not _is_course_level_event(raw_assignment):
            continue
        name = str(raw_assignment.get('name') or '').strip()
        due = raw_assignment.get('due_at') or ''
        parsed = _parse_any_date(due, default_year=default_year)
        if parsed:
            bucket = bucket_for(parsed, use_canvas_local=True)
            add_event(bucket, _exam_event_display_name(name))
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

    _bucket_orphan_files(
        snapshot,
        default_year=default_year,
        bucket_for=bucket_for,
        add_file=add_file,
        add_event=add_event,
    )

    placed_articles: set[str] = _bucket_quiz_article_files(
        snapshot,
        default_year=default_year,
        bucket_for=bucket_for,
        add_file=add_file,
    )
    _bucket_part_week_supplemental_authors(
        snapshot,
        default_year=default_year,
        bucket_for=bucket_for,
        add_file=add_file,
        placed=placed_articles,
    )

    uses_class_notes = _snapshot_uses_numbered_class_notes(snapshot)
    uses_week_part = _snapshot_uses_week_part_files(snapshot)
    if uses_week_part or uses_class_notes:
        study_files = [{'name': name} for name in _collect_study_file_names(snapshot)]
        if uses_week_part:
            midterm_week = _week_start_from_course_week_number(6, snapshot, default_year)
            if midterm_week:
                add_event(bucket_for(midterm_week), 'University Midterm Period')
            spring_week = _week_start_from_course_week_number(7, snapshot, default_year)
            reading_week = _infer_reading_period_start(snapshot, default_year)
            final_week = _week_start_from_course_week_number(15, snapshot, default_year)
        else:
            spring_week = _week_start_from_course_week_number(8, snapshot, default_year)
            reading_week = _week_start_from_course_week_number(13, snapshot, default_year)
            final_week = _week_start_from_course_week_number(14, snapshot, default_year)
        if spring_week:
            add_event(bucket_for(spring_week), 'Spring Break')
        if reading_week:
            reading_bucket = bucket_for(reading_week)
            add_event(reading_bucket, 'Reading Period', study_files)
            for study_file in study_files:
                add_file(reading_bucket, study_file['name'])
        if uses_week_part:
            content_week = _week_start_from_course_week_number(13, snapshot, default_year)
            if content_week:
                for file_item in snapshot.get('files') or []:
                    name = _display_file_name(file_item)
                    if re.search(r'study[- ]guide', name, re.IGNORECASE):
                        add_file(bucket_for(content_week), name)
        if final_week:
            add_event(bucket_for(final_week), 'Final Exam', study_files)

    for raw_assignment in snapshot.get('assignments') or []:
        name = str(raw_assignment.get('name') or '').strip()
        if not name or raw_assignment.get('due_at'):
            continue
        parsed = _parse_assignment_name_date(name, default_year)
        if parsed:
            bucket = bucket_for(parsed, use_canvas_local=False)
            add_assignment(bucket, name)
            if ORAL_PRESENTATION_EVENT_PATTERN.search(name):
                add_event(bucket, name)
            elif normalize_event_type('', name) == 'test':
                add_event(bucket, name)
            elif re.search(r'\b(?:midterm|final)\s+(?:written|oral)\s+exam\b', name, re.IGNORECASE):
                add_event(bucket, name)
            continue
        ci_match = CLASS_CI_ASSIGNMENT_PATTERN.match(name)
        if ci_match:
            month = int(ci_match.group(1))
            day = int(ci_match.group(2))
            year = int(ci_match.group(3))
            try:
                parsed = datetime(year, month, day, tzinfo=timezone.utc)
                add_assignment(bucket_for(parsed, use_canvas_local=True), name)
            except ValueError:
                pass

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
        else:
            midterm_date = _infer_w_module_midterm_date(snapshot, default_year)
            if midterm_date and re.search(r'\bmidterm exam\b', name, re.IGNORECASE):
                bucket = bucket_for(midterm_date)
                add_assignment(bucket, name)
                add_event(
                    bucket,
                    f'Midterm Exam ({int(midterm_date.month)}/{int(midterm_date.day)})',
                )
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
            anchor = _parse_w_module_anchor(module_name, default_year, snapshot)
        if not anchor and re.search(r'\bmidterm study guide\b', module_name, re.IGNORECASE):
            midterm_due = _infer_w_module_midterm_date(snapshot, default_year)
            if not midterm_due:
                midterm_due = _assignment_due_datetime(snapshot, r'\bmidterm exam\b', default_year=default_year)
            if midterm_due:
                anchor = _naive_week_start(midterm_due)
        if not anchor:
            prefix = PREFIX_MODULE_PATTERN.match(module_name)
            if prefix:
                anchor = _week_start_from_module_number(int(prefix.group(1)), snapshot, default_year)
        if anchor:
            module_anchor_dates[module_id] = anchor
        w_event = _w_module_event_title_from_anchor(module_name, anchor) if anchor else _w_module_event_title(module_name)
        week_prefix = WEEK_PREFIX_MODULE_PATTERN.match(module_name) or W_MODULE_SPACE_PATTERN.match(module_name)
        if w_event and anchor:
            add_event(bucket_for(anchor), w_event)
        elif week_prefix and anchor:
            add_event(bucket_for(anchor), module_name.strip())
        elif ORIENTATION_MODULE_PATTERN.search(module_name) and anchor:
            add_event(bucket_for(anchor), module_name.strip())
        elif SPRING_BREAK_PATTERN.search(module_name) and anchor:
            add_event(bucket_for(anchor), 'Spring Break')

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
        if CLASS_NOTES_MODULE_PATTERN.search(module_name):
            paced_module_meta[module_id]['class_notes'] = True
            paced_module_meta[module_id]['midterm_review_num'] = _detect_midterm_review_lecture_num(
                items,
                file_lookup,
            )

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
        last_assignment_hw_week: datetime | None = None
        for item in sorted(items, key=lambda row: row.get('position') or 0):
            item_type = str(item.get('type') or '').lower()
            name = _module_item_name(item, file_lookup)
            if not name:
                continue
            if item_type == 'file' and (
                MIDTERM_EXAM_MODULE_PATTERN.search(module_name)
                or FINAL_EXAM_MODULE_PATTERN.search(module_name)
            ):
                term_code = _infer_term_short_code(snapshot, default_year)
                if term_code and term_code.lower() not in name.lower():
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
                    midterm_review_num=int(paced_meta.get('midterm_review_num') or 8),
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
            if (
                not resolved
                and re.fullmatch(r'data\.csv', str(name or ''), re.IGNORECASE)
                and last_assignment_hw_week is not None
            ):
                resolved = last_assignment_hw_week
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
                _add_weekly_files(bucket, add_file, name)
                hw_match = MODULE_HW_FILE_PATTERN.search(name)
                if hw_match and not _is_solution_hw_file(name):
                    hw_num = int(hw_match.group(1))
                    hw_week = _homework_assignment_week(hw_num, snapshot, default_year)
                    if hw_week:
                        last_assignment_hw_week = hw_week
                        add_assignment(
                            bucket_for(hw_week),
                            f'Homework {hw_num}',
                            [{'name': name}],
                        )
                solution_match = SOLUTION_FILE_PATTERN.search(name)
                if solution_match:
                    add_assignment(bucket, _pset_assignment_name(snapshot, int(solution_match.group(1))))
                if WORKSHOP_EVENT_PATTERN.search(name):
                    add_event(bucket, _workshop_event_name(name))
                if MIDTERM_REVIEW_FILE_PATTERN.search(name):
                    midterm_bucket = bucket
                    if resolved:
                        midterm_bucket = bucket_for(resolved + timedelta(weeks=1))
                    add_event(midterm_bucket, 'Midterm Exam', [{'name': name}])
                if re.search(r'\bfinal review\b', name, re.IGNORECASE):
                    final_week = _week_start_from_course_week_number(14, snapshot, default_year)
                    if final_week:
                        add_event(bucket_for(final_week), 'Final Exam', [{'name': name}])
                term_code = _infer_term_short_code(snapshot, default_year)
                if term_code and term_code.lower() in name.lower():
                    if MIDTERM_EXAM_MODULE_PATTERN.search(module_name) and re.search(r'midterm', name, re.IGNORECASE):
                        add_file(bucket, name)
                        add_event(bucket, 'Midterm Exam', [{'name': name}])
                    elif FINAL_EXAM_MODULE_PATTERN.search(module_name) and re.search(r'final', name, re.IGNORECASE):
                        add_file(bucket, name)
                        add_event(bucket, 'Final Exam', [{'name': name}])
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
    class_dates = _build_class_number_date_map(snapshot, default_year)
    _infer_compact_class_quizzes(
        snapshot,
        default_year=default_year,
        class_dates=class_dates,
        bucket_for=bucket_for,
        add_event=add_event,
    )
    _infer_class_script_files(
        snapshot,
        default_year=default_year,
        class_dates=class_dates,
        bucket_for=bucket_for,
        add_file=add_file,
    )
    _infer_supplemental_m_files(
        snapshot,
        class_dates=class_dates,
        bucket_for=bucket_for,
        add_file=add_file,
    )
    referenced = _referenced_file_ids(snapshot)
    for file_item in snapshot.get('files') or []:
        file_id = str(file_item.get('id') or '')
        if file_id and file_id in referenced:
            continue
        name = _display_file_name(file_item)
        code_match = CLASS_CODE_FILE_PATTERN.match(name)
        if not code_match:
            continue
        parsed = class_dates.get(int(code_match.group(1)))
        if parsed:
            _add_weekly_files(bucket_for(parsed, use_canvas_local=False), add_file, name)
    _infer_review_final_files(
        snapshot,
        default_year=default_year,
        final_exam_week=final_exam_week,
        bucket_for=bucket_for,
        add_file=add_file,
    )
    if final_exam_week:
        final_bucket = bucket_for(final_exam_week, use_canvas_local=True)
        add_event(final_bucket, 'Final Exam')
        for raw_assignment in snapshot.get('assignments') or []:
            name = str(raw_assignment.get('name') or '').strip()
            if name.lower() in {'final exam', 'final'} and not raw_assignment.get('due_at'):
                add_assignment(final_bucket, name)
        for module in snapshot.get('modules') or []:
            module_name = str(module.get('name') or '')
            if not re.search(r'\bfinal exam\b', module_name, re.IGNORECASE):
                continue
            module_id = str(module.get('id') or '')
            for item in (snapshot.get('module_items') or {}).get(module_id) or []:
                if str(item.get('type') or '').lower() != 'file':
                    continue
                file_name = _module_item_name(item, file_lookup)
                if file_name:
                    _add_weekly_files(final_bucket, add_file, file_name)

    if not buckets:
        return []

    earliest = min(dated_points)
    instruction_start = _infer_first_week_start(snapshot, default_year=default_year)
    if instruction_start:
        instruction_naive = (
            instruction_start.replace(tzinfo=None)
            if instruction_start.tzinfo
            else instruction_start
        )
        earliest = min(earliest, instruction_naive)
    latest = max(dated_points)
    if final_exam_week:
        latest = max(latest, final_exam_week.replace(tzinfo=None) if final_exam_week.tzinfo else final_exam_week)
    schedule: list[dict[str, Any]] = []
    use_schedule_labels = _use_schedule_week_labels(snapshot)
    final_week_key: str | None = None
    if final_exam_week and _snapshot_uses_compact_class_files(snapshot):
        final_start = _canvas_week_start(final_exam_week)
        final_week_key = final_start.replace(tzinfo=None).date().isoformat()
    cursor = _monday_start(
        earliest.replace(tzinfo=timezone.utc) if earliest.tzinfo is None else earliest
    ).replace(tzinfo=None)
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
        if use_schedule_labels:
            start_label = format_schedule_week_date(cursor, default_year=default_year)
            end_label = format_schedule_week_date(_week_end(cursor), default_year=default_year)
        elif _use_naive_week_boundary_labels(snapshot):
            start_label = format_week_boundary_date(cursor)
            end_label = format_week_boundary_date(_week_end(cursor))
        else:
            start_label = format_ground_truth_date(
                cursor.replace(tzinfo=timezone.utc).isoformat(),
                default_year=default_year,
            )
            end_label = format_ground_truth_date(
                _week_end(cursor).replace(tzinfo=timezone.utc).isoformat(),
                default_year=default_year,
            )
        week_name = 'Finals' if final_week_key and key == final_week_key else f'Week {week_index}'
        schedule.append({
            'name': week_name,
            'start_date': start_label,
            'end_date': end_label,
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
