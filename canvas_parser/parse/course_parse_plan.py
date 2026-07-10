"""Per-course parse plan for Lambda orchestration (app-representative)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from canvas_parser.weekly_iteration.llm_parse import _is_parseable_file
from canvas_parser.parse.file_types import (
    HEURISTIC_CONFIDENCE_THRESHOLD,
    heuristic_classify,
    should_run_llm_classification,
)

SYLLABUS_NAME_PATTERN = re.compile(
    r"\b(syllabus|course\s+outline|course\s+information|class\s+information|course\s+schedule)\b",
    re.IGNORECASE,
)

DETERMINISTIC_BATCH_TYPES = frozenset({'assignment', 'module_item', 'page', 'external_submission'})


def syllabus_tier(batch_type: str, item: dict[str, Any]) -> str:
    if batch_type == 'syllabus':
        return 'definite'
    if not isinstance(item, dict):
        return 'no'
    name = str(item.get('name') or item.get('display_name') or item.get('filename') or '')
    heuristic_type, heuristic_conf = heuristic_classify(filename=name, snippet='', pages=None)
    if heuristic_type == 'syllabus' and heuristic_conf >= HEURISTIC_CONFIDENCE_THRESHOLD:
        return 'definite'
    if is_likely_syllabus_item(item, batch_type):
        return 'candidate'
    if heuristic_type == 'syllabus' and should_run_llm_classification(heuristic_conf):
        return 'candidate'
    return 'no'


@dataclass
class CourseParsePlan:
    course_id: str
    syllabus_items: list[tuple[str, dict[str, Any], str]] = field(default_factory=list)
    file_items: list[tuple[str, dict[str, Any], str]] = field(default_factory=list)
    deterministic_items: list[tuple[str, dict[str, Any], str]] = field(default_factory=list)

    @property
    def lambda_file_count(self) -> int:
        """Parseable files sent to concurrent Lambda (syllabus is always local-first)."""
        return len(self.file_items)

    @property
    def total_item_count(self) -> int:
        return len(self.syllabus_items) + len(self.file_items) + len(self.deterministic_items)


def _item_display_name(item: dict[str, Any]) -> str:
    return str(
        item.get('name')
        or item.get('display_name')
        or item.get('filename')
        or ''
    ).strip()


def is_likely_syllabus_item(item: dict[str, Any], batch_type: str) -> bool:
    if batch_type == 'syllabus':
        return True
    if not isinstance(item, dict):
        return False
    raw = item.get('content')
    if isinstance(raw, str) and raw.strip().startswith('{'):
        try:
            payload = json.loads(raw)
            if str(payload.get('documenttype', '')).lower() == 'syllabus':
                return True
        except json.JSONDecodeError:
            pass
    searchable = ' '.join(
        str(item.get(key) or '')
        for key in ('name', 'display_name', 'filename', 'url', 'previewurl', 'content')
    )
    return bool(SYLLABUS_NAME_PATTERN.search(searchable))


def syllabus_priority(batch_type: str, item: dict[str, Any]) -> tuple[int, str]:
    """Lower sorts first: Canvas syllabus body, then syllabus PDFs, then other."""
    if batch_type == 'syllabus':
        return (0, _item_display_name(item).casefold())
    name = _item_display_name(item).casefold()
    if 'syllabus' in name:
        return (1, name)
    if SYLLABUS_NAME_PATTERN.search(name):
        return (2, name)
    return (3, name)


def finalize_course_plan(plan: CourseParsePlan) -> CourseParsePlan:
    """Order syllabus candidates and ensure syllabus files never land in file_items."""
    plan.syllabus_items.sort(key=lambda row: syllabus_priority(row[0], row[1]))
    syllabus_keys = {key for _bt, _item, key in plan.syllabus_items}
    plan.file_items = [
        row for row in plan.file_items
        if row[2] not in syllabus_keys
    ]
    return plan


def collect_parseable_file_items(
    plan: CourseParsePlan,
    course_items: list[tuple[str, dict[str, Any], str]],
) -> list[tuple[str, dict[str, Any], str]]:
    """
    All parseable file batches for a course, excluding canonical syllabus sources.

    Used after syllabus discovery/parse so the sequential file phase matches production
    orchestration (every LLM file, not just the pre-discover plan slice).
    """
    syllabus_keys = {key for _bt, _item, key in plan.syllabus_items}
    rows: list[tuple[str, dict[str, Any], str]] = []
    seen: set[str] = set()
    for batch_type, item, key in course_items:
        if batch_type != 'file':
            continue
        if key in syllabus_keys or key in seen:
            continue
        if not _is_parseable_file(item):
            continue
        seen.add(key)
        rows.append((batch_type, item, key))
    for row in plan.file_items:
        key = row[2]
        if key in syllabus_keys or key in seen:
            continue
        seen.add(key)
        rows.append(row)
    rows.sort(key=lambda entry: (_item_display_name(entry[1]).casefold(), entry[2]))
    return rows


def item_key(batch_type: str, item: dict[str, Any]) -> str:
    courseid = str(item.get('courseid') or '')
    item_id = str(item.get('id') or '')
    return f'{batch_type}__{courseid}__{item_id}'


def build_course_parse_plans(
    items: list[tuple[str, dict[str, Any], str]],
) -> list[CourseParsePlan]:
    """Split items per course: syllabus (identified first) → deterministic → LLM files."""
    by_course: dict[str, CourseParsePlan] = {}
    for batch_type, item, key in items:
        if not isinstance(item, dict):
            continue
        course_id = str(item.get('courseid') or '').strip()
        if not course_id:
            continue
        plan = by_course.setdefault(course_id, CourseParsePlan(course_id=course_id))
        if batch_type in DETERMINISTIC_BATCH_TYPES:
            plan.deterministic_items.append((batch_type, item, key))
            continue
        if batch_type == 'syllabus' or syllabus_tier(batch_type, item) == 'definite':
            plan.syllabus_items.append((batch_type, item, key))
            continue
        if batch_type == 'file' and _is_parseable_file(item):
            plan.file_items.append((batch_type, item, key))
            continue
        if batch_type not in {'file', 'external', 'external_submission'}:
            plan.deterministic_items.append((batch_type, item, key))

    plans = [finalize_course_plan(by_course[cid]) for cid in sorted(by_course)]
    return plans


def summarize_plans(plans: list[CourseParsePlan]) -> dict[str, int]:
    return {
        'courses': len(plans),
        'syllabus_items': sum(len(plan.syllabus_items) for plan in plans),
        'deterministic_items': sum(len(plan.deterministic_items) for plan in plans),
        'file_items': sum(len(plan.file_items) for plan in plans),
        'lambda_file_items': sum(plan.lambda_file_count for plan in plans),
        'total_items': sum(plan.total_item_count for plan in plans),
    }
