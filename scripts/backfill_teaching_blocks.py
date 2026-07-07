#!/usr/bin/env python3
"""Backfill teaching blocks into canvas_graph.json from canvasfiles/ PDFs."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.teaching_blocks import (  # noqa: E402
    extract_teaching_units_from_pages,
    infer_parent_concept_name,
    teaching_labels_match,
)
from parser import (  # noqa: E402
    build_pdf_pages,
    folder,
    normalize_file_pages,
)

DEFAULT_GRAPH = ROOT / "canvas_graph.json"


def graph_file_nodes(graph):
    for course_id, course_files in (graph.get("files") or {}).items():
        if not isinstance(course_files, dict):
            continue
        for file_id, file_node in course_files.items():
            if isinstance(file_node, dict):
                yield str(course_id), str(file_id), file_node


def load_pages(file_id, file_node):
    pages = file_node.get("pages") or []
    if pages:
        return normalize_file_pages(pages, file_id)
    pdf_path = folder / str(file_id)
    if not pdf_path.exists():
        return []
    return normalize_file_pages(build_pdf_pages(str(pdf_path), file_id), file_id)


def collect_existing_names(graph, file_id):
    names = {"section": [], "concept": [], "example": [], "problem": [], "detail": []}
    file_id = str(file_id)
    for concept in graph.get("concepts") or []:
        if not isinstance(concept, dict):
            continue
        if concept.get("name"):
            names["concept"].append(concept["name"])
        for detail in concept.get("details") or []:
            if isinstance(detail, dict) and detail.get("name"):
                names["section"].append(detail["name"])
                names["detail"].append(detail["name"])
        for example in concept.get("examples") or []:
            if isinstance(example, dict) and example.get("name"):
                names["example"].append(example["name"])
    for problem in graph.get("problems") or []:
        if isinstance(problem, dict) and problem.get("name"):
            names["problem"].append(problem["name"])
    for store_key, bucket in (
        ("logged_details", "section"),
        ("logged_examples", "example"),
        ("logged_problems", "problem"),
    ):
        for _course_id, items in (graph.get(store_key) or {}).items():
            for item in items or []:
                if str(item.get("sourceFileId") or "") != file_id:
                    continue
                if store_key == "logged_details" and item.get("detailname"):
                    names["section"].append(item["detailname"])
                    names["detail"].append(item["detailname"])
                    if item.get("conceptname"):
                        names["concept"].append(item["conceptname"])
                if store_key == "logged_examples" and item.get("examplename"):
                    names["example"].append(item["examplename"])
                if store_key == "logged_problems" and item.get("problemname"):
                    names["problem"].append(item["problemname"])
    return names


def unit_extracted(unit, names):
    buckets = {
        "section": ("section", "concept", "detail"),
        "concept": ("concept", "section", "detail"),
        "example": ("example",),
        "problem": ("problem",),
    }.get(unit["type"], ())
    for bucket in buckets:
        for name in names.get(bucket, []):
            if teaching_labels_match(unit["name"], name):
                return True
    return False


def ensure_concept(graph, course_id, name, description=""):
    for concept in graph.setdefault("concepts", []):
        if str(concept.get("courseid")) == str(course_id) and teaching_labels_match(name, concept.get("name", "")):
            if description and not concept.get("description"):
                concept["description"] = description
            return concept
    concept = {
        "courseid": str(course_id),
        "name": name,
        "conceptid": f"concept-{course_id}-{len(graph['concepts']) + 1}",
        "description": description,
        "details": [],
        "examples": [],
        "problems": [],
        "prerequisiteConceptIds": [],
        "moduleOrderHints": [],
    }
    graph["concepts"].append(concept)
    return concept


def backfill_teaching_blocks(graph_path=DEFAULT_GRAPH, dry_run=False, file_filter=""):
    graph = json.loads(Path(graph_path).read_text(encoding="utf-8"))
    stats = {"filesSeen": 0, "filesUpdated": 0, "unitsSeeded": 0, "updatedFiles": []}

    for course_id, file_id, file_node in graph_file_nodes(graph):
        if file_filter and file_id != str(file_filter):
            continue
        stats["filesSeen"] += 1
        pages = load_pages(file_id, file_node)
        units = extract_teaching_units_from_pages(pages)
        if not units:
            continue
        names = collect_existing_names(graph, file_id)
        seeded = 0
        for index, unit in enumerate(units):
            if unit_extracted(unit, names):
                continue
            name = unit["name"]
            snippet = unit.get("snippet") or name
            if unit["type"] in {"section", "concept"}:
                concept = ensure_concept(graph, course_id, name, snippet)
                concept.setdefault("details", []).append({"name": name, "description": snippet})
                graph.setdefault("logged_details", {}).setdefault(course_id, []).append({
                    "conceptname": concept["name"],
                    "detailname": name,
                    "description": snippet,
                    "sourceFileId": file_id,
                })
                names["concept"].append(name)
                names["section"].append(name)
            elif unit["type"] == "example":
                parent = infer_parent_concept_name(units, index)
                concept = ensure_concept(graph, course_id, parent, "")
                concept.setdefault("examples", []).append({"name": name, "description": snippet})
                graph.setdefault("logged_examples", {}).setdefault(course_id, []).append({
                    "conceptname": concept["name"],
                    "examplename": name,
                    "description": snippet,
                    "sourceFileId": file_id,
                })
                names["example"].append(name)
            elif unit["type"] == "problem":
                parent = infer_parent_concept_name(units, index)
                concept = ensure_concept(graph, course_id, parent, "")
                graph.setdefault("logged_problems", {}).setdefault(course_id, []).append({
                    "problemname": name,
                    "incomingConceptNames": [concept["name"]],
                    "outgoingConceptNames": [concept["name"]],
                    "steps": [snippet],
                    "answer": "See file for answer.",
                    "sourceFileId": file_id,
                })
                graph.setdefault("problems", []).append({
                    "courseid": course_id,
                    "name": name,
                    "problemid": f"{name}-id",
                    "incomingConceptNodeIds": [concept["conceptid"]],
                    "outgoingConceptNodeIds": [concept["conceptid"]],
                    "steps": [snippet],
                    "answer": "See file for answer.",
                    "assignmentNodeIds": [],
                })
                names["problem"].append(name)
            else:
                continue
            seeded += 1

        if seeded:
            stats["filesUpdated"] += 1
            stats["unitsSeeded"] += seeded
            stats["updatedFiles"].append({
                "courseId": course_id,
                "fileId": file_id,
                "name": file_node.get("name", ""),
                "seeded": seeded,
            })

    if not dry_run and stats["unitsSeeded"]:
        Path(graph_path).write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")

    stats["finishedAt"] = datetime.now(timezone.utc).isoformat()
    stats["dryRun"] = dry_run
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", default=str(DEFAULT_GRAPH))
    parser.add_argument("--file", default="")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    stats = backfill_teaching_blocks(
        graph_path=Path(args.graph),
        dry_run=args.dry_run,
        file_filter=args.file,
    )
    print(json.dumps(stats, indent=2))
    if stats["unitsSeeded"] == 0:
        print("No teaching blocks backfilled.")


if __name__ == "__main__":
    main()
