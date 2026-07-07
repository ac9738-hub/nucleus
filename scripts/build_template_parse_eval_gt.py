#!/usr/bin/env python3
"""Build offline template GT for every file in the parse eval pool."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_eval_gt import save_file_gt  # noqa: E402
from canvas_parser.parse.rotating_eval import (  # noqa: E402
    DEFAULT_POOL,
    load_pool,
    pool_entries,
    resolve_pool_path,
)
from canvas_parser.parse.template_eval_gt import (  # noqa: E402
    TEMPLATE_GT_PASSES,
    build_template_gt_for_pool_entry,
    local_pdf_path,
)

FIXTURE_ROOT = ROOT / 'fixtures' / 'parse_eval'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--course-id', default='', help='Only build GT for this course')
    parser.add_argument('--limit', type=int, default=0, help='Max files (0 = all)')
    parser.add_argument('--dry-run', action='store_true', help='Report only; do not write GT')
    args = parser.parse_args()

    if not args.pool.is_file():
        print(f'Pool not found: {args.pool}', file=sys.stderr)
        return 1

    pool = load_pool(args.pool)
    entries = list(pool.get('files') or [])
    if args.course_id:
        entries = [e for e in entries if str(e.get('courseId') or '') == str(args.course_id)]
    if args.limit:
        entries = entries[: args.limit]

    built: list[dict] = []
    errors: list[dict] = []
    missing_pdf = 0

    for entry in entries:
        course_id = str(entry.get('courseId') or '')
        file_id = str(entry.get('fileId') or '')
        gt_rel = str(entry.get('gtPath') or f'gt/{course_id}/{file_id}.json')
        gt_path = resolve_pool_path(pool, gt_rel)

        if not local_pdf_path(file_id):
            missing_pdf += 1
            errors.append({'courseId': course_id, 'fileId': file_id, 'error': 'missing_local_pdf'})
            print(f'SKIP {course_id}/{file_id}: no local PDF', file=sys.stderr)
            continue

        try:
            record = build_template_gt_for_pool_entry(entry)
            if not args.dry_run:
                save_file_gt(gt_path, record)
            built.append({
                'courseId': course_id,
                'fileId': file_id,
                'filename': entry.get('filename'),
                'expectedFileType': record.get('expectedFileType'),
                'conceptCount': record.get('conceptCount'),
                'detailCount': record.get('detailCount'),
                'problemCount': len(record.get('problems') or []),
                'sectionCount': len(record.get('sections') or []),
                'gtPath': gt_rel,
            })
            print(
                f"GT {course_id}/{file_id} "
                f"type={record.get('expectedFileType')} "
                f"concepts={record.get('conceptCount')} "
                f"details={record.get('detailCount')} "
                f"problems={len(record.get('problems') or [])}"
            )
        except Exception as exc:
            errors.append({'courseId': course_id, 'fileId': file_id, 'error': str(exc)})
            print(f'FAIL {course_id}/{file_id}: {exc}', file=sys.stderr)

    report = {
        'passes': list(TEMPLATE_GT_PASSES),
        'buildMode': 'template_multi_pass_offline',
        'pool': str(args.pool),
        'requested': len(entries),
        'built': len(built),
        'failed': len(errors),
        'missingLocalPdf': missing_pdf,
        'withGtAfterBuild': len(pool_entries(pool, require_gt=True)) if not args.dry_run else None,
        'builtSample': built[:8],
        'errors': errors[:20],
        'summary': {
            'totalConcepts': sum(row.get('conceptCount') or 0 for row in built),
            'totalDetails': sum(row.get('detailCount') or 0 for row in built),
            'totalProblems': sum(row.get('problemCount') or 0 for row in built),
            'byType': _count_by_key(built, 'expectedFileType'),
        },
    }

    out = ROOT / '.cache' / 'parse_eval' / 'template_gt_build_report.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(
        f'Template GT: {report["built"]} built, {report["failed"]} failed '
        f'({report["missingLocalPdf"]} missing PDF) -> {out}'
    )
    return 1 if errors else 0


def _count_by_key(rows: list[dict], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        label = str(row.get(key) or 'unknown')
        counts[label] = counts.get(label, 0) + 1
    return dict(sorted(counts.items()))


if __name__ == '__main__':
    raise SystemExit(main())
