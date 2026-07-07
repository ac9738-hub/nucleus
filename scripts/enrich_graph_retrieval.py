#!/usr/bin/env python3
"""Backfill retrieval indexes on canvas_graph.json (chunks, edges, searchtext)."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.file_retrieval_index import (  # noqa: E402
    enrich_graph_retrieval,
    load_weekly_schedule,
    merge_missing_courses_from_backup,
)

DEFAULT_GRAPH = ROOT / "canvas_graph.json"
DEFAULT_BACKUP = ROOT / "canvas_graph.json.pre_full_reparse.bak"
DEFAULT_CANVAS_DATA = ROOT / "canvas_data.json"
DEFAULT_REPORT = ROOT / ".cache" / "graph_retrieval" / "enrich_report.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", default=str(DEFAULT_GRAPH))
    parser.add_argument("--backup", default=str(DEFAULT_BACKUP))
    parser.add_argument("--merge-backup", action="store_true", help="Restore courses missing from graph using backup")
    parser.add_argument("--canvas-data", default=str(DEFAULT_CANVAS_DATA))
    parser.add_argument("--course", default="")
    parser.add_argument("--file", default="")
    parser.add_argument("--max-files", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    args = parser.parse_args()

    graph_path = Path(args.graph)
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    merged_courses = []
    if args.merge_backup:
        backup_path = Path(args.backup)
        if backup_path.is_file():
            backup = json.loads(backup_path.read_text(encoding="utf-8"))
            merged_courses = merge_missing_courses_from_backup(graph, backup)

    weekly = load_weekly_schedule(Path(args.canvas_data))
    stats = enrich_graph_retrieval(
        graph,
        weekly_schedule=weekly,
        course_filter=args.course,
        file_filter=args.file,
        max_files=max(0, int(args.max_files)),
    )
    stats["mergedCoursesFromBackup"] = merged_courses
    stats["finishedAt"] = datetime.now(timezone.utc).isoformat()
    stats["dryRun"] = args.dry_run

    if not args.dry_run:
        graph_path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
