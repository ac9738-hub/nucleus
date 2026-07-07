"""Match ground-truth filenames to Canvas course snapshots."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


TERM_CODES = {
    'F': 'fall',
    'S': 'spring',
    'W': 'winter',
    'U': 'summer',
}


@dataclass(frozen=True)
class GroundTruthSpec:
    filename: str
    course_codes: tuple[str, ...]
    term: str
    year: int


def parse_ground_truth_filename(filename: str) -> GroundTruthSpec:
    stem = filename.replace('.json', '')
    match = re.match(r'^(.+)_([FSWU])(\d{4})$', stem)
    if not match:
        raise ValueError(f'Unrecognized ground-truth filename: {filename}')
    codes_part, term_code, year_text = match.groups()
    codes = tuple(code.strip() for code in codes_part.split('-') if code.strip())
    term = TERM_CODES.get(term_code, term_code.lower())
    return GroundTruthSpec(
        filename=filename,
        course_codes=codes,
        term=term,
        year=int(year_text),
    )


def iter_ground_truth_files(gt_dir) -> list:
    """Return GT label files only (skip profile.json and other metadata)."""
    from pathlib import Path

    selected = []
    for gt_path in sorted(Path(gt_dir).glob('*.json')):
        try:
            parse_ground_truth_filename(gt_path.name)
        except ValueError:
            continue
        selected.append(gt_path)
    return selected


def _normalize_code(value: str) -> str:
    return re.sub(r'[^a-z0-9]', '', str(value or '').lower())


def _course_text(course: dict[str, Any]) -> str:
    parts = [
        course.get('course_code') or '',
        course.get('name') or '',
        course.get('course_code') or '',
    ]
    term = course.get('term') or {}
    if isinstance(term, dict):
        parts.append(term.get('name') or '')
    return ' '.join(str(part) for part in parts if part)


def _term_matches(course: dict[str, Any], spec: GroundTruthSpec) -> bool:
    term = course.get('term') or {}
    term_name = str(term.get('name') or '').lower() if isinstance(term, dict) else ''
    course_name = str(course.get('name') or '').lower()
    haystack = f'{term_name} {course_name}'
    if spec.term in haystack:
        return True
    if spec.term == 'fall' and ('fall' in haystack or 'autumn' in haystack):
        return True
    if spec.term == 'spring' and 'spring' in haystack:
        return True
    return str(spec.year) in haystack


def score_course_match(snapshot: dict[str, Any], spec: GroundTruthSpec) -> float:
    course = snapshot.get('course') or {}
    haystack = _normalize_code(_course_text(course))
    code_score = 0.0
    for code in spec.course_codes:
        normalized = _normalize_code(code)
        if normalized and normalized in haystack:
            code_score = max(code_score, len(normalized) / max(len(haystack), 1))
            code_score = max(code_score, 1.0)
    if code_score == 0.0:
        return 0.0
    if not _term_matches(course, spec):
        code_score *= 0.5
    return code_score


def gt_course_id_map(gt_dir: Path) -> dict[str, int]:
    profile_path = Path(gt_dir) / 'profile.json'
    if not profile_path.is_file():
        return {}
    try:
        profile = json.loads(profile_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    mapping: dict[str, int] = {}
    for row in profile.get('courses') or []:
        gt_file = row.get('ground_truth_file')
        course_id = row.get('canvas_course_id')
        if gt_file and course_id is not None:
            mapping[str(gt_file)] = int(course_id)
    return mapping


def find_snapshot_by_course_id(
    snapshots: list[dict[str, Any]],
    course_id: int,
) -> dict[str, Any] | None:
    target = int(course_id)
    for snapshot in snapshots:
        course = snapshot.get('course') or {}
        raw_id = course.get('id')
        if raw_id is not None and int(raw_id) == target:
            return snapshot
    return None


def find_snapshot_for_ground_truth(
    snapshots: list[dict[str, Any]],
    spec: GroundTruthSpec,
    *,
    course_id: int | None = None,
) -> dict[str, Any] | None:
    if course_id is not None:
        matched = find_snapshot_by_course_id(snapshots, course_id)
        if matched:
            return matched
    best = None
    best_score = 0.0
    for snapshot in snapshots:
        score = score_course_match(snapshot, spec)
        if score > best_score:
            best = snapshot
            best_score = score
    return best if best_score >= 0.5 else None
