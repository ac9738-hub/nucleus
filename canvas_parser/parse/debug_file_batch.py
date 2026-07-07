"""Debug orchestration: all course files run each LLM pass together; pause at phase boundaries only."""
from __future__ import annotations

import asyncio
import os
from typing import Any

from canvas_parser.parse.debug_trace import graph_payload_for_checkpoint, trace_activity, trace_checkpoint
from canvas_parser.parse.lambda_runtime import hydrate_parser_seed


def debug_file_concurrency() -> int:
    return max(1, int(os.getenv('PARSER_DEBUG_FILE_CONCURRENCY', '4')))


def _item_summary(batch_type: str, item: dict[str, Any], key: str) -> dict[str, Any]:
    return {
        'key': key,
        'batch_type': batch_type,
        'id': str(item.get('id') or ''),
        'course_id': str(item.get('courseid') or ''),
        'name': str(item.get('name') or item.get('display_name') or ''),
        'url': str(item.get('url') or ''),
    }


def _summarize_files(contexts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for ctx in contexts:
        item = ctx.get('item') or {}
        rows.append({
            'id': ctx.get('fileid') or item.get('id'),
            'name': ctx.get('filename') or item.get('name'),
            'type_id': (ctx.get('profile') or {}).type_id if ctx.get('profile') else ctx.get('type_id'),
        })
    return rows


async def _run_batched_file_passes(
    contexts: list[dict[str, Any]],
    *,
    pass_start: int,
    pass_end: int,
    skip_classify: bool,
) -> None:
    import parser as parser_mod

    concurrency = debug_file_concurrency()
    sem = asyncio.Semaphore(concurrency)

    async def worker(ctx: dict[str, Any]) -> None:
        async with sem:
            await parser_mod.run_deepseek(
                ctx['prompt'],
                ctx['fileid'],
                ctx['courseid'],
                ctx.get('downloadurl') or '',
                ctx.get('canvaspreviewurl') or '',
                ctx.get('filename') or '',
                pages=ctx.get('pages') or [],
                linked_discovered=bool(ctx.get('linked_discovered')),
                pass_start=pass_start,
                pass_end=pass_end,
                skip_classify=skip_classify,
            )

    await asyncio.gather(*[worker(ctx) for ctx in contexts])


async def run_batched_course_file_phases(
    rows: list[tuple[str, dict[str, Any], str]],
    *,
    course_id: str,
    seed_state: dict[str, Any] | None,
    full_graph: bool = True,
) -> dict[str, Any]:
    """
    Download/prepare all files, then run pass 1 on all files, then pass 2 on eligible files.
    Pauses only at phase checkpoints (file_pass1_phase, file_pass1_done, file_pass2_phase, file_pass2_done).
    """
    import parser as parser_mod

    hydrate_parser_seed(seed_state or {})
    concurrency = debug_file_concurrency()
    sem = asyncio.Semaphore(concurrency)

    async def prepare_row(batch_type: str, item: dict[str, Any], key: str) -> dict[str, Any] | None:
        async with sem:
            return await parser_mod.debug_prepare_canvas_file(item, batch_type)

    await trace_activity(
        f'Preparing {len(rows)} file(s) for batched pass parse ({concurrency} concurrent downloads)…'
    )
    prep_results = await asyncio.gather(
        *[prepare_row(batch_type, item, key) for batch_type, item, key in rows]
    )
    prepared: list[dict[str, Any]] = []
    for (batch_type, item, key), ctx in zip(rows, prep_results):
        if ctx is not None:
            ctx['batch_type'] = batch_type
            ctx['item'] = item
            ctx['item_key'] = key
            prepared.append(ctx)

    if not prepared:
        await trace_checkpoint(
            'file_pass1_done',
            {
                'phase': 'file_pass1',
                'course_id': course_id,
                'count': 0,
                'reason': 'no_parseable_files',
                **graph_payload_for_checkpoint(course_id, full=full_graph),
            },
            pause=True,
        )
        return seed_state or {}

    await trace_checkpoint(
        'file_pass1_phase',
        {
            'phase': 'file_pass1',
            'course_id': course_id,
            'count': len(prepared),
            'file_concurrency': concurrency,
            'items': _summarize_files(prepared),
            **graph_payload_for_checkpoint(course_id, full=full_graph),
        },
        pause=True,
    )

    await trace_activity(f'Pass 1 — all {len(prepared)} file(s) concurrently…')
    await _run_batched_file_passes(prepared, pass_start=0, pass_end=1, skip_classify=False)

    from canvas_parser.parse.file_types import get_file_type_profile

    for ctx in prepared:
        node = parser_mod.fileNodes.get(ctx['courseid'], {}).get(ctx['fileid'])
        type_id = ''
        if node and getattr(node, 'type', None):
            type_id = str(node.type or '')
        if not type_id:
            type_id = str((ctx.get('filemeta') or {}).get('academicFileType') or 'generic_content')
        ctx['profile'] = get_file_type_profile(type_id or 'generic_content')

    await trace_checkpoint(
        'file_pass1_done',
        {
            'phase': 'file_pass1',
            'course_id': course_id,
            'count': len(prepared),
            'items': _summarize_files(prepared),
            **graph_payload_for_checkpoint(course_id, full=full_graph),
        },
        pause=True,
    )

    pass2_rows = [
        ctx for ctx in prepared
        if parser_mod.debug_file_pass2_eligible(
            ctx['courseid'],
            ctx['fileid'],
            ctx.get('profile'),
            linked_pass1_only=bool(ctx.get('linked_pass1_only')),
        )
    ]

    if pass2_rows:
        await trace_checkpoint(
            'file_pass2_phase',
            {
                'phase': 'file_pass2',
                'course_id': course_id,
                'count': len(pass2_rows),
                'skipped_pass2': len(prepared) - len(pass2_rows),
                'items': _summarize_files(pass2_rows),
                **graph_payload_for_checkpoint(course_id, full=full_graph),
            },
            pause=True,
        )
        await trace_activity(f'Pass 2 — {len(pass2_rows)} file(s) concurrently…')
        await _run_batched_file_passes(pass2_rows, pass_start=1, pass_end=2, skip_classify=True)

    await trace_checkpoint(
        'file_pass2_done',
        {
            'phase': 'file_pass2',
            'course_id': course_id,
            'count': len(pass2_rows),
            'prepared_total': len(prepared),
            'items': _summarize_files(pass2_rows),
            **graph_payload_for_checkpoint(course_id, full=full_graph),
        },
        pause=True,
    )

    for ctx in prepared:
        await parser_mod.debug_finalize_canvas_file(ctx)

    from canvas_parser.parse.lambda_runtime import export_parser_state

    return export_parser_state()
