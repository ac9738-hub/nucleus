"""Deterministic syllabus parsing: grades, due dates, schedule rows, policies."""

from __future__ import annotations

import re

from canvas_parser.content.page_blocks import compact_block_text
from canvas_parser.graph.events import (
    canonical_test_event_name,
    extract_prose_exam_hints,
    extract_syllabus_exam_hints,
    is_plausible_exam_date_text,
)
from canvas_parser.parse.heuristic_concepts import extract_syllabus_week_rows
from canvas_parser.weekly_iteration.match_utils import normalize_name

SYLLABUS_GRADE_LINE_PATTERN = re.compile(
    r'(?P<name>'
    r'(?:problem\s*sets?\s+\d+|problem\s*sets?\b|psets?\s+\d+|psets?\b|homework\s+\d+|homeworks|assignments?|'
    r'participation|attendance|labs?(?:\s+reports?)?|projects?|papers?|essays?|precepts?(?:\s+work)?|'
    r'midterm(?:\s+exam)?|final(?:\s+exam)?|quizzes?|exams?)'
    r'[^%\n]{0,20}?)'
    r'(?:[\s:–—\-]+|\s*\()\s*(?P<pct>\d{1,2})\s*%\)?',
    re.I,
)
SYLLABUS_GRADE_LEADING_PATTERN = re.compile(
    r'(?P<pct>\d{1,2})\s*%\s*(?:for\s+)?(?P<name>'
    r'(?:problem\s*sets?|psets?|homework|assignments?|participation|attendance|'
    r'labs?|projects?|midterm(?:\s+exam)?|final(?:\s+exam)?|quizzes?|exams?))',
    re.I,
)
SYLLABUS_TABLE_GRADE_PATTERN = re.compile(
    r'^(?P<name>[A-Za-z][A-Za-z\s/&\-]{2,42}?)\s+(?P<pct>\d{1,2})\s*%\s*$',
    re.I | re.M,
)
PARTICIPATION_GRADE_PATTERN = re.compile(
    r'\bparticipation\b[^%\n]{0,50}?(?P<pct>\d{1,2})\s*%',
    re.I,
)
SYLLABUS_DUE_PATTERN = re.compile(
    r'(?P<name>(?:problem\s*set|pset|homework|hw|assignment|lab(?:\s+report)?|'
    r'project|paper|essay|precept(?:\s+work)?)\s*[#\d]*[^.\n]{0,45}?)'
    r'(?:.{0,30}?\b(?:due|deadline)\b\s*[:：]?\s*)'
    r'(?P<date>'
    r'\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|'
    r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
    r'Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
    r'\.?\s+\d{1,2},?\s*(?:\d{4})?)',
    re.I,
)
SYLLABUS_EXAM_GRADE_PATTERN = re.compile(
    r'(?P<label>midterm(?:\s+exam)?|final(?:\s+exam)?|quiz(?:\s+\d+)?|exam(?:\s+\d+)?)'
    r'[^%\n]{0,100}?(?P<pct>\d{1,2})\s*%',
    re.I,
)
SYLLABUS_EXAM_DATE_GRADE_PATTERN = re.compile(
    r'(?P<label>midterm(?:\s+exam)?|final(?:\s+exam)?|quiz(?:\s+\d+)?)'
    r'(?:\s+on)?\s*[:：\-–—]?\s*'
    r'(?P<date>'
    r'\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|'
    r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
    r'Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
    r'\.?\s+\d{1,2},?\s*\d{4})'
    r'(?:[^\d%]{0,8}\(?\s*(?P<pct>\d{1,2})\s*%\)?)?',
    re.I,
)
GRADING_POLICY_BLOCK_PATTERN = re.compile(
    r'(?:grading\s+(?:policy|breakdown|scheme|components|criteria)|course\s+grades?)'
    r'[^\n]{0,40}\n(?P<body>(?:[^\n]+\n){1,12})',
    re.I,
)
ASSIGNMENT_COMPONENT_PATTERN = re.compile(
    r'\b(?:problem\s*set|pset|homework|hw|assignment|lab|project|paper|essay|precept)\b',
    re.I,
)
EXAM_COMPONENT_PATTERN = re.compile(
    r'\b(?:midterm|final|quiz|exam)\b',
    re.I,
)


