#!/usr/bin/env python3
"""Run one rotating file parse eval at high concurrency with syllabus-seeded prompts."""
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

from canvas_parser.parse.concurrency_audit import audit_report  # noqa: E402
from canvas_parser.parse.parse_eval_concurrency import apply_eval_concurrency_env  # noqa: E402
from canvas_parser.parse.parse_modes import apply_parse_mode  # noqa: E402
from canvas_parser.parse.rotating_eval import (  # noqa: E402
    DEFAULT_POOL,
    build_parse_item,
    evaluate_candidate_fragment,
    load_pool,
    load_profile,
    load_rotation_state,
    load_syllabus_seed,
    rotation_summary,
    save_rotation_state,
    select_rotating_entry,
    syllabus_prompt_context,
)
from canvas_parser.parse.parse_pass_overrides import (  # noqa: E402
    inject_preclassified_file_seed,
    plan_passes_for_pool_entry,
    prepare_parse_item,
)
from canvas_parser.parse.parse_pass_plan import audit_fragment_passes  # noqa: E402
from canvas_parser.parse.lambda_runtime import process_single_item  # noqa: E402

DEFAULT_REPORT = ROOT / '.cache' / 'parse_eval' / 'last_run.json'


async def parse_with_syllabus_seed(
    entry: dict,
    pool: dict,
    *,
    placement: str,
    production: bool,
) -> tuple[dict, dict, dict]:
    seed = load_syllabus_seed(pool, entry)
    pre_plan = plan_passes_for_pool_entry(
        entry,
        syllabus_seed_present=bool(seed),
        for_gt_build=False,
    )
    seed = inject_preclassified_file_seed(seed, entry, pre_plan)
    item = prepare_parse_item(build_parse_item(entry), entry, pre_plan)
    prompt_ctx = syllabus_prompt_context(seed, str(entry.get('courseId') or ''))
    os.environ['PARSER_EVAL_SYLLABUS_CONTEXT'] = json.dumps(prompt_ctx, ensure_ascii=False)
    fragment = await process_single_item(
        'file',
        item,
        placement=placement,
        production=production,
        seed_state=seed or None,
    )
    fragment['_eval'] = {'syllabusPromptContext': prompt_ctx, 'passPlan': pre_plan.to_dict()}
    return fragment, prompt_ctx, pre_plan.to_dict()


async def run_eval(args: argparse.Namespace) -> dict:
    pool = load_pool(args.pool)
    profile = load_profile()
    concurrency = apply_eval_concurrency_env(
        int(args.concurrency or profile.get('concurrency') or 1000),
    )
    eval_cfg = profile.get('eval') or {}
    parse_mode = args.parse_mode or str(eval_cfg.get('parseMode') or 'llm-cost')
    apply_parse_mode(parse_mode)

    state = load_rotation_state()
    entry, state = select_rotating_entry(
        pool,
        mode=args.mode,
        seed=args.seed,
        state=state,
        require_gt=not args.allow_missing_gt,
    )
    if not args.dry_run:
        save_rotation_state(state)

    report: dict = {
        'rotation': rotation_summary(pool, state),
        'selected': {
            'courseId': entry.get('courseId'),
            'fileId': entry.get('fileId'),
            'filename': entry.get('filename'),
            'representativeReason': entry.get('representativeReason'),
        },
        'concurrency': concurrency,
        'parseMode': parse_mode,
        'concurrencyAudit': audit_report(),
    }

    if args.dry_run:
        seed = load_syllabus_seed(pool, entry)
        report['syllabusPromptContext'] = syllabus_prompt_context(
            seed, str(entry.get('courseId') or ''),
        )
        report['dryRun'] = True
        return report

    fragment, prompt_ctx, pass_plan = await parse_with_syllabus_seed(
        entry,
        pool,
        placement=args.placement,
        production=args.production,
    )
    comparison = evaluate_candidate_fragment(
        fragment,
        entry,
        pool,
        concurrency=concurrency,
    )
    from canvas_parser.parse.parse_pass_plan import plan_passes_for_pool_entry

    pass_audit = audit_fragment_passes(
        fragment,
        course_id=str(entry.get('courseId') or ''),
        file_id=str(entry.get('fileId') or ''),
        filename=str(entry.get('filename') or ''),
        file_type_hint=str(entry.get('fileType') or ''),
        plan=plan_passes_for_pool_entry(
            entry,
            syllabus_seed_present=bool(load_syllabus_seed(pool, entry)),
            for_gt_build=False,
        ),
    )
    report['syllabusPromptContext'] = prompt_ctx
    report['passPlan'] = pass_plan
    report['passAudit'] = pass_audit
    report['comparison'] = {k: v for k, v in comparison.items() if k != 'candidate'}
    report['passed'] = comparison.get('passed', False)
    report['concurrencyAudit'] = comparison.get('concurrencyAudit') or audit_report()
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--concurrency', type=int, default=1000)
    parser.add_argument('--parse-mode', default='')
    parser.add_argument('--placement', default='local_download_parse')
    parser.add_argument('--production', action='store_true')
    parser.add_argument('--mode', choices=('round_robin', 'random'), default='round_robin')
    parser.add_argument('--seed', type=int, default=None)
    parser.add_argument('--dry-run', action='store_true', help='Select file + syllabus only, no parse')
    parser.add_argument('--allow-missing-gt', action='store_true')
    parser.add_argument('--out', type=Path, default=DEFAULT_REPORT)
    parser.add_argument('--audit-only', action='store_true', help='Print concurrency audit and exit')
    args = parser.parse_args()

    if args.audit_only:
        report = audit_report()
        print(json.dumps(report, indent=2))
        return 0

    if not args.dry_run and not args.pool.is_file():
        print(f'Pool not found: {args.pool}. Run build_parse_eval_pool.py first.', file=sys.stderr)
        return 1

    report = asyncio.run(run_eval(args))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')

    selected = report.get('selected') or {}
    if report.get('dryRun'):
        print(f"Dry run: {selected.get('courseId')}/{selected.get('fileId')} — {selected.get('filename')}")
    else:
        cmp_ = report.get('comparison') or {}
        status = 'PASS' if report.get('passed') else 'FAIL'
        print(
            f"{status} {selected.get('courseId')}/{selected.get('fileId')} "
            f"recall={cmp_.get('conceptRecall')} detail_ratio={cmp_.get('detailRatio')} "
            f"concurrency={report.get('concurrency')}"
        )
        flags = (report.get('concurrencyAudit') or {}).get('riskFlags') or []
        if flags:
            print(f"Risk flags: {', '.join(flags)}")
    print(f'Report -> {args.out}')
    return 0 if report.get('passed', True) else 1


if __name__ == '__main__':
    raise SystemExit(main())
