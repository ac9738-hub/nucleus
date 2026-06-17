"""Full parser re-run from cached Canvas snapshots (GT + holdout).

Deletes canvas_graph.json, feeds parser.py all batches from enriched/holdout
snapshots, and waits for parser completion. Backs up the previous graph first.

Requires DEEP_SEEK_API_KEY (parser LLM) and OPENAI_API_KEY (embed pass).
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.weekly_iteration.auth import load_auth_from_env  # noqa: E402
from canvas_parser.weekly_iteration.llm_parse import (  # noqa: E402
    build_parser_batches,
    run_parser_batches,
)


def load_snapshot_courses(root: Path) -> list[dict]:
    """Merge snapshots from enriched cache, holdout cache, and GT fixtures."""
    paths = [
        root / '.cache' / 'weekly_iteration' / 'snapshots_enriched.json',
        root / '.cache' / 'weekly_iteration' / 'snapshots_holdout.json',
        root / 'fixtures' / 'weekly_iteration' / 'snapshots_gt.json',
    ]
    by_course_id: dict[str, dict] = {}
    for path in paths:
        if not path.is_file():
            continue
        snapshots = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(snapshots, list):
            continue
        for snapshot in snapshots:
            course = snapshot.get('course') or {}
            course_id = str(course.get('id') or '').strip()
            if course_id:
                by_course_id[course_id] = snapshot
    return list(by_course_id.values())


def backup_graph(root: Path, label: str = 'pre_full_reparse') -> Path | None:
    graph_path = root / 'canvas_graph.json'
    if not graph_path.is_file():
        return None
    backup_path = root / f'canvas_graph.json.{label}.bak'
    shutil.copy2(graph_path, backup_path)
    return backup_path


def count_graph_nodes(graph_path: Path) -> dict:
    if not graph_path.is_file():
        return {}
    state = json.loads(graph_path.read_text(encoding='utf-8'))
    concepts = state.get('concepts') or []
    detail_total = sum(len(c.get('details') or []) for c in concepts)
    seen_titles = 0
    for concept in concepts:
        seen = set()
        for detail in concept.get('details') or []:
            name = str(detail.get('name') or '').strip()
            if name not in seen:
                seen.add(name)
                seen_titles += 1
    files = sum(len(v or {}) for v in (state.get('files') or {}).values())
    assignments = sum(
        len((syllabus or {}).get('assignments') or [])
        for syllabus in (state.get('syllabi') or {}).values()
    )
    return {
        'concepts': len(concepts),
        'details_stored': detail_total,
        'details_unique_title_per_concept': seen_titles,
        'examples': sum(len(c.get('examples') or []) for c in concepts),
        'events': len(state.get('events') or []),
        'problems': len(state.get('problems') or []),
        'files': files,
        'assignments': assignments,
        'syllabi': len(state.get('syllabi') or {}),
    }


def full_reparse(
    root: Path,
    *,
    timeout_seconds: int = 7200,
    dry_run: bool = False,
) -> int:
    snapshots = load_snapshot_courses(root)
    if not snapshots:
        print('No snapshots found under .cache/weekly_iteration/ or fixtures/.', file=sys.stderr)
        return 1

    auth = load_auth_from_env(root)
    if not auth.base_url:
        auth = load_auth_from_env(root)  # pragma: no cover — ensure env loaded

    batches: list[dict] = []
    for snapshot in snapshots:
        batches.extend(build_parser_batches(snapshot, auth.base_url or 'https://princeton.instructure.com'))

    course_ids = sorted(str(s.get('course', {}).get('id', '')) for s in snapshots)
    item_count = sum(len(b.get('content') or []) for b in batches)
    print(f'Snapshots: {len(snapshots)} courses {course_ids}')
    print(f'Parser batches: {len(batches)} ({item_count} items)')

    before = count_graph_nodes(root / 'canvas_graph.json')
    if before:
        print('Graph before:', before)

    if dry_run:
        print('Dry run — no parser subprocess started.')
        return 0

    backup = backup_graph(root)
    if backup:
        print(f'Backed up graph to {backup.name}')

    started = time.perf_counter()
    try:
        run_parser_batches(batches, root, auth, timeout_seconds=timeout_seconds, keep_graph=True)
    except Exception as error:
        print(f'Full reparse failed: {error}', file=sys.stderr)
        return 1

    elapsed = time.perf_counter() - started
    after = count_graph_nodes(root / 'canvas_graph.json')
    print(f'Full reparse finished in {elapsed / 60:.1f} min.')
    print('Graph after:', after)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description='Full parser re-run from cached snapshots.')
    parser.add_argument(
        '--timeout',
        type=int,
        default=7200,
        help='Parser subprocess timeout in seconds (default: 7200 = 2h)',
    )
    parser.add_argument('--dry-run', action='store_true', help='Print batch stats only.')
    args = parser.parse_args()
    return full_reparse(ROOT, timeout_seconds=args.timeout, dry_run=args.dry_run)


if __name__ == '__main__':
    raise SystemExit(main())
