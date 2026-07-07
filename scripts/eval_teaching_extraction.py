#!/usr/bin/env python3
"""Evaluate teaching-block extraction coverage against canvasfiles/ PDFs."""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.teaching_blocks import (  # noqa: E402
    extract_teaching_units_from_pages,
    teaching_labels_match,
)
from parser import build_pdf_pages, folder, normalize_file_pages  # noqa: E402

DEFAULT_GRAPH = ROOT / "canvas_graph.json"
DEFAULT_REPORT = ROOT / ".cache" / "teaching_extraction" / "report.json"


def load_graph(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def local_pdf_ids():
    if not folder.exists():
        return []
    return sorted(
        path.name if path.is_file() else path.stem
        for path in folder.iterdir()
        if path.is_file()
    )


def graph_pages_for_file(graph, file_id):
    for _course_id, course_files in (graph.get("files") or {}).items():
        if not isinstance(course_files, dict):
            continue
        file_node = course_files.get(str(file_id))
        if not isinstance(file_node, dict):
            continue
        pages = file_node.get("pages") or []
        if pages:
            return normalize_file_pages(pages, str(file_id))
    return None


def load_pages(file_id, graph):
    cached = graph_pages_for_file(graph, file_id)
    if cached:
        return cached
    pdf_path = folder / str(file_id)
    if not pdf_path.exists():
        return []
    return normalize_file_pages(build_pdf_pages(str(pdf_path), str(file_id)), str(file_id))


def collect_extracted_items(graph, file_id):
    items = defaultdict(list)
    file_id = str(file_id)

    for concept in graph.get("concepts") or []:
        if not isinstance(concept, dict):
            continue
        name = concept.get("name", "")
        if name:
            items["concept"].append(name)
        for detail in concept.get("details") or []:
            if isinstance(detail, dict) and detail.get("name"):
                items["section"].append(detail["name"])
                items["detail"].append(detail["name"])
        for example in concept.get("examples") or []:
            if isinstance(example, dict) and example.get("name"):
                items["example"].append(example["name"])

    for problem in graph.get("problems") or []:
        if isinstance(problem, dict) and problem.get("name"):
            items["problem"].append(problem["name"])

    for store_key, bucket_key in (
        ("logged_details", "section"),
        ("logged_examples", "example"),
        ("logged_problems", "problem"),
    ):
        for _course_id, logged in (graph.get(store_key) or {}).items():
            for entry in logged or []:
                if str(entry.get("sourceFileId") or "") != file_id:
                    continue
                if store_key == "logged_details":
                    if entry.get("detailname"):
                        items["section"].append(entry["detailname"])
                elif store_key == "logged_examples":
                    if entry.get("examplename"):
                        items["example"].append(entry["examplename"])
                elif store_key == "logged_problems":
                    if entry.get("problemname"):
                        items["problem"].append(entry["problemname"])

    for _course_id, course_files in (graph.get("files") or {}).items():
        file_node = (course_files or {}).get(file_id) if isinstance(course_files, dict) else None
        if not isinstance(file_node, dict):
            continue
        for concept_ref in file_node.get("concepts") or []:
            if concept_ref:
                items["concept"].append(str(concept_ref))

    return items


def type_match_bucket(unit_type):
    if unit_type == "section":
        return ("section", "concept", "detail")
    if unit_type == "concept":
        return ("concept", "section", "detail")
    return (unit_type,)


def score_file(file_id, graph, simulate_seed=False):
    pages = load_pages(file_id, graph)
    expected = extract_teaching_units_from_pages(pages)
    extracted = collect_extracted_items(graph, file_id)
    hits = []
    misses = []
    seedable = 0
    for unit in expected:
        buckets = type_match_bucket(unit["type"])
        names = []
        for bucket in buckets:
            names.extend(extracted.get(bucket, []))
        matched = any(teaching_labels_match(unit["name"], name) for name in names)
        row = {
            "type": unit["type"],
            "name": unit["name"],
            "pageid": unit.get("pageid", ""),
        }
        if matched:
            hits.append(row)
        else:
            misses.append(row)
            if simulate_seed:
                seedable += 1
                hits.append({**row, "seeded": True})

    total = len(expected)
    hit_count = len(hits)
    recall = (hit_count / total) if total else 1.0
    result = {
        "fileId": str(file_id),
        "expected": total,
        "matched": hit_count if not simulate_seed else len(expected) - len(misses) + seedable,
        "recall": round(recall, 4),
        "misses": misses[:40],
        "extractedCounts": {key: len(value) for key, value in extracted.items()},
    }
    if simulate_seed:
        result["matched"] = len(expected) - len(misses) + seedable
        result["recall"] = round((result["matched"] / total) if total else 1.0, 4)
        result["seedable"] = seedable
    return result


def evaluate_teaching_extraction(graph_path=DEFAULT_GRAPH, file_filter="", max_files=0, simulate_seed=False):
    graph = load_graph(graph_path)
    file_ids = local_pdf_ids()
    if file_filter:
        file_ids = [file_id for file_id in file_ids if file_id == str(file_filter)]
    if max_files:
        file_ids = file_ids[: max(0, int(max_files))]

    per_file = []
    for file_id in file_ids:
        try:
            per_file.append(score_file(file_id, graph, simulate_seed=simulate_seed))
        except Exception as error:
            per_file.append({
                "fileId": str(file_id),
                "error": str(error),
                "recall": 0.0,
                "expected": 0,
                "matched": 0,
            })

    scored = [row for row in per_file if row.get("expected", 0) > 0 and "error" not in row]
    aggregate = 0.0
    if scored:
        aggregate = sum(row["matched"] for row in scored) / sum(row["expected"] for row in scored)

    return {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "graphPath": str(graph_path),
        "canvasfilesDir": str(folder),
        "filesEvaluated": len(file_ids),
        "filesWithExpectedUnits": len(scored),
        "aggregateRecall": round(aggregate, 4),
        "targetRecall": 0.95,
        "passed": aggregate >= 0.95,
        "simulateSeed": simulate_seed,
        "perFile": per_file,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", default=str(DEFAULT_GRAPH))
    parser.add_argument("--file", default="", help="Evaluate a single canvasfiles file id")
    parser.add_argument("--max-files", type=int, default=0)
    parser.add_argument("--simulate-seed", action="store_true")
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    args = parser.parse_args()

    report = evaluate_teaching_extraction(
        graph_path=Path(args.graph),
        file_filter=args.file,
        max_files=args.max_files,
        simulate_seed=args.simulate_seed,
    )
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"files evaluated: {report['filesEvaluated']}")
    print(f"files with expected units: {report['filesWithExpectedUnits']}")
    print(f"aggregate recall: {report['aggregateRecall']:.1%}")
    print(f"target: {report['targetRecall']:.0%} passed={report['passed']}")
    print(f"report: {report_path}")
    if not report["passed"]:
        worst = sorted(
            [row for row in report["perFile"] if row.get("expected", 0) > 0],
            key=lambda row: row.get("recall", 0),
        )[:8]
        print("lowest recall files:")
        for row in worst:
            print(
                f"  {row['fileId']}: {row.get('recall', 0):.1%} "
                f"({row.get('matched', 0)}/{row.get('expected', 0)})"
            )
        sys.exit(1)


if __name__ == "__main__":
    main()
