"""Syllabus identification aligned with parser.py classify pathway."""
from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from typing import Any

from canvas_parser.parse.course_parse_plan import (
    CourseParsePlan,
    finalize_course_plan,
    syllabus_priority,
    syllabus_tier,
)
from canvas_parser.parse.file_types import HEURISTIC_CONFIDENCE_THRESHOLD, build_classification_snippet
from canvas_parser.parse.llm_resilience import deepseek_completion_with_retry

SELECT_PRIMARY_SYLLABUS_TOOL = {
    'type': 'function',
    'function': {
        'name': 'select_primary_syllabus',
        'description': 'Pick the single canonical course syllabus from multiple PDF candidates.',
        'parameters': {
            'type': 'object',
            'properties': {
                'item_key': {
                    'type': 'string',
                    'description': 'item_key of the primary syllabus PDF.',
                },
                'rationale': {'type': 'string'},
            },
            'required': ['item_key'],
            'additionalProperties': False,
        },
    },
}


@dataclass(frozen=True)
class ClassifiedSyllabusCandidate:
    batch_type: str
    item: dict[str, Any]
    key: str
    confidence: float
    type_id: str
    snippet: str


def _discovery_concurrency() -> int:
    raw = os.getenv('PARSER_SYLLABUS_DISCOVER_CONCURRENCY', os.getenv('PARSE_MAX_CONCURRENT', '28'))
    try:
        return max(1, int(raw))
    except ValueError:
        return 28


async def classify_downloaded_file_as_syllabus(
    item: dict[str, Any],
    *,
    course_id: str,
    placement: str,
    production: bool,
) -> tuple[bool, float, str, str]:
    """Download + snippet + run_file_type_classification (same as parser file path)."""
    import parser as parser_mod
    from canvas_parser.parse.lambda_runtime import configure_runtime

    file_id = str(item.get('id') or '')
    url = str(item.get('url') or '').strip()
    if not file_id or not url:
        return False, 0.0, 'missing_url', ''

    configure_runtime(placement=placement, production=production)
    processed = await parser_mod.processfile_async(
        file_id,
        url,
        content_type=item.get('content_type') or item.get('content-type') or '',
        filename=item.get('name') or '',
    )
    if not processed:
        return False, 0.0, 'download_failed', ''

    pages = processed.get('pages') or []
    prompt_text = processed.get('text') or ''
    filename = str(item.get('name') or '')
    filemeta = {'fileid': file_id, 'courseid': course_id, 'name': filename, 'pages': pages}

    _profile, type_id, _snippet, _call = await parser_mod.run_file_type_classification(
        filename,
        pages,
        prompt_text,
        course_id,
        file_id,
        filemeta,
    )
    confidence = float(filemeta.get('academicFileTypeConfidence') or 0.0)
    snippet = build_classification_snippet(pages=pages, prompt_text=prompt_text)
    is_syllabus = type_id == 'syllabus' and confidence >= HEURISTIC_CONFIDENCE_THRESHOLD
    return is_syllabus, confidence, type_id, snippet


def _candidate_rows(plan: CourseParsePlan) -> list[tuple[str, dict[str, Any], str]]:
    rows: list[tuple[str, dict[str, Any], str]] = []
    for batch_type, item, key in list(plan.file_items):
        if syllabus_tier(batch_type, item) == 'candidate':
            rows.append((batch_type, item, key))
    return rows


def _has_canvas_syllabus_body(plan: CourseParsePlan) -> bool:
    return any(batch_type == 'syllabus' for batch_type, _item, _key in plan.syllabus_items)


def _syllabus_pdf_rows(plan: CourseParsePlan) -> list[tuple[str, dict[str, Any], str]]:
    return [
        (batch_type, item, key)
        for batch_type, item, key in plan.syllabus_items
        if batch_type != 'syllabus'
    ]


async def _llm_select_primary_syllabus_key(
    course_id: str,
    candidates: list[ClassifiedSyllabusCandidate],
) -> str | None:
    import parser as parser_mod

    if not candidates or parser_mod.deepseek_client is None:
        return None
    if os.getenv('PARSER_SKIP_LLM_CLASSIFY', '0').strip().casefold() in {'1', 'true', 'on', 'yes'}:
        return None

    lines: list[str] = []
    for row in candidates:
        name = str(row.item.get('name') or '')
        snippet = re.sub(r'\s+', ' ', row.snippet[:600]).strip()
        lines.append(f"- item_key={row.key!r} name={name!r} confidence={row.confidence:.2f}\n  snippet: {snippet}")
    user_content = (
        f'Course {course_id} has multiple syllabus PDFs. Pick the single canonical primary syllabus.\n'
        'Prefer the main term syllabus over supplements, addenda, or section handouts.\n\n'
        + '\n'.join(lines)
    )
    try:
        response = await deepseek_completion_with_retry(
            parser_mod.deepseek_client,
            where='syllabus_select',
            model='deepseek-v4-flash',
            messages=[
                {
                    'role': 'system',
                    'content': (
                        'You choose the one canonical course syllabus PDF when several candidates exist. '
                        'Call select_primary_syllabus with the best item_key.'
                    ),
                },
                {'role': 'user', 'content': user_content},
            ],
            tools=[SELECT_PRIMARY_SYLLABUS_TOOL],
            tool_choice={'type': 'function', 'function': {'name': 'select_primary_syllabus'}},
            stream=False,
            **parser_mod.deepseek_thinking_extra('disabled'),
        )
    except Exception:
        return None

    message = response.choices[0].message
    tool_calls = getattr(message, 'tool_calls', None) or []
    for call in tool_calls:
        if getattr(call.function, 'name', '') != 'select_primary_syllabus':
            continue
        try:
            args = json.loads(call.function.arguments or '{}')
        except json.JSONDecodeError:
            continue
        item_key = str(args.get('item_key') or '').strip()
        if item_key:
            return item_key
    return None


