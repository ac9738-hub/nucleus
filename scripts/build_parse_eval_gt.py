#!/usr/bin/env python3
"""Multi-pass quality parse to build per-file GT for the rotating eval pool."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.weekly_iteration.auth import apply_env_file  # noqa: E402

apply_env_file(ROOT / '.env')

from canvas_parser.parse.parse_eval_gt import (  # noqa: E402
    GT_PASSES,
    extract_file_gt_from_fragment,
    save_file_gt,
)
from canvas_parser.parse.parse_pass_overrides import (
    inject_preclassified_file_seed,
    plan_passes_for_pool_entry,
    prepare_parse_item,
)
from canvas_parser.parse.parse_modes import apply_parse_mode  # noqa: E402
from canvas_parser.parse.rotating_eval import (  # noqa: E402
    DEFAULT_POOL,
    build_parse_item,
    load_pool,
    load_syllabus_seed,
    resolve_pool_path,
)
from canvas_parser.parse.parse_pass_plan import aggregate_pass_audits  # noqa: E402
from canvas_parser.parse.lambda_runtime import process_single_item  # noqa: E402

FIXTURE_ROOT = ROOT / 'fixtures' / 'parse_eval'
DEFAULT_PROFILE = FIXTURE_ROOT / 'profile.json'


def load_profile() -> dict:
    if DEFAULT_PROFILE.is_file():
        return json.loads(DEFAULT_PROFILE.read_text(encoding='utf-8'))
    return {'gtBuild': {'parseMode': 'llm-cost', 'qualityConcurrency': 4}}


async def build_gt_for_entry(
    pool: dict,
    entry: dict,
    *,
    placement: str = 'local_download_parse',
) -> dict:
    course_id = str(entry.get('courseId') or '')
    file_id = str(entry.get('fileId') or '')
    seed = load_syllabus_seed(pool, entry)
    item = build_parse_item(entry)
    if not item.get('url'):
        item['url'] = f'local://{file_id}'

    pre_plan = plan_passes_for_pool_entry(
        entry,
        syllabus_seed_present=bool(seed),
        for_gt_build=True,
    )
    seed = inject_preclassified_file_seed(seed, entry, pre_plan)
    item = prepare_parse_item(item, entry, pre_plan)

    fragment = await process_single_item(
        'file',
        item,
        placement=placement,
        production=False,
        seed_state=seed or None,
    )
    record = extract_file_gt_from_fragment(
        fragment,
        course_id=course_id,
        file_id=file_id,
        filename=str(entry.get('filename') or ''),
        passes_completed=pre_plan.needed_pass_ids(),
        build_mode='llm_cost_multi_pass',
    )
    gt_path = resolve_pool_path(pool, str(entry.get('gtPath') or f'gt/{course_id}/{file_id}.json'))
    save_file_gt(gt_path, record)
    return {'gtPath': str(gt_path), 'record': record, 'passPlan': pre_plan.to_dict()}


async def build_all(
    pool: dict,
    *,
    placement: str,
    quality_concurrency: int,
    limit: int | None,
    course_id: str | None,
) -> dict:
    entries = list(pool.get('files') or [])
    if course_id:
        entries = [e for e in entries if str(e.get('courseId') or '') == str(course_id)]
    if limit:
        entries = entries[:limit]

    sem = asyncio.Semaphore(max(1, quality_concurrency))
    results: list[dict] = []
    errors: list[dict] = []

    async def _one(entry: dict) -> None:
        async with sem:
            try:
                row = await build_gt_for_entry(pool, entry, placement=placement)
                results.append({
                    'courseId': entry.get('courseId'),
                    'fileId': entry.get('fileId'),
                    'conceptCount': row['record'].get('conceptCount'),
                    'detailCount': row['record'].get('detailCount'),
                    'gtPath': row['gtPath'],
                    'passAudit': row['record'].get('passAudit'),
                    'estLlmCalls': (row['record'].get('passPlan') or {}).get('estLlmCalls'),
                })
                print(
                    f"GT {entry.get('courseId')}/{entry.get('fileId')} "
                    f"concepts={row['record'].get('conceptCount')} details={row['record'].get('detailCount')}"
                )
            except Exception as exc:
                errors.append({
                    'courseId': entry.get('courseId'),
                    'fileId': entry.get('fileId'),
                    'error': str(exc),
                })
                print(f"FAIL {entry.get('courseId')}/{entry.get('fileId')}: {exc}", file=sys.stderr)

    await asyncio.gather(*[_one(entry) for entry in entries])
    pass_audits = [r['passAudit'] for r in results if r.get('passAudit')]
    return {
        'built': len(results),
        'failed': len(errors),
        'results': results,
        'errors': errors,
        'passAuditAggregate': aggregate_pass_audits(pass_audits),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--placement', default='local_download_parse')
    parser.add_argument('--limit', type=int, default=0, help='Max files (0 = all)')
    parser.add_argument('--course-id', default='')
    parser.add_argument('--quality-concurrency', type=int, default=0)
    parser.add_argument('--parse-mode', default='')
    args = parser.parse_args()

    if not args.pool.is_file():
        print(f'Pool not found: {args.pool}. Run build_parse_eval_pool.py first.', file=sys.stderr)
        return 1

    profile = load_profile()
    gt_build = profile.get('gtBuild') or {}
    parse_mode = args.parse_mode or str(gt_build.get('parseMode') or 'llm-cost')
    quality_concurrency = args.quality_concurrency or int(gt_build.get('qualityConcurrency') or 4)

    apply_parse_mode(parse_mode)

    pool = load_pool(args.pool)
    report = asyncio.run(build_all(
        pool,
        placement=args.placement,
        quality_concurrency=quality_concurrency,
        limit=args.limit or None,
        course_id=args.course_id or None,
    ))

    out = ROOT / '.cache' / 'parse_eval' / 'gt_build_report.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f'GT build complete: {report["built"]} ok, {report["failed"]} failed → {out}')
    return 1 if report['failed'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
