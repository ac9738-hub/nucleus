"""Apply pass-plan overrides before file parse (skip redundant LLM steps)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from canvas_parser.content.teaching_blocks import extract_teaching_units_from_pages
from canvas_parser.parse.heuristic_concepts import extract_heuristic_concept_titles
from canvas_parser.parse.file_types import (
    HEURISTIC_CONFIDENCE_THRESHOLD,
    build_classification_snippet,
    get_file_type_profile,
    heuristic_classify,
    normalize_file_type_id,
    profile_skips_llm_pass1_for_cost,
)
from canvas_parser.parse.parse_pass_plan import PassPlan, plan_passes_for_file

PASS_PLAN_ENV = 'PARSER_PASS_PLAN'


def pass_plan_enabled() -> bool:
    """True when per-file pass planning (skip classify/pass1/pass2) is active."""
    flag = os.getenv(PASS_PLAN_ENV, '').strip().casefold()
    if flag in {'1', 'true', 'on', 'yes'}:
        return True
    if flag in {'0', 'false', 'off', 'no'}:
        return False
    try:
        from canvas_parser.parse.parse_modes import active_parse_mode

        return active_parse_mode() == 'llm-cost'
    except Exception:
        return False


def course_has_syllabus_seed(course_id: str) -> bool:
    """True when the in-memory parser already has a syllabus node for this course."""
    cid = str(course_id or '').strip()
    if not cid:
        return False
    try:
        import parser as parser_mod

        return bool(parser_mod.syllabusNodes.get(cid))
    except Exception:
        return False


def _local_pdf_path(file_id: str) -> Path | None:
    try:
        from parser import folder
    except ImportError:
        return None
    fid = str(file_id)
    direct = folder / fid
    if direct.is_file():
        return direct
    for suffix in ('.pdf', '.PDF'):
        candidate = folder / f'{fid}{suffix}'
        if candidate.is_file():
            return candidate
    return None


def snippet_for_pool_entry(entry: dict[str, Any]) -> str:
    """Load a classify snippet from cached PDF when available (free, no LLM)."""
    pages = pages_for_plan_entry(entry)
    if not pages:
        return ''
    return build_classification_snippet(pages=pages)


def pages_for_plan_entry(entry: dict[str, Any]) -> list[dict]:
    """Pages for pass planning: live parse pages, then cached PDF on disk."""
    override = entry.get('_pages')
    if isinstance(override, list) and override:
        return override
    inline = entry.get('pages')
    if isinstance(inline, list) and inline:
        return inline
    return pages_for_pool_entry(entry)


def pages_for_pool_entry(entry: dict[str, Any]) -> list[dict]:
    """Load normalized PDF pages for a pool entry when cached locally."""
    file_id = str(entry.get('fileId') or '')
    if not file_id:
        return []
    pdf_path = _local_pdf_path(file_id)
    if not pdf_path:
        return []
    try:
        from parser import build_pdf_pages, normalize_file_pages

        return normalize_file_pages(build_pdf_pages(str(pdf_path), file_id), file_id)
    except Exception:
        return []


def heuristic_teaching_signal_empty(entry: dict[str, Any], file_type: str) -> bool:
    """True when a free heuristic preview finds no concepts/sections/problems."""
    pages = pages_for_plan_entry(entry)
    if not pages:
        return False
    filename = str(entry.get('filename') or '')
    if extract_heuristic_concept_titles(filename=filename, pages=pages, file_type=file_type):
        return False
    units = extract_teaching_units_from_pages(pages)
    return not any(
        u.get('type') in {'section', 'concept', 'problem'}
        for u in units
    )


def pool_entry_from_parse_item(item: dict[str, Any], *, pages: list[dict] | None = None) -> dict[str, Any]:
    """Map a production parse item to the pool-entry shape used by pass planning."""
    page_list = pages if pages is not None else (item.get('pages') or [])
    return {
        'courseId': str(item.get('courseid') or item.get('courseId') or ''),
        'fileId': str(item.get('id') or item.get('fileId') or ''),
        'filename': str(item.get('name') or item.get('filename') or ''),
        'fileType': str(
            item.get('knownFileType')
            or item.get('academicFileType')
            or item.get('fileType')
            or ''
        ),
        'pageCount': len(page_list),
        '_pages': page_list,
    }


def _apply_cost_pass_overrides(
    plan: PassPlan,
    entry: dict[str, Any],
    *,
    syllabus_seed_present: bool,
    for_gt_build: bool,
) -> PassPlan:
    if not for_gt_build and syllabus_seed_present and plan.resolved_type == 'syllabus':
        plan = _mark_steps_skipped(
            plan,
            {'llm_pass1', 'llm_pass2'},
            reason='Syllabus seed attached; skip redundant syllabus file LLM.',
        )
    profile = get_file_type_profile(plan.resolved_type)
    if not for_gt_build and profile_skips_llm_pass1_for_cost(profile):
        plan = _mark_steps_skipped(
            plan,
            {'llm_pass1'},
            reason=(
                f'Type {profile.type_id}: no concept/problem extraction profile — '
                'heuristic seed + finalize replaces pass1 (pass plan).'
            ),
        )
    elif (
        not for_gt_build
        and any(s.pass_id == 'llm_pass1' and s.needed for s in plan.steps)
        and heuristic_teaching_signal_empty(entry, plan.resolved_type)
    ):
        plan = _mark_steps_skipped(
            plan,
            {'llm_pass1'},
            reason=(
                'Heuristic preview found no teaching units/concepts — '
                'skip pass1 (empty structural signal).'
            ),
        )
    return plan


def plan_passes_for_parse_item(
    item: dict[str, Any],
    *,
    pages: list[dict] | None = None,
    syllabus_seed_present: bool | None = None,
    for_gt_build: bool = False,
) -> PassPlan:
    """Plan passes for a live parser file item (production or eval)."""
    entry = pool_entry_from_parse_item(item, pages=pages)
    snippet = snippet_for_pool_entry(entry)
    plan = plan_passes_for_file(
        course_id=entry['courseId'],
        file_id=entry['fileId'],
        filename=entry['filename'],
        file_type_hint=entry['fileType'],
        snippet=snippet,
        page_count=int(entry.get('pageCount') or 0),
    )
    if syllabus_seed_present is None:
        syllabus_seed_present = course_has_syllabus_seed(entry['courseId'])
    return _apply_cost_pass_overrides(
        plan,
        entry,
        syllabus_seed_present=bool(syllabus_seed_present),
        for_gt_build=for_gt_build,
    )


def apply_pass_plan_to_parse_item(
    item: dict[str, Any],
    *,
    pages: list[dict] | None = None,
    syllabus_seed_present: bool | None = None,
    log: bool = True,
) -> dict[str, Any]:
    """Attach pass-plan skip flags to a parse item when pass planning is enabled."""
    from canvas_parser.parse.parse_item_log import log_pass_plan_state

    enabled = pass_plan_enabled()
    if not enabled:
        if log:
            log_pass_plan_state(item, enabled=False, applied=False)
        return item
    if item.get('passPlan'):
        if log:
            log_pass_plan_state(item, enabled=True, applied=False)
        return item
    if syllabus_seed_present is None:
        syllabus_seed_present = course_has_syllabus_seed(
            str(item.get('courseid') or item.get('courseId') or '')
        )
    entry = pool_entry_from_parse_item(item, pages=pages)
    plan = plan_passes_for_parse_item(
        item,
        pages=pages,
        syllabus_seed_present=syllabus_seed_present,
        for_gt_build=False,
    )
    out = prepare_parse_item(item, entry, plan)
    if log:
        log_pass_plan_state(
            out,
            enabled=True,
            applied=True,
            syllabus_seed=bool(syllabus_seed_present),
        )
    return out


def eval_stratum(entry: dict[str, Any]) -> str:
    """content = teaching files; syllabus = schedule PDFs (seed usually sufficient for eval)."""
    explicit = str(entry.get('evalStratum') or '').strip()
    if explicit:
        return explicit
    file_type = normalize_file_type_id(str(entry.get('fileType') or ''))
    return 'syllabus' if file_type == 'syllabus' else 'content'


def plan_passes_for_pool_entry(
    entry: dict[str, Any],
    *,
    syllabus_seed_present: bool = False,
    for_gt_build: bool = False,
) -> PassPlan:
    snippet = snippet_for_pool_entry(entry)
    plan = plan_passes_for_file(
        course_id=str(entry.get('courseId') or ''),
        file_id=str(entry.get('fileId') or ''),
        filename=str(entry.get('filename') or ''),
        file_type_hint=str(entry.get('fileType') or ''),
        snippet=snippet,
        page_count=int(entry.get('pageCount') or 0),
    )
    return _apply_cost_pass_overrides(
        plan,
        entry,
        syllabus_seed_present=syllabus_seed_present,
        for_gt_build=for_gt_build,
    )


def _mark_steps_skipped(plan: PassPlan, pass_ids: set[str], *, reason: str) -> PassPlan:
    steps = []
    for step in plan.steps:
        if step.pass_id in pass_ids:
            steps.append(type(step)(
                step.pass_id,
                needed=False,
                reason=reason,
                llm_call=False,
                est_cost_tier='free',
            ))
        else:
            steps.append(step)
    plan.steps[:] = steps
    return plan


def apply_pass_plan_env(plan: PassPlan) -> None:
    """Set parser env for this item based on pass plan."""
    classify_step = next((s for s in plan.steps if s.pass_id == 'llm_classify'), None)
    if classify_step and not classify_step.needed:
        os.environ['PARSER_SKIP_LLM_CLASSIFY'] = '1'
    pass2_step = next((s for s in plan.steps if s.pass_id == 'llm_pass2'), None)
    if pass2_step and not pass2_step.needed:
        os.environ['PARSER_SKIP_PASS2'] = '1'
    pass1_step = next((s for s in plan.steps if s.pass_id == 'llm_pass1'), None)
    if pass1_step and not pass1_step.needed:
        os.environ['PARSER_HEURISTIC_ONLY'] = '1'


def prepare_parse_item(
    item: dict[str, Any],
    entry: dict[str, Any],
    plan: PassPlan,
) -> dict[str, Any]:
    """Attach pass overrides to a parse item (consumed by parser.process_parse_item)."""
    snippet = snippet_for_pool_entry(entry)
    _, heur_conf = heuristic_classify(
        filename=str(entry.get('filename') or ''),
        snippet=snippet,
    )
    resolved = normalize_file_type_id(plan.resolved_type)
    classify_needed = any(s.pass_id == 'llm_classify' and s.needed for s in plan.steps)
    pass1_needed = any(s.pass_id == 'llm_pass1' and s.needed for s in plan.steps)
    pass2_needed = any(s.pass_id == 'llm_pass2' and s.needed for s in plan.steps)
    out = dict(item)
    out['knownFileType'] = resolved
    out['knownFileTypeConfidence'] = max(heur_conf, plan.heuristic_confidence)
    out['knownFileTypeSource'] = 'pass_plan'
    out['skipLlmClassify'] = not classify_needed
    out['skipLlmPass1'] = not pass1_needed
    out['skipPass2'] = not pass2_needed
    out['passPlan'] = plan.to_dict()
    return out


def inject_preclassified_file_seed(
    seed_state: dict[str, Any] | None,
    entry: dict[str, Any],
    plan: PassPlan,
) -> dict[str, Any]:
    """Ensure seed carries a typed file stub so skip_classify path resolves profile."""
    seed = dict(seed_state or {})
    course_id = str(entry.get('courseId') or '')
    file_id = str(entry.get('fileId') or '')
    if not course_id or not file_id:
        return seed
    files = seed.setdefault('files', {})
    course_files = files.setdefault(course_id, {})
    if file_id not in course_files:
        course_files[file_id] = {
            'fileid': file_id,
            'name': str(entry.get('filename') or file_id),
            'academicFileType': plan.resolved_type,
            'academicFileTypeConfidence': plan.heuristic_confidence,
            'academicFileTypeSource': 'pool_plan',
        }
    return seed