def syllabus_plain_text(*, text: str = '', pages=None) -> str:
    body = str(text or '').strip()
    if body:
        return body
    parts: list[str] = []
    for page in pages or []:
        if isinstance(page, dict):
            chunk = str(page.get('text') or '').strip()
            if chunk:
                parts.append(chunk)
    return '\n'.join(parts)


def _clean_label(raw: str, *, max_length: int = 80) -> str:
    label = compact_block_text(str(raw or ''), max_length)
    return label.strip(' -:–—()[]')


def _valid_pct(raw: str) -> int | None:
    try:
        pct = int(str(raw).strip())
    except (TypeError, ValueError):
        return None
    if 1 <= pct <= 100:
        return pct
    return None


def _append_grade_row(rows: list[dict], seen: set[str], name: str, pct: int) -> None:
    cleaned = _clean_label(name)
    if not cleaned:
        return
    key = normalize_name(cleaned)
    if not key:
        return
    for existing in list(seen):
        if key == existing:
            return
        if key.startswith(existing + ' ') or existing.startswith(key + ' '):
            if len(key) > len(existing):
                seen.discard(existing)
                rows[:] = [row for row in rows if normalize_name(row['name']) != existing]
            else:
                return
    seen.add(key)
    rows.append({'name': cleaned, 'gradepercentage': pct})


def extract_syllabus_grade_components(text: str) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for pattern in (
        SYLLABUS_GRADE_LINE_PATTERN,
        SYLLABUS_GRADE_LEADING_PATTERN,
        SYLLABUS_TABLE_GRADE_PATTERN,
    ):
        for match in pattern.finditer(str(text or '')):
            pct = _valid_pct(match.group('pct'))
            if pct is None:
                continue
            _append_grade_row(rows, seen, match.group('name'), pct)
    return rows


def extract_syllabus_participation_grade(text: str) -> int | None:
    match = PARTICIPATION_GRADE_PATTERN.search(str(text or ''))
    if not match:
        return None
    return _valid_pct(match.group('pct'))


def extract_syllabus_assignment_dues(text: str) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for match in SYLLABUS_DUE_PATTERN.finditer(str(text or '')):
        name = _clean_label(match.group('name'))
        date_text = _clean_label(match.group('date'), max_length=40)
        if not name or not date_text or not is_plausible_exam_date_text(date_text):
            continue
        key = normalize_name(name)
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append({'name': name, 'duedate': date_text})
    return rows


def extract_syllabus_exam_rows(text: str) -> list[dict]:
    body = str(text or '')
    by_name: dict[str, dict] = {}
    for match in SYLLABUS_EXAM_DATE_GRADE_PATTERN.finditer(body):
        label = canonical_test_event_name(match.group('label'))
        date_text = _clean_label(match.group('date'), max_length=40)
        pct = _valid_pct(match.group('pct') or '')
        if not label:
            continue
        key = label.casefold()
        row = by_name.setdefault(
            key,
            {'name': label, 'startdate': '', 'gradepercentage': None},
        )
        if date_text and is_plausible_exam_date_text(date_text):
            row['startdate'] = date_text
        if pct is not None:
            row['gradepercentage'] = pct
    for hint in extract_prose_exam_hints(body) + extract_syllabus_exam_hints(body):
        name = canonical_test_event_name(str(hint.get('name') or ''))
        date_text = str(hint.get('date_text') or '').strip()
        if not name:
            continue
        key = name.casefold()
        row = by_name.setdefault(
            key,
            {'name': name, 'startdate': '', 'gradepercentage': None},
        )
        if date_text and not row.get('startdate'):
            row['startdate'] = date_text
    for match in SYLLABUS_EXAM_GRADE_PATTERN.finditer(body):
        label = canonical_test_event_name(match.group('label'))
        pct = _valid_pct(match.group('pct'))
        if not label or pct is None:
            continue
        key = label.casefold()
        row = by_name.setdefault(
            key,
            {'name': label, 'startdate': '', 'gradepercentage': None},
        )
        row['gradepercentage'] = pct
    return list(by_name.values())


