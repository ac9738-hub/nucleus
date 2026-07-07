"""Human-readable console lines for per-item parse progress."""
from __future__ import annotations

from typing import Any


def _fmt_fields(fields: dict[str, Any]) -> str:
    parts: list[str] = []
    for key, value in fields.items():
        if value is None or value == '':
            continue
        if isinstance(value, bool):
            text = 'yes' if value else 'no'
        elif isinstance(value, float):
            text = f'{value:.3f}'.rstrip('0').rstrip('.')
        else:
            text = str(value)
        parts.append(f'{key}={text}')
    return ' '.join(parts)


def log_parse_item(
    phase: str,
    *,
    course_id: str = '',
    file_id: str = '',
    filename: str = '',
    batch_type: str = '',
    **fields: Any,
) -> None:
    """Emit a single-line parser progress record (always flushed)."""
    header = f'parser: {phase}'
    ctx: list[str] = []
    if batch_type:
        ctx.append(f'batch={batch_type}')
    if course_id:
        ctx.append(f'course={course_id}')
    if file_id:
        ctx.append(f'file={file_id}')
    if filename:
        ctx.append(f'name={filename!r}')
    extras = _fmt_fields(fields)
    line = header
    if ctx:
        line += ' ' + ' '.join(ctx)
    if extras:
        line += ' ' + extras
    print(line, flush=True)


def pass_plan_skip_reasons(plan: dict[str, Any] | None) -> str:
    """Compact summary of why pass-plan steps were skipped."""
    if not isinstance(plan, dict):
        return ''
    bits: list[str] = []
    for step in plan.get('steps') or []:
        if not isinstance(step, dict):
            continue
        if step.get('needed'):
            continue
        pid = str(step.get('pass') or '')
        reason = str(step.get('reason') or '').strip()
        if not pid:
            continue
        if reason:
            short = reason.split('—', 1)[0].split('-', 1)[0].strip()
            if len(short) > 48:
                short = short[:45] + '...'
            bits.append(f'{pid}:{short}')
        else:
            bits.append(pid)
    return '; '.join(bits[:4])


def log_pass_plan_state(
    item: dict[str, Any],
    *,
    enabled: bool,
    applied: bool,
    syllabus_seed: bool | None = None,
) -> None:
    course_id = str(item.get('courseid') or item.get('courseId') or '')
    file_id = str(item.get('id') or item.get('fileId') or '')
    filename = str(item.get('name') or item.get('filename') or '')
    if not enabled:
        log_parse_item(
            'pass-plan off',
            course_id=course_id,
            file_id=file_id,
            filename=filename,
            route='legacy-full-llm',
        )
        return
    if not applied:
        log_parse_item(
            'pass-plan reuse',
            course_id=course_id,
            file_id=file_id,
            filename=filename,
            type=item.get('knownFileType') or (item.get('passPlan') or {}).get('resolvedType'),
        )
        return
    plan = item.get('passPlan') or {}
    log_parse_item(
        'pass-plan',
        course_id=course_id,
        file_id=file_id,
        filename=filename,
        type=plan.get('resolvedType') or item.get('knownFileType'),
        conf=plan.get('heuristicConfidence'),
        skip_classify=item.get('skipLlmClassify'),
        skip_pass1=item.get('skipLlmPass1'),
        skip_pass2=item.get('skipPass2'),
        est_llm=plan.get('estLlmCalls'),
        syllabus_seed=syllabus_seed,
        cuts=pass_plan_skip_reasons(plan) or None,
    )


def log_parse_route(
    *,
    course_id: str,
    file_id: str,
    filename: str,
    resolved_type: str,
    skip_classify: bool,
    skip_pass1: bool,
    skip_pass2: bool,
) -> None:
    if skip_pass1:
        route = 'heuristic-only'
    elif skip_classify and skip_pass2:
        route = 'llm-pass1-only'
    elif skip_classify:
        route = 'llm-pass1+pass2?'
    else:
        route = 'llm-classify+pass1'
    log_parse_item(
        'route',
        course_id=course_id,
        file_id=file_id,
        filename=filename,
        type=resolved_type or None,
        classify='skip' if skip_classify else 'run',
        pass1='skip' if skip_pass1 else 'run',
        pass2='skip' if skip_pass2 else 'run',
        path=route,
    )


def log_worker_item_start(
    *,
    batch_type: str,
    course_id: str,
    item_id: str,
    filename: str,
    placement: str,
    production: bool,
    pass_plan: bool,
    has_seed: bool,
) -> None:
    log_parse_item(
        'worker start',
        batch_type=batch_type,
        course_id=course_id,
        file_id=item_id,
        filename=filename,
        placement=placement,
        production='yes' if production else 'no',
        pass_plan='yes' if pass_plan else 'no',
        syllabus_seed='yes' if has_seed else 'no',
        concurrent='yes',
    )


def log_worker_item_done(
    *,
    batch_type: str,
    course_id: str,
    item_id: str,
    filename: str,
    elapsed_ms: float,
    deepseek_passes: int,
    skip_reason: str = '',
    pass_plan: dict[str, Any] | None = None,
) -> None:
    plan = pass_plan or {}
    log_parse_item(
        'worker done',
        batch_type=batch_type,
        course_id=course_id,
        file_id=item_id,
        filename=filename,
        ms=elapsed_ms,
        llm_passes=deepseek_passes,
        type=plan.get('resolvedType'),
        skip_pass1=plan.get('skippedPasses') and 'llm_pass1' in (plan.get('skippedPasses') or []),
        skip_reason=skip_reason or None,
    )