def _fallback_primary_key(candidates: list[tuple[str, dict[str, Any], str]]) -> str:
    ordered = sorted(candidates, key=lambda row: syllabus_priority(row[0], row[1]))
    return ordered[0][2]


async def reconcile_syllabus_duplicates(
    plan: CourseParsePlan,
    *,
    classified_by_key: dict[str, ClassifiedSyllabusCandidate] | None = None,
) -> None:
    """Keep one primary syllabus per course; demote extras back to file_items."""
    pdf_rows = _syllabus_pdf_rows(plan)
    if not pdf_rows and len(plan.syllabus_items) <= 1:
        return

    keep_keys: set[str] = set()
    if _has_canvas_syllabus_body(plan):
        keep_keys.update(key for batch_type, _item, key in plan.syllabus_items if batch_type == 'syllabus')
    elif len(pdf_rows) == 1:
        keep_keys.add(pdf_rows[0][2])
    elif len(pdf_rows) > 1:
        classified = [
            classified_by_key[key]
            for _bt, _item, key in pdf_rows
            if classified_by_key and key in classified_by_key
        ]
        primary_key = None
        if classified:
            primary_key = await _llm_select_primary_syllabus_key(plan.course_id, classified)
        if not primary_key:
            primary_key = _fallback_primary_key(pdf_rows)
        keep_keys.add(primary_key)

    demoted: list[tuple[str, dict[str, Any], str]] = []
    kept: list[tuple[str, dict[str, Any], str]] = []
    for row in plan.syllabus_items:
        if row[2] in keep_keys:
            kept.append(row)
        else:
            demoted.append(row)
    plan.syllabus_items = kept
    plan.file_items.extend(demoted)
    finalize_course_plan(plan)


async def resolve_syllabus_candidates(
    plan: CourseParsePlan,
    *,
    placement: str,
    production: bool,
) -> None:
    """Promote uncertain file candidates to syllabus_items after download+classify."""
    remaining_files: list[tuple[str, dict[str, Any], str]] = []
    for batch_type, item, key in plan.file_items:
        tier = syllabus_tier(batch_type, item)
        if tier == 'candidate':
            is_syllabus, _confidence, _type_id, _snippet = await classify_downloaded_file_as_syllabus(
                item,
                course_id=plan.course_id,
                placement=placement,
                production=production,
            )
            if is_syllabus:
                plan.syllabus_items.append((batch_type, item, key))
                continue
        remaining_files.append((batch_type, item, key))
    plan.file_items = remaining_files
    plan.syllabus_items.sort(
        key=lambda row: syllabus_priority(row[0], row[1]),
    )


async def resolve_all_course_syllabi(
    plans: list[CourseParsePlan],
    *,
    placement: str,
    production: bool,
    progress=None,
) -> None:
    """Concurrent classify across all courses, then reconcile duplicate syllabi per course."""
    plan_by_id = {plan.course_id: plan for plan in plans}
    semaphore = asyncio.Semaphore(_discovery_concurrency())
    jobs: list[tuple[str, str, dict[str, Any], str]] = []
    for plan in plans:
        for batch_type, item, key in _candidate_rows(plan):
            jobs.append((plan.course_id, batch_type, item, key))

    async def _classify_job(course_id: str, batch_type: str, item: dict[str, Any], key: str):
        async with semaphore:
            is_syllabus, confidence, type_id, snippet = await classify_downloaded_file_as_syllabus(
                item,
                course_id=course_id,
                placement=placement,
                production=production,
            )
        return course_id, batch_type, item, key, is_syllabus, confidence, type_id, snippet

    classified_by_key: dict[str, ClassifiedSyllabusCandidate] = {}
    if jobs:
        if progress:
            progress.set_phase('syllabus_discover', done=0)
        results = await asyncio.gather(*[
            _classify_job(course_id, batch_type, item, key)
            for course_id, batch_type, item, key in jobs
        ])
        for index, (
            course_id,
            batch_type,
            item,
            key,
            is_syllabus,
            confidence,
            type_id,
            snippet,
        ) in enumerate(results, start=1):
            if is_syllabus:
                plan_by_id[course_id].syllabus_items.append((batch_type, item, key))
                classified_by_key[key] = ClassifiedSyllabusCandidate(
                    batch_type=batch_type,
                    item=item,
                    key=key,
                    confidence=confidence,
                    type_id=type_id,
                    snippet=snippet,
                )
            if progress:
                progress.tick(index, phase='syllabus_discover')

    for plan in plans:
        promoted_keys = {key for _bt, _item, key in plan.syllabus_items if key in classified_by_key}
        if promoted_keys:
            plan.file_items = [
                row for row in plan.file_items
                if row[2] not in promoted_keys
            ]
        plan.syllabus_items.sort(key=lambda row: syllabus_priority(row[0], row[1]))
        await reconcile_syllabus_duplicates(plan, classified_by_key=classified_by_key)
        finalize_course_plan(plan)
