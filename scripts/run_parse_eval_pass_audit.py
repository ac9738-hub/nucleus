#!/usr/bin/env python3
"""Offline per-pass audit for the parse eval pool (no LLM).

Compares pass plans + heuristic routing against template GT, flags misroutes,
and aggregates step-level cut/keep guidance before running expensive eval.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.file_types import heuristic_classify  # noqa: E402
from canvas_parser.parse.parse_eval_gt import load_file_gt  # noqa: E402
from canvas_parser.parse.parse_pass_overrides import (  # noqa: E402
    plan_passes_for_pool_entry,
    prepare_parse_item,
    snippet_for_pool_entry,
)
from canvas_parser.parse.parse_pass_plan import (  # noqa: E402
    PASS_IDS,
    summarize_pool_pass_plans,
)
from canvas_parser.parse.rotating_eval import (  # noqa: E402
    DEFAULT_POOL,
    load_pool,
    resolve_pool_path,
)

DEFAULT_OUT = ROOT / '.cache' / 'parse_eval' / 'pass_audit_report.json'


def _pass_guidance_from_plan(plan_dict: dict) -> list[dict]:
    rows = []
    for step in plan_dict.get('steps') or []:
        pid = str(step.get('pass') or '')
        needed = bool(step.get('needed'))
        llm = bool(step.get('llmCall'))
        verdict = 'keep'
        if pid == 'llm_classify' and not needed:
            verdict = 'cut_ok'
        elif pid == 'llm_pass2' and not needed:
            verdict = 'cut_ok'
        elif pid == 'llm_pass1' and not needed:
            verdict = 'cut_ok'
        elif pid == 'extract_pages' or pid == 'heuristic_classify' or pid == 'finalize':
            verdict = 'keep'
        rows.append({
            'pass': pid,
            'needed': needed,
            'llmCall': llm,
            'verdict': verdict,
            'reason': step.get('reason', ''),
        })
    return rows


def audit_pool(pool: dict, *, syllabus_seeded: bool = True) -> dict:
    entries = list(pool.get('files') or [])
    summary = summarize_pool_pass_plans(entries, use_snippets=True)
    file_rows: list[dict] = []
    type_mismatch: list[dict] = []
    generic_remaining: list[dict] = []
    classify_required: list[dict] = []
    pass1_required: list[dict] = []
    syllabus_skip = 0

    for entry in entries:
        course_id = str(entry.get('courseId') or '')
        file_id = str(entry.get('fileId') or '')
        filename = str(entry.get('filename') or '')
        snippet = snippet_for_pool_entry(entry)
        heur_type, heur_conf = heuristic_classify(filename=filename, snippet=snippet)
        plan = plan_passes_for_pool_entry(entry, syllabus_seed_present=syllabus_seeded)
        item = prepare_parse_item({'id': file_id, 'courseid': course_id}, entry, plan)

        gt_path = resolve_pool_path(pool, str(entry.get('gtPath') or ''))
        gt_type = ''
        gt_concepts = 0
        if gt_path.is_file():
            gt = load_file_gt(gt_path)
            gt_type = str(gt.get('expectedFileType') or '')
            gt_concepts = int(gt.get('conceptCount') or 0)

        if plan.resolved_type != gt_type and gt_type:
            type_mismatch.append({
                'courseId': course_id,
                'fileId': file_id,
                'filename': filename,
                'gtType': gt_type,
                'planType': plan.resolved_type,
                'heuristicType': heur_type,
                'heuristicConfidence': round(heur_conf, 4),
            })

        if not item.get('skipLlmClassify'):
            classify_required.append({
                'fileId': file_id,
                'filename': filename,
                'resolvedType': plan.resolved_type,
            })
        if not item.get('skipLlmPass1'):
            pass1_required.append({
                'fileId': file_id,
                'filename': filename,
                'resolvedType': plan.resolved_type,
                'gtConceptCount': gt_concepts,
            })

        if plan.resolved_type == 'generic_content':
            generic_remaining.append({
                'fileId': file_id,
                'filename': filename,
                'heuristicConfidence': round(heur_conf, 4),
            })

        if 'llm_pass1' in plan.skipped_pass_ids() and plan.resolved_type == 'syllabus':
            syllabus_skip += 1

        file_rows.append({
            'courseId': course_id,
            'fileId': file_id,
            'filename': filename,
            'resolvedType': plan.resolved_type,
            'gtType': gt_type,
            'gtConceptCount': gt_concepts,
            'estLlmCalls': plan.est_llm_calls(),
            'skipLlmPass1': bool(item.get('skipLlmPass1')),
            'skipLlmClassify': bool(item.get('skipLlmClassify')),
            'skipPass2': bool(item.get('skipPass2')),
            'passes': _pass_guidance_from_plan(plan.to_dict()),
        })

    per_pass = {pid: {'keep': 0, 'cut_ok': 0, 'llmCalls': 0} for pid in PASS_IDS}
    for row in file_rows:
        for step in row['passes']:
            bucket = per_pass.setdefault(step['pass'], {'keep': 0, 'cut_ok': 0, 'llmCalls': 0})
            if step['verdict'] == 'cut_ok':
                bucket['cut_ok'] += 1
            else:
                bucket['keep'] += 1
            if step.get('llmCall'):
                bucket['llmCalls'] += 1

    return {
        'pool': str(DEFAULT_POOL),
        'fileCount': len(entries),
        'passPlanSummary': summary,
        'syllabusPass1Skipped': syllabus_skip,
        'typeMismatchCount': len(type_mismatch),
        'typeMismatchesSample': type_mismatch[:20],
        'genericContentRemaining': generic_remaining,
        'classifyRequiredFiles': classify_required,
        'pass1RequiredFiles': pass1_required,
        'pass1RequiredCount': len(pass1_required),
        'classifyRequiredCount': len(classify_required),
        'perPassAggregate': per_pass,
        'recommendations': _recommendations(summary, type_mismatch, generic_remaining),
        'filesSample': file_rows[:6],
    }


def _recommendations(summary: dict, mismatches: list, generic: list) -> list[str]:
    recs: list[str] = []
    fc = summary.get('fileCount') or 0
    if summary.get('skipLlmClassify') == fc:
        recs.append('llm_classify: cut for entire pool — heuristic/snippet routing sufficient.')
    if summary.get('skipPass2Profile') == fc:
        recs.append('llm_pass2: cut for entire pool — single-pass profiles + finalize promote.')
    if summary.get('skipPass1EmptySignal'):
        recs.append(
            f"llm_pass1: skip for {summary['skipPass1EmptySignal']} files with empty heuristic teaching signal."
        )
    if summary.get('skipPass1HeuristicProfile'):
        recs.append(
            f"llm_pass1: skip for {summary['skipPass1HeuristicProfile']} link-only types "
            '(no concept/problem profile) — heuristic seed replaces pass1 in llm-cost.'
        )
    if summary.get('skipSyllabusLlmWhenSeeded'):
        recs.append(
            f"llm_pass1: skip for {summary['skipSyllabusLlmWhenSeeded']} seeded syllabus PDFs."
        )
    if mismatches:
        recs.append(
            f'heuristic_classify: fix {len(mismatches)} plan vs GT type mismatches '
            '(filename patterns, not pool literals).'
        )
    if generic:
        recs.append(
            f'heuristic_classify: {len(generic)} files still generic_content — '
            'add structural filename/snippet patterns or accept 1 pass1 call each.'
        )
    recs.append(
        f"Rotating eval est. {summary.get('rotatingEvalEstLlmCalls')} LLM calls / "
        f"{summary.get('rotatingEvalFileCount')} content files "
        f"({summary.get('rotatingEvalAvgLlmCalls')} avg)."
    )
    return recs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if not args.pool.is_file():
        print(f'Pool not found: {args.pool}', file=sys.stderr)
        return 1

    pool = load_pool(args.pool)
    report = audit_pool(pool)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({
        'fileCount': report['fileCount'],
        'typeMismatchCount': report['typeMismatchCount'],
        'genericContentRemaining': len(report['genericContentRemaining']),
        'syllabusPass1Skipped': report['syllabusPass1Skipped'],
        'recommendations': report['recommendations'],
    }, indent=2))
    print(f'Wrote {args.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
