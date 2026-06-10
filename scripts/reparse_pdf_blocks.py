#!/usr/bin/env python3
"""Refresh block-level PDF text in canvas_graph.json from local canvasfiles/ PDFs.

This is a lightweight reparse: it does NOT re-run LLM extraction or re-download
from Canvas. It only re-runs PyMuPDF block extraction (build_pdf_pages) for files
whose PDFs already exist under canvasfiles/{fileid}.

Usage:
  python scripts/reparse_pdf_blocks.py
  python scripts/reparse_pdf_blocks.py --dry-run
  python scripts/reparse_pdf_blocks.py --course 17581 --file 3768618
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from parser import CANVAS_GRAPH_PATH, build_pdf_pages, normalize_file_pages  # noqa: E402

CANVASFILES_DIR = ROOT / "canvasfiles"
REPORT_PATH = ROOT / "scripts" / "reparse_pdf_blocks_report.json"


def list_local_pdf_ids():
    if not CANVASFILES_DIR.exists():
        return []
    return sorted(
        entry.name
        for entry in CANVASFILES_DIR.iterdir()
        if entry.is_file() and not entry.name.startswith(".")
    )


def page_key(page):
    return str(page.get("pageid") or page.get("pageNumber") or "")


def merge_fresh_blocks(existing_pages, fresh_pages):
    fresh_by_key = {page_key(page): page for page in fresh_pages}
    merged = []
    updated_pages = 0
    added_blocks = 0
    for page in existing_pages:
        if not isinstance(page, dict):
            continue
        fresh = fresh_by_key.get(page_key(page))
        if not fresh:
            merged.append(page)
            continue
        next_page = dict(page)
        fresh_blocks = fresh.get("blocks") if isinstance(fresh.get("blocks"), list) else []
        if fresh_blocks:
            prev_count = len(next_page.get("blocks") or [])
            next_page["blocks"] = fresh_blocks
            next_page["text"] = fresh.get("text") or next_page.get("text") or ""
            updated_pages += 1
            added_blocks += max(0, len(fresh_blocks) - prev_count)
        merged.append(next_page)
    return merged, updated_pages, added_blocks


def iter_target_files(graph, course_filter="", file_filter=""):
    files = graph.get("files") or {}
    for course_id, course_files in files.items():
        if course_filter and str(course_id) != str(course_filter):
            continue
        if not isinstance(course_files, dict):
            continue
        for file_id, file_node in course_files.items():
            if file_filter and str(file_id) != str(file_filter):
                continue
            if not isinstance(file_node, dict):
                continue
            pages = file_node.get("pages")
            if not isinstance(pages, list) or not pages:
                continue
            yield str(course_id), str(file_id), file_node


def reparse_pdf_blocks(dry_run=False, course_filter="", file_filter=""):
    local_pdf_ids = set(list_local_pdf_ids())
    if file_filter:
        local_pdf_ids = {file_filter} if file_filter in local_pdf_ids else set()
    if not local_pdf_ids:
        stats = {
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "dryRun": dry_run,
            "graphPath": str(CANVAS_GRAPH_PATH),
            "canvasfilesDir": str(CANVASFILES_DIR),
            "filesSeen": 0,
            "filesWithLocalPdf": 0,
            "filesUpdated": 0,
            "pagesUpdated": 0,
            "blocksAdded": 0,
            "missingLocalPdf": [],
            "updatedFiles": [],
            "errors": [],
            "note": "No local PDFs found in canvasfiles/. Run the Canvas parser to download files first.",
        }
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with REPORT_PATH.open("w", encoding="utf-8") as handle:
            json.dump(stats, handle, indent=2)
        print("PDF block reparse skipped")
        print(f"  reason: no local PDFs in {CANVASFILES_DIR}")
        print("  next:   open Nucleus and let the Canvas parser download files, then rerun")
        print(f"  report: {REPORT_PATH}")
        return stats

    if not CANVAS_GRAPH_PATH.exists():
        raise FileNotFoundError(f"Missing graph file: {CANVAS_GRAPH_PATH}")

    print(f"Loading {CANVAS_GRAPH_PATH.name} (this may take a minute)...", flush=True)
    with CANVAS_GRAPH_PATH.open("r", encoding="utf-8") as handle:
        graph = json.load(handle)

    stats = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "dryRun": dry_run,
        "graphPath": str(CANVAS_GRAPH_PATH),
        "canvasfilesDir": str(CANVASFILES_DIR),
        "filesSeen": 0,
        "filesWithLocalPdf": 0,
        "filesUpdated": 0,
        "pagesUpdated": 0,
        "blocksAdded": 0,
        "missingLocalPdf": [],
        "updatedFiles": [],
        "errors": [],
    }

    for course_id, file_id, file_node in iter_target_files(graph, course_filter, file_filter):
        stats["filesSeen"] += 1
        if file_id not in local_pdf_ids:
            if len(stats["missingLocalPdf"]) < 40:
                stats["missingLocalPdf"].append({
                    "courseId": course_id,
                    "fileId": file_id,
                    "name": file_node.get("name", ""),
                })
            continue
        pdf_path = CANVASFILES_DIR / file_id
        stats["filesWithLocalPdf"] += 1
        try:
            fresh_pages = build_pdf_pages(str(pdf_path), file_id)
            fresh_pages = normalize_file_pages(fresh_pages, file_id)
            merged_pages, pages_updated, blocks_added = merge_fresh_blocks(
                file_node.get("pages") or [],
                fresh_pages,
            )
        except Exception as error:
            stats["errors"].append({
                "courseId": course_id,
                "fileId": file_id,
                "name": file_node.get("name", ""),
                "error": str(error),
            })
            continue

        if pages_updated:
            stats["filesUpdated"] += 1
            stats["pagesUpdated"] += pages_updated
            stats["blocksAdded"] += blocks_added
            stats["updatedFiles"].append({
                "courseId": course_id,
                "fileId": file_id,
                "name": file_node.get("name", ""),
                "pagesUpdated": pages_updated,
                "blocksAdded": blocks_added,
            })
            if not dry_run:
                file_node["pages"] = merged_pages

    if not dry_run and stats["filesUpdated"]:
        backup_path = CANVAS_GRAPH_PATH.with_suffix(".json.bak")
        if not backup_path.exists():
            backup_path.write_bytes(CANVAS_GRAPH_PATH.read_bytes())
        with CANVAS_GRAPH_PATH.open("w", encoding="utf-8") as handle:
            json.dump(graph, handle, ensure_ascii=False)

    stats["finishedAt"] = datetime.now(timezone.utc).isoformat()
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(stats, handle, indent=2)

    print("PDF block reparse complete")
    print(f"  files seen:         {stats['filesSeen']}")
    print(f"  local PDFs found:   {stats['filesWithLocalPdf']}")
    print(f"  files updated:      {stats['filesUpdated']}")
    print(f"  pages updated:      {stats['pagesUpdated']}")
    print(f"  blocks added:       {stats['blocksAdded']}")
    print(f"  missing local PDFs: {len(stats['missingLocalPdf'])} (sampled up to 40)")
    print(f"  errors:             {len(stats['errors'])}")
    print(f"  report:             {REPORT_PATH}")
    if dry_run:
        print("  (dry run — canvas_graph.json was not modified)")
    return stats


def main():
    parser = argparse.ArgumentParser(description="Refresh PDF block text in canvas_graph.json")
    parser.add_argument("--dry-run", action="store_true", help="Compute updates without writing")
    parser.add_argument("--course", default="", help="Limit to one course id")
    parser.add_argument("--file", default="", help="Limit to one file id")
    args = parser.parse_args()
    stats = reparse_pdf_blocks(
        dry_run=args.dry_run,
        course_filter=args.course,
        file_filter=args.file,
    )
    if stats["errors"]:
        sys.exit(2)
    if stats["filesWithLocalPdf"] == 0:
        sys.exit(3)


if __name__ == "__main__":
    main()
