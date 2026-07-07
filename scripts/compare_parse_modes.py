#!/usr/bin/env python3
"""Compare graph outputs from heuristic vs LLM reparse runs."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HEURISTIC = ROOT / '.cache' / 'reparse' / 'princeton_heuristic.json'
DEFAULT_LLM = ROOT / '.cache' / 'reparse' / 'princeton_llm.json'


def count_graph(state: dict) -> dict:
    concepts = state.get('concepts') or []
    files = sum(len(bucket or {}) for bucket in (state.get('files') or {}).values())
    events = state.get('events') or []
    dated_events = sum(
        1 for event in events
        if str(event.get('startdate') or event.get('enddate') or '').strip()
    )
    syllabi = state.get('syllabi') or {}
    assignments = sum(len((row or {}).get('assignments') or []) for row in syllabi.values())
    return {
        'courses': len(syllabi),
        'concepts': len(concepts),
        'details': sum(len(c.get('details') or []) for c in concepts),
        'examples': sum(len(c.get('examples') or []) for c in concepts),
        'problems': len(state.get('problems') or []),
        'events': len(events),
        'dated_events': dated_events,
        'files': files,
        'assignments': assignments,
        'learning_blocks': sum(len(v or []) for v in (state.get('learningBlocks') or {}).values()),
    }


def load_graph(path: Path) -> dict:
    if not path.is_file():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding='utf-8'))


def compare(left: dict, right: dict) -> dict:
    left_counts = count_graph(left)
    right_counts = count_graph(right)
    delta = {
        key: right_counts.get(key, 0) - left_counts.get(key, 0)
        for key in sorted(set(left_counts) | set(right_counts))
    }
    return {'heuristic': left_counts, 'llm': right_counts, 'delta_llm_minus_heuristic': delta}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--heuristic', type=Path, default=DEFAULT_HEURISTIC)
    parser.add_argument('--llm', type=Path, default=DEFAULT_LLM)
    parser.add_argument('--write-report', type=Path, default=ROOT / '.cache' / 'reparse' / 'mode_comparison.json')
    args = parser.parse_args()

    report = compare(load_graph(args.heuristic), load_graph(args.llm))
    report['paths'] = {'heuristic': str(args.heuristic), 'llm': str(args.llm)}

    args.write_report.parent.mkdir(parents=True, exist_ok=True)
    args.write_report.write_text(json.dumps(report, indent=2), encoding='utf-8')

    print('Parse mode comparison:')
    print('  heuristic:', report['heuristic'])
    print('  llm:      ', report['llm'])
    print('  delta (llm - heuristic):')
    for key, value in report['delta_llm_minus_heuristic'].items():
        print(f'    {key}: {value:+d}')
    print(f'Report: {args.write_report}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
