#!/usr/bin/env python3
"""Analyze per-pass cost/utility for the parse eval pool without running LLM."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_pass_plan import summarize_pool_pass_plans  # noqa: E402
from canvas_parser.parse.rotating_eval import DEFAULT_POOL, load_pool  # noqa: E402

DEFAULT_OUT = ROOT / '.cache' / 'parse_eval' / 'pass_plan_summary.json'


def _per_pass_guidance(summary: dict) -> dict[str, str]:
    fc = summary.get('fileCount') or 0
    return {
        'extract_pages': 'Keep — required local I/O; zero LLM cost.',
        'heuristic_classify': 'Keep — free filename/snippet routing; pool snippets raise confidence.',
        'llm_classify': (
            f"Cut for {summary.get('skipLlmClassify', 0)}/{fc} files — trust heuristic when "
            f"confidence >= threshold; item-level skipLlmClassify avoids env races."
        ),
        'llm_pass1': (
            f"Keep for {summary.get('rotatingEvalEstLlmCalls', 0)} content files. "
            f"Skip for {summary.get('skipSyllabusLlmWhenSeeded', 0)} seeded syllabus + "
            f"{summary.get('skipPass1HeuristicProfile', 0)} link-only profiles "
            f"(heuristic seed + finalize). Images skip LLM entirely."
        ),
        'llm_pass2': (
            f"Profile-disabled for {summary.get('skipPass2Profile', 0)}/{fc} files. "
            'Runtime also skips when pass1 uses only type-specific log_* tools (promote in finalize), '
            'pass1 is log_problem-only, or log rows were rejected.'
        ),
        'finalize': 'Keep — deterministic promote (logged_details, typeExtractions, slides/textbook) replaces pass2 LLM.',
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if not args.pool.is_file():
        print(f'Pool not found: {args.pool}', file=sys.stderr)
        return 1

    pool = load_pool(args.pool)
    summary = summarize_pool_pass_plans(pool.get('files') or [])
    report = {
        'pool': str(args.pool),
        'fileCount': pool.get('fileCount'),
        'passPlanSummary': summary,
        'rotatingEval': {
            'fileCount': summary.get('rotatingEvalFileCount'),
            'estLlmCalls': summary.get('rotatingEvalEstLlmCalls'),
            'realisticLlmCalls': summary.get('rotatingEvalRealisticLlmCalls'),
            'avgLlmCallsPerFile': summary.get('rotatingEvalAvgLlmCalls'),
            'avgRealisticLlmCallsPerFile': summary.get('rotatingEvalAvgRealisticLlmCalls'),
        },
        'perPassGuidance': _per_pass_guidance(summary),
        'perPassStepCounts': summary.get('perPassStepCounts') or {},
        'byTypeEstCalls': summary.get('byTypeEstCalls') or {},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    print(f'Wrote {args.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
