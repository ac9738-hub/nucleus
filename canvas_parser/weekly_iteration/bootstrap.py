"""Bootstrap fixtures and cache for weekly iteration (cloud agent / CI)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from .course_match import find_snapshot_for_ground_truth, parse_ground_truth_filename
from .fetch import load_snapshots
from .paths import default_snapshot_path, fixture_snapshot_path


def export_gt_fixtures(
    root: Path,
    *,
    snapshot_path: Path | None = None,
    ground_truth_dir: Path | None = None,
    output_path: Path | None = None,
) -> Path:
    """Write ground-truth course snapshots to fixtures/weekly_iteration/snapshots_gt.json."""
    root = Path(root)
    source = snapshot_path or default_snapshot_path(root)
    if not source.is_file():
        raise FileNotFoundError(f'Snapshot not found: {source}')

    gt_dir = ground_truth_dir or (root / 'ground-truth')
    out = output_path or fixture_snapshot_path(root)
    snapshots = load_snapshots(source)
    selected = []
    for gt_path in sorted(gt_dir.glob('*.json')):
        spec = parse_ground_truth_filename(gt_path.name)
        snapshot = find_snapshot_for_ground_truth(snapshots, spec)
        if snapshot:
            selected.append(snapshot)

    if not selected:
        raise RuntimeError(f'No ground-truth courses matched in {source}')

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(selected, ensure_ascii=False), encoding='utf-8')
    return out


def seed_cache_from_fixtures(root: Path) -> Path:
    """Copy committed GT fixtures into .cache for the default eval snapshot path."""
    root = Path(root)
    fixture = fixture_snapshot_path(root)
    if not fixture.is_file():
        raise FileNotFoundError(f'Fixture not found: {fixture}')

    cache_path = default_snapshot_path(root)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(fixture, cache_path)
    return cache_path


def main(argv: list[str] | None = None) -> int:
    import argparse

    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description='Bootstrap weekly iteration fixtures/cache.')
    parser.add_argument('--root', default=str(root))
    sub = parser.add_subparsers(dest='command', required=True)

    export_cmd = sub.add_parser('export-fixtures', help='Export GT courses from cache to fixtures/')
    export_cmd.add_argument('--snapshot', help='Source snapshot (default: .cache/.../snapshots_enriched.json)')

    seed_cmd = sub.add_parser('seed-cache', help='Copy fixtures into .cache for default eval path')

    args = parser.parse_args(argv)
    root = Path(args.root)

    if args.command == 'export-fixtures':
        snapshot = Path(args.snapshot) if args.snapshot else None
        out = export_gt_fixtures(root, snapshot_path=snapshot)
        print(f'Wrote {out} ({out.stat().st_size} bytes)')
        return 0

    if args.command == 'seed-cache':
        out = seed_cache_from_fixtures(root)
        print(f'Seeded cache snapshot: {out}')
        return 0

    return 1


if __name__ == '__main__':
    raise SystemExit(main())
