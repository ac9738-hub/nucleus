"""Compare parsed course output against ground-truth annotations."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .course_match import (
    GroundTruthSpec,
    find_snapshot_for_ground_truth,
    gt_course_id_map,
    iter_ground_truth_files,
    parse_ground_truth_filename,
)
from .format import format_course_snapshot
from .fetch import fetch_all_courses, load_snapshots


SECTION_WEIGHTS = {
    'assignments': 0.20,
    'discussions': 0.10,
    'participation': 0.05,
    'modules': 0.25,
    'weekly_schedule': 0.40,
}

WEEKLY_ONLY_WEIGHTS = {
    'weekly_schedule': 1.0,
}


from .availability import weekly_item_is_evaluable
from .match_utils import names_match, normalize_name


def normalize_date(value: str) -> str:
    text = str(value or '').strip()
    if not text:
        return ''
    parts = text.split('/')
    if len(parts) == 3:
        month, day, year = parts
        return f'{int(month)}/{int(day)}/{int(year)}'
    return text


def _date_key(value: str) -> tuple[int, int, int] | None:
    text = normalize_date(value)
    if not text:
        return None
    month, day, year = text.split('/')
    return int(year), int(month), int(day)


def dates_match(left: str, right: str, tolerance_days: int = 1) -> bool:
    left_key = _date_key(left)
    right_key = _date_key(right)
    if not left_key or not right_key:
        return not left and not right
    left_date = datetime(left_key[0], left_key[1], left_key[2])
    right_date = datetime(right_key[0], right_key[1], right_key[2])
    return abs((left_date - right_date).days) <= tolerance_days


def _match_named_items(
    expected_items: list[dict[str, Any]],
    actual_items: list[dict[str, Any]],
    *,
    require_date: bool = False,
) -> tuple[int, int, list[str]]:
    matched = 0
    misses: list[str] = []
    actual = list(actual_items or [])
    used = set()

    for expected in expected_items:
        expected_name = expected.get('name') or ''
        expected_date = normalize_date(expected.get('due_at') or expected.get('start_date') or '')
        found = False
        for index, candidate in enumerate(actual):
            if index in used:
                continue
            candidate_name = candidate.get('name') or ''
            if not names_match(expected_name, candidate_name):
                continue
            if require_date and expected_date:
                candidate_date = normalize_date(
                    candidate.get('due_at')
                    or candidate.get('start_date')
                    or ''
                )
                if candidate_date and not dates_match(candidate_date, expected_date):
                    continue
            used.add(index)
            matched += 1
            found = True
            break
        if not found:
            misses.append(expected_name)

    return matched, len(expected_items), misses


def _match_modules(
    expected_modules: list[dict[str, Any]],
    actual_modules: list[dict[str, Any]],
) -> tuple[int, int, list[str]]:
    matched = 0
    total = 0
    misses: list[str] = []

    for expected in expected_modules:
        expected_name = expected.get('module_name') or ''
        expected_contents = expected.get('module_contents') or []
        total += 1 + len(expected_contents)
        actual_module = next(
            (module for module in (actual_modules or []) if names_match(expected_name, module.get('module_name') or '')),
            None,
        )
        if not actual_module:
            misses.append(f'module:{expected_name}')
            continue
        matched += 1
        actual_contents = actual_module.get('module_contents') or []
        for content in expected_contents:
            content_name = content.get('name') or ''
            if any(names_match(content_name, row.get('name') or '') for row in actual_contents):
                matched += 1
            else:
                misses.append(f'{expected_name}/{content_name}')

    return matched, total, misses


def _flatten_weekly_items(weeks: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for week in weeks or []:
        week_start = week.get('start_date') or ''
        for entry in week.get(key) or []:
            items.append({
                'name': entry.get('name') or '',
                'start_date': week_start,
                'due_at': week_start,
            })
    return items


def _find_matching_week(
    expected_week: dict[str, Any],
    actual_weeks: list[dict[str, Any]],
    *,
    strict_weeks: bool,
) -> dict[str, Any] | None:
    expected_start = normalize_date(expected_week.get('start_date') or '')
    if strict_weeks:
        if expected_start:
            for week in actual_weeks or []:
                if dates_match(expected_start, week.get('start_date') or '', tolerance_days=6):
                    return week
        week_name = str(expected_week.get('name') or '').strip()
        if week_name:
            match = next(
                (
                    week for week in (actual_weeks or [])
                    if str(week.get('name') or '').strip() == week_name
                ),
                None,
            )
            if match:
                return match
        return None
    return next(
        (
            week for week in (actual_weeks or [])
            if normalize_date(week.get('start_date') or '') == expected_start
        ),
        None,
    )


def _match_weekly_schedule(
    expected_weeks: list[dict[str, Any]],
    actual_weeks: list[dict[str, Any]],
    *,
    strict_weeks: bool = False,
    snapshot: dict[str, Any] | None = None,
    unlocked_only: bool = False,
) -> tuple[int, int, list[str], int]:
    matched = 0
    total = 0
    misses: list[str] = []
    skipped_locked = 0

    for expected_week in expected_weeks or []:
        expected_start = normalize_date(expected_week.get('start_date') or '')
        actual_week = _find_matching_week(expected_week, actual_weeks, strict_weeks=strict_weeks)
        for bucket_key in ('files', 'assignments', 'events'):
            for expected_item in expected_week.get(bucket_key) or []:
                expected_name = expected_item.get('name') or ''
                if unlocked_only and snapshot is not None:
                    if not weekly_item_is_evaluable(snapshot, expected_name, bucket_key):
                        skipped_locked += 1
                        continue
                total += 1
                if not actual_week:
                    if strict_weeks:
                        misses.append(f'{expected_week.get("name")}:{bucket_key}:{expected_name}')
                    elif any(
                        names_match(expected_name, row.get('name') or '')
                        for row in _flatten_weekly_items(actual_weeks, bucket_key)
                    ):
                        matched += 1
                    else:
                        misses.append(f'{expected_week.get("name")}:{bucket_key}:{expected_name}')
                    continue
                candidates = [
                    {
                        'name': row.get('name') or '',
                        'start_date': expected_start,
                    }
                    for row in (actual_week.get(bucket_key) or [])
                ]
                if any(names_match(expected_name, row.get('name') or '') for row in candidates):
                    matched += 1
                else:
                    misses.append(f'{expected_week.get("name")}:{bucket_key}:{expected_name}')

    return matched, total, misses, skipped_locked


@dataclass
class SectionScore:
    name: str
    matched: int = 0
    total: int = 0
    misses: list[str] = field(default_factory=list)
    skipped_locked: int = 0

    @property
    def accuracy(self) -> float:
        if self.total == 0:
            return 1.0
        return self.matched / self.total


@dataclass
class CourseScore:
    ground_truth_file: str
    course_label: str
    sections: dict[str, SectionScore] = field(default_factory=dict)

    @property
    def accuracy(self) -> float:
        weighted = 0.0
        weight_total = 0.0
        weights = getattr(self, '_section_weights', SECTION_WEIGHTS)
        for name, section in self.sections.items():
            weight = weights.get(name, 0.0)
            if section.total == 0:
                continue
            weighted += section.accuracy * weight
            weight_total += weight
        if weight_total == 0:
            return 1.0
        return weighted / weight_total


def score_parsed_course(
    parsed: dict[str, Any],
    ground_truth: dict[str, Any],
    *,
    weekly_only: bool = False,
    strict_weekly: bool = False,
    snapshot: dict[str, Any] | None = None,
    unlocked_only: bool = False,
) -> CourseScore:
    score = CourseScore(ground_truth_file='', course_label='')
    if not weekly_only:
        for section_name in ('assignments', 'discussions', 'participation'):
            if section_name not in ground_truth:
                continue
            matched, total, misses = _match_named_items(
                ground_truth.get(section_name) or [],
                parsed.get(section_name) or [],
                require_date=section_name in {'assignments', 'discussions'},
            )
            score.sections[section_name] = SectionScore(section_name, matched, total, misses)

        if 'modules' in ground_truth:
            matched, total, misses = _match_modules(
                ground_truth.get('modules') or [],
                parsed.get('modules') or [],
            )
            score.sections['modules'] = SectionScore('modules', matched, total, misses)

    if 'weekly_schedule' in ground_truth:
        matched, total, misses, skipped_locked = _match_weekly_schedule(
            ground_truth.get('weekly_schedule') or [],
            parsed.get('weekly_schedule') or [],
            strict_weeks=strict_weekly,
            snapshot=snapshot,
            unlocked_only=unlocked_only,
        )
        section = SectionScore('weekly_schedule', matched, total, misses, skipped_locked)
        score.sections['weekly_schedule'] = section

    if weekly_only:
        score._section_weights = WEEKLY_ONLY_WEIGHTS
    return score


def compare_to_ground_truth(
    parsed: dict[str, Any],
    ground_truth: dict[str, Any],
    *,
    ground_truth_file: str = '',
    course_label: str = '',
    weekly_only: bool = False,
    strict_weekly: bool = False,
    snapshot: dict[str, Any] | None = None,
    unlocked_only: bool = False,
) -> CourseScore:
    result = score_parsed_course(
        parsed,
        ground_truth,
        weekly_only=weekly_only,
        strict_weekly=strict_weekly,
        snapshot=snapshot,
        unlocked_only=unlocked_only,
    )
    result.ground_truth_file = ground_truth_file
    result.course_label = course_label
    return result


def evaluate_snapshots(
    snapshots: list[dict[str, Any]],
    ground_truth_dir: Path,
    *,
    graph: dict[str, Any] | None = None,
    root_dir: Path | None = None,
    use_llm_weekly: bool = False,
    weekly_only: bool = True,
    strict_weekly: bool = False,
    unlocked_only: bool = False,
) -> list[CourseScore]:
    course_ids = gt_course_id_map(ground_truth_dir)
    results: list[CourseScore] = []
    for gt_path in iter_ground_truth_files(ground_truth_dir):
        spec = parse_ground_truth_filename(gt_path.name)
        snapshot = find_snapshot_for_ground_truth(
            snapshots,
            spec,
            course_id=course_ids.get(gt_path.name),
        )
        ground_truth = json.loads(gt_path.read_text(encoding='utf-8'))
        if not snapshot:
            results.append(CourseScore(
                ground_truth_file=gt_path.name,
                course_label=','.join(spec.course_codes),
                sections={'all': SectionScore('all', 0, 1, ['no matching Canvas course'])},
            ))
            continue
        parsed = format_course_snapshot(
            snapshot,
            graph=graph,
            root_dir=root_dir,
            use_llm_weekly=use_llm_weekly,
        )
        course = snapshot.get('course') or {}
        label = course.get('course_code') or course.get('name') or gt_path.stem
        result = compare_to_ground_truth(
            parsed,
            ground_truth,
            ground_truth_file=gt_path.name,
            course_label=str(label),
            weekly_only=weekly_only,
            strict_weekly=strict_weekly,
            snapshot=snapshot,
            unlocked_only=unlocked_only,
        )
        results.append(result)
    return results


def load_ground_truth(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding='utf-8'))