def extract_syllabus_grading_policies(text: str) -> list[dict]:
    policies: list[dict] = []
    seen: set[str] = set()
    for match in GRADING_POLICY_BLOCK_PATTERN.finditer(str(text or '')):
        body = compact_block_text(match.group('body'), 800).strip()
        if len(body) < 20:
            continue
        key = normalize_name(body[:120])
        if not key or key in seen:
            continue
        seen.add(key)
        policies.append({'policyType': 'grading', 'text': body})
    return policies


def _is_exam_component(name: str) -> bool:
    lowered = str(name or '').casefold()
    if not EXAM_COMPONENT_PATTERN.search(lowered):
        return False
    return canonical_test_event_name(name) != ''


def _merge_assignments(grades: list[dict], dues: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for row in grades:
        if _is_exam_component(row.get('name', '')):
            continue
        key = normalize_name(row.get('name', ''))
        if not key:
            continue
        merged[key] = {
            'name': row['name'],
            'gradepercentage': row.get('gradepercentage'),
            'duedate': '',
            'description': '',
        }
    for row in dues:
        key = normalize_name(row.get('name', ''))
        if not key:
            continue
        target = merged.setdefault(
            key,
            {
                'name': row['name'],
                'gradepercentage': None,
                'duedate': '',
                'description': '',
            },
        )
        if not target.get('name'):
            target['name'] = row['name']
        target['duedate'] = row.get('duedate') or ''
    return list(merged.values())


def extract_syllabus_heuristic_bundle(*, text: str = '', pages=None) -> dict:
    body = syllabus_plain_text(text=text, pages=pages)
    grades = extract_syllabus_grade_components(body)
    assignments = _merge_assignments(grades, extract_syllabus_assignment_dues(body))
    return {
        'text': body,
        'assignments': assignments,
        'exams': extract_syllabus_exam_rows(body),
        'policies': extract_syllabus_grading_policies(body),
        'weeks': extract_syllabus_week_rows(pages or []),
        'participation_grade': extract_syllabus_participation_grade(body),
        'grade_components': grades,
    }


def build_syllabus_type_extractions(bundle: dict) -> dict:
    store: dict = {}
    weeks = bundle.get('weeks') or []
    if weeks:
        store.setdefault('syllabus', {})['weeks'] = [
            {
                'weekNumber': row.get('weekNumber'),
                'topic': row.get('topic', ''),
                'title': row.get('title', ''),
                'pageid': row.get('pageid', ''),
                'pageNumber': row.get('pageNumber', ''),
                'heuristicSource': 'syllabus_week',
            }
            for row in weeks
        ]
    policies = bundle.get('policies') or []
    if policies:
        store.setdefault('syllabus', {})['policies'] = [
            {
                'policyType': row.get('policyType', 'grading'),
                'text': row.get('text', ''),
                'heuristicSource': 'syllabus_policy',
            }
            for row in policies
        ]
    grade_rows = []
    for row in bundle.get('grade_components') or []:
        grade_rows.append({
            'name': row.get('name', ''),
            'gradepercentage': row.get('gradepercentage'),
            'heuristicSource': 'syllabus_grade',
        })
    for row in bundle.get('assignments') or []:
        if row.get('duedate'):
            grade_rows.append({
                'name': row.get('name', ''),
                'duedate': row.get('duedate'),
                'gradepercentage': row.get('gradepercentage'),
                'heuristicSource': 'syllabus_assignment',
            })
    if grade_rows:
        store.setdefault('syllabus', {})['grades'] = grade_rows
    return store
