#!/usr/bin/env python3
"""Persist textChunks + teaching/graph edges onto file nodes in canvas_graph.json."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.file_retrieval_index import enrich_graph_retrieval, load_weekly_schedule  # noqa: E402

DEFAULT_GRAPH = ROOT / "canvas_graph.json"
DEFAULT_CANVAS_DATA = ROOT / "canvas_data.json"
DEFAULT_REPORT = ROOT / ".cache" / "text_chunking" / "index_report.json"


def index_graph_file_chunks(graph_path=DEFAULT_GRAPH, dry_run=False, file_filter="", max_files=0, canvas_data_path=DEFAULT_CANVAS_DATA):
    graph = json.loads(Path(graph_path).read_text(encoding="utf-8"))
    weekly_schedule = load_weekly_schedule(canvas_data_path)
    stats = enrich_graph_retrieval(
        graph,
        weekly_schedule=weekly_schedule,
        file_filter=file_filter,
        max_files=max_files,
    )
    stats["chunksWritten"] = stats.get("chunksWritten", 0)

    if not dry_run and stats.get("filesIndexed"):
        Path(graph_path).write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")

    stats["finishedAt"] = datetime.now(timezone.utc).isoformat()
    stats["dryRun"] = dry_run
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", default=str(DEFAULT_GRAPH))
    parser.add_argument("--file", default="")
    parser.add_argument("--max-files", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--canvas-data", default=str(DEFAULT_CANVAS_DATA))
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    args = parser.parse_args()

    stats = index_graph_file_chunks(
        graph_path=Path(args.graph),
        dry_run=args.dry_run,
        file_filter=args.file,
        max_files=max(0, int(args.max_files)),
        canvas_data_path=Path(args.canvas_data),
    )
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
