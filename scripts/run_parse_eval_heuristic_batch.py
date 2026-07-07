#!/usr/bin/env python3
"""Batch offline eval: heuristic/skip-pass1 path vs template GT (no LLM)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_eval_gt import compare_file_to_gt, load_file_gt  # noqa: E402
from canvas_parser.parse.parse_pass_overrides import plan_passes_for_pool_entry, prepare_parse_item  # noqa: E402
from canvas_parser.parse.parse_pass_plan import summarize_pool_pass_plans  # noqa: E402
from canvas_parser.parse.rotating_eval import DEFAULT_POOL, load_pool, resolve_pool_path  # noqa: E402
from canvas_parser.parse.template_eval_gt import (  # noqa: E402
    build_template_gt_for_pool_entry,
    local_pdf_path,
    template_gt_to_eval_fragment,
)

DEFAULT_OUT = ROOT / '.cache' / 'parse_eval' / 'heuristic_batch_report.json'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if not args.pool.is_file():
        print(f'Pool not found: {args.pool}', file=sys.stderr)
        return 1

    pool = load_pool(args.pool)
    entries = list(pool.get('files') or [])
    summary = summarize_pool_pass_plans(entries, use_snippets=True)

    results: list[dict] = []
    skip_pass1_passed = 0
    skip_pass1_total = 0
    llm_pass1_needed = 0

    for entry in entries:
        course_id = str(entry.get('courseId') or '')
        file_id = str(entry.get('fileId') or '')
        if not local_pdf_path(file_id):
            continue
        gt_path = resolve_pool_path(pool, str(entry.get('gtPath') or ''))
        if not gt_path.is_file():
            continue
        gt = load_file_gt(gt_path)
        rebuilt = build_template_gt_for_pool_entry(entry)
        fragment = template_gt_to_eval_fragment(rebuilt)
        score = compare_file_to_gt(fragment, gt)
        plan = plan_passes_for_pool_entry(entry, syllabus_seed_present=True, for_gt_build=False)
        item = prepare_parse_item({'id': file_id, 'courseid': course_id}, entry, plan)
        skip_pass1 = bool(item.get('skipLlmPass1'))
        if skip_pass1:
            skip_pass1_total += 1
            if score.get('passed'):
                skip_pass1_passed += 1
        else:
            llm_pass1_needed += 1
        results.append({
            'courseId': course_id,
            'fileId': file_id,
            'filename': entry.get('filename'),
            'resolvedType': plan.resolved_type,
            'skipLlmPass1': skip_pass1,
            'estLlmCalls': plan.est_llm_calls(),
            'passed': score.get('passed'),
            'conceptRecall': score.get('conceptRecall'),
            'detailRatio': score.get('detailRatio'),
        })

    report = {
        'pool': str(args.pool),
        'fileCount': len(results),
        'passPlanSummary': summary,
        'skipPass1Files': skip_pass1_total,
        'skipPass1SelfCheckPassed': skip_pass1_passed,
        'llmPass1Required': llm_pass1_needed,
        'estLlmCallsRotating': summary.get('rotatingEvalEstLlmCalls'),
        'failures': [r for r in results if not r.get('passed')][:20],
        'resultsSample': results[:8],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({
        'files': report['fileCount'],
        'skipPass1': skip_pass1_total,
        'llmPass1Required': llm_pass1_needed,
        'estLlmCalls': summary.get('rotatingEvalEstLlmCalls'),
        'selfCheckFailures': len(report['failures']),
    }, indent=2))
    print(f'Wrote {args.out}')
    return 0 if not report['failures'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
