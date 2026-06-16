"""Fetch and cache Canvas snapshots for weekly iteration."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .auth import load_auth_from_env
from .fetch import (
    CanvasFetchError,
    enrich_snapshot_with_page_bodies,
    fetch_all_courses,
    fetch_course_snapshots_by_ids,
    load_snapshots,
    save_snapshots,
    validate_auth,
)
from .paths import default_snapshot_path


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]

    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')

    parser = argparse.ArgumentParser(description='Fetch Canvas snapshots for weekly iteration.')
    parser.add_argument('--root', default=str(root))
    parser.add_argument('--snapshot', help='Refresh an existing snapshot file in place')
    parser.add_argument('--save', default=str(default_snapshot_path(root)), help='Output snapshot path')
    parser.add_argument('--enrich-pages', action='store_true', help='Fetch module page bodies')
    parser.add_argument(
        '--course-id',
        action='append',
        type=int,
        help='Fetch only these Canvas course id(s); repeatable',
    )
    args = parser.parse_args(argv)

    root = Path(args.root)
    auth = load_auth_from_env(root)
    save_path = Path(args.save)
    if not save_path.is_absolute():
        save_path = root / save_path

    if args.snapshot:
        snapshot_path = Path(args.snapshot)
        if not snapshot_path.is_absolute():
            snapshot_path = root / snapshot_path
        snapshots = load_snapshots(snapshot_path)
    elif args.course_id:
        try:
            validate_auth(auth)
            snapshots = fetch_course_snapshots_by_ids(auth, args.course_id)
        except CanvasFetchError as error:
            print(f'Canvas fetch failed: {error}', file=sys.stderr)
            return 2
    else:
        try:
            snapshots = fetch_all_courses(auth)
        except CanvasFetchError as error:
            print(f'Canvas fetch failed: {error}', file=sys.stderr)
            return 2

    if args.enrich_pages:
        snapshots = [enrich_snapshot_with_page_bodies(auth, snapshot) for snapshot in snapshots]

    save_path.parent.mkdir(parents=True, exist_ok=True)
    save_snapshots(snapshots, save_path)
    print(f'Saved {len(snapshots)} course snapshot(s) to {save_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
