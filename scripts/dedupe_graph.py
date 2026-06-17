"""Collapse duplicate concept details (and examples) in canvas_graph.json.

Matches add_detail_node dedupe: keep the first node per concept + title.
Use after a parser run that created repeat pass-2 detail rows.

  python scripts/dedupe_graph.py --dry-run
  python scripts/dedupe_graph.py
  python scripts/dedupe_graph.py --graph canvas_graph.json.pre_full_reparse.bak
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def atomic_write_json(path: Path, data: dict) -> None:
    temp = path.with_name(f'.{path.name}.{os.getpid()}.{time.time_ns()}.tmp')
    with open(temp, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def dedupe_named_children(items: list[dict], name_key: str = 'name') -> tuple[list[dict], int]:
    kept: list[dict] = []
    seen: set[str] = set()
    removed = 0
    for item in items or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get(name_key) or '').strip()
        if title in seen:
            removed += 1
            continue
        seen.add(title)
        kept.append(item)
    return kept, removed


def dedupe_logged_details(items: list[dict]) -> tuple[list[dict], int]:
    kept: list[dict] = []
    seen: set[tuple[str, str]] = set()
    removed = 0
    for item in items or []:
        if not isinstance(item, dict):
            continue
        key = (
            str(item.get('conceptname') or '').strip(),
            str(item.get('detailname') or '').strip(),
        )
        if key in seen:
            removed += 1
            continue
        seen.add(key)
        kept.append(item)
    return kept, removed


def dedupe_graph(state: dict) -> dict[str, int]:
    stats = {
        'details_removed': 0,
        'examples_removed': 0,
        'logged_details_removed': 0,
        'concepts_touched': 0,
    }

    for concept in state.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        before_details = len(concept.get('details') or [])
        before_examples = len(concept.get('examples') or [])
        concept['details'], detail_removed = dedupe_named_children(concept.get('details') or [])
        concept['examples'], example_removed = dedupe_named_children(concept.get('examples') or [])
        if detail_removed or example_removed:
            stats['concepts_touched'] += 1
        stats['details_removed'] += detail_removed
        stats['examples_removed'] += example_removed

    logged = state.get('logged_details') or {}
    if isinstance(logged, dict):
        for course_id, items in logged.items():
            deduped, removed = dedupe_logged_details(items or [])
            logged[course_id] = deduped
            stats['logged_details_removed'] += removed
        state['logged_details'] = logged

    return stats


def count_details(state: dict) -> tuple[int, int]:
    concepts = state.get('concepts') or []
    stored = sum(len(c.get('details') or []) for c in concepts if isinstance(c, dict))
    unique = 0
    for concept in concepts:
        if not isinstance(concept, dict):
            continue
        seen = set()
        for detail in concept.get('details') or []:
            name = str((detail or {}).get('name') or '').strip()
            if name not in seen:
                seen.add(name)
                unique += 1
    return stored, unique


def main() -> int:
    parser = argparse.ArgumentParser(description='Dedupe duplicate concept details in canvas_graph.json.')
    parser.add_argument(
        '--graph',
        type=Path,
        default=ROOT / 'canvas_graph.json',
        help='Graph JSON path (default: canvas_graph.json)',
    )
    parser.add_argument('--dry-run', action='store_true', help='Print stats only; do not write.')
    args = parser.parse_args()

    graph_path = args.graph.resolve()
    if not graph_path.is_file():
        print(f'Graph not found: {graph_path}', file=sys.stderr)
        return 1

    state = json.loads(graph_path.read_text(encoding='utf-8'))
    before_stored, before_unique = count_details(state)
    stats = dedupe_graph(state)
    after_stored, after_unique = count_details(state)

    print(f'Graph: {graph_path}')
    print(f'  details before: {before_stored} stored / {before_unique} unique titles')
    print(f'  details after:  {after_stored} stored / {after_unique} unique titles')
    print(f'  removed:        {stats["details_removed"]} detail rows')
    print(f'  examples removed: {stats["examples_removed"]}')
    print(f'  logged_details removed: {stats["logged_details_removed"]}')
    print(f'  concepts touched: {stats["concepts_touched"]}')

    if args.dry_run:
        print('Dry run — file not modified.')
        return 0

    if stats['details_removed'] == 0 and stats['examples_removed'] == 0 and stats['logged_details_removed'] == 0:
        print('Nothing to dedupe.')
        return 0

    backup = graph_path.with_suffix(graph_path.suffix + '.pre_dedupe.bak')
    if not backup.exists():
        import shutil
        shutil.copy2(graph_path, backup)
        print(f'Backup: {backup.name}')

    atomic_write_json(graph_path, state)
    print(f'Wrote {graph_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
