#!/usr/bin/env python3
"""Evaluate text chunking, chunk-graph edges, and grounding coverage."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.chunk_graph import (  # noqa: E402
    build_file_chunk_graph,
    chunks_from_file_node,
    select_chunks_for_query,
    summarize_chunk_graph,
)
from canvas_parser.content.teaching_blocks import extract_teaching_units_from_pages  # noqa: E402
from canvas_parser.content.text_chunks import (  # noqa: E402
    assign_cite_labels,
    chunk_from_page_blocks,
    chunk_ids_unique,
    format_chunks_for_grounding,
    format_retrieval_chunks_for_grounding,
    parse_cite_labels,
    parse_retrieval_cite_labels,
    resolve_citations,
    summarize_chunks,
)

DEFAULT_GRAPH = ROOT / "canvas_graph.json"
DEFAULT_FIXTURE = ROOT / "tests" / "fixtures" / "sample-graph.json"
DEFAULT_REPORT = ROOT / ".cache" / "text_chunking" / "report.json"


def load_graph(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def evaluate_file_chunks(file_node, course_id, file_id, max_files_chunks=24):
    pages = file_node.get("pages") if isinstance(file_node.get("pages"), list) else []
    chunks = chunk_from_page_blocks(
        pages,
        courseid=str(course_id),
        fileid=str(file_id),
        max_chunks=max_files_chunks,
    )
    summary = summarize_chunks(chunks)
    return {
        "fileId": str(file_id),
        "name": str(file_node.get("name") or ""),
        **summary,
        "sampleChunkId": chunks[0].get("chunkId") if chunks else "",
    }


def evaluate_graph_chunks(graph, max_files=12, max_chunks_per_file=24):
    per_file = []
    for course_id, course_files in (graph.get("files") or {}).items():
        if not isinstance(course_files, dict):
            continue
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            pages = file_node.get("pages") if isinstance(file_node.get("pages"), list) else []
            has_blocks = any(
                isinstance(page, dict)
                and isinstance(page.get("blocks"), list)
                and any(isinstance(block, dict) and block.get("text") for block in page.get("blocks"))
                for page in pages
            )
            if not has_blocks:
                continue
            per_file.append(evaluate_file_chunks(file_node, course_id, file_id, max_chunks_per_file))
            if len(per_file) >= max_files:
                break
        if len(per_file) >= max_files:
            break

    total_chunks = sum(row.get("count", 0) for row in per_file)
    unique_ok = all(row.get("uniqueIds") for row in per_file)
    return {
        "filesWithChunks": len(per_file),
        "totalChunks": total_chunks,
        "allChunkIdsUnique": unique_ok,
        "perFile": per_file,
    }


def evaluate_chunk_graph_alignment(graph, max_files=12):
    per_file = []
    for course_id, course_files in (graph.get("files") or {}).items():
        if not isinstance(course_files, dict):
            continue
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            pages = file_node.get("pages") if isinstance(file_node.get("pages"), list) else []
            if not pages:
                continue
            units = extract_teaching_units_from_pages(pages)
            if not units:
                continue
            chunks = build_file_chunk_graph(
                pages,
                courseid=str(course_id),
                fileid=str(file_id),
                graph=graph,
            )
            linked_units = sum(
                1 for chunk in chunks
                if any(
                    isinstance(edge, dict) and edge.get("type") == "teaching-unit"
                    for edge in (chunk.get("edges") or [])
                )
            )
            per_file.append({
                "fileId": str(file_id),
                "expectedUnits": len(units),
                "chunks": len(chunks),
                "linkedUnits": linked_units,
                "unitLinkRate": round(linked_units / len(units), 4) if units else 0.0,
                **summarize_chunk_graph(chunks),
            })
            if len(per_file) >= max_files:
                break
        if len(per_file) >= max_files:
            break

    scored = [row for row in per_file if row.get("expectedUnits", 0) > 0]
    aggregate = 0.0
    if scored:
        aggregate = sum(row["linkedUnits"] for row in scored) / sum(row["expectedUnits"] for row in scored)
    return {
        "filesScored": len(scored),
        "aggregateUnitLinkRate": round(aggregate, 4),
        "perFile": per_file,
    }


def evaluate_retrieval_grounding(graph):
    for course_files in (graph.get("files") or {}).values():
        if not isinstance(course_files, dict):
            continue
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            chunks = chunks_from_file_node(
                file_node,
                courseid=str(file_node.get("courseid") or ""),
                fileid=str(file_id),
            )
            if not chunks:
                continue
            selected = select_chunks_for_query(chunks, query="grading policy overview", max_chunks=3)
            prompt = format_retrieval_chunks_for_grounding(selected)
            return {
                "fileId": str(file_id),
                "selected": len(selected),
                "promptChars": len(prompt),
                "hasRetrievalLabels": "[R1]" in prompt,
            }
    return {"selected": 0, "promptChars": 0, "hasRetrievalLabels": False}


def evaluate_weekly_edge_attachment(graph, weekly_schedule, max_files=12):
    per_file = []
    for course_id, course_files in (graph.get("files") or {}).items():
        if not isinstance(course_files, dict):
            continue
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            pages = file_node.get("pages") if isinstance(file_node.get("pages"), list) else []
            if not pages:
                continue
            chunks = build_file_chunk_graph(
                pages,
                courseid=str(course_id),
                fileid=str(file_id),
                filename=str(file_node.get("name") or ""),
                graph=graph,
                weekly_schedule=weekly_schedule,
            )
            summary = summarize_chunk_graph(chunks)
            if summary.get("withWeeklyItem", 0) > 0:
                per_file.append({
                    "fileId": str(file_id),
                    **summary,
                })
            if len(per_file) >= max_files:
                break
        if len(per_file) >= max_files:
            break
    return {
        "filesWithWeeklyEdges": len(per_file),
        "perFile": per_file,
    }


def evaluate_grounding_roundtrip():
    chunks = assign_cite_labels([
        {"chunkId": "screen:test/b0", "text": "Mitosis begins in prophase.", "source": {"type": "screen-block"}},
        {"chunkId": "screen:test/b1", "text": "Quiz 2 is due Friday.", "source": {"type": "screen-block"}},
    ])
    prompt = format_chunks_for_grounding(chunks)
    answer = "Mitosis starts in prophase [C1]. The quiz is due Friday [C2]."
    labels = parse_cite_labels(answer)
    resolved = resolve_citations(answer, chunks)
    return {
        "promptChars": len(prompt),
        "labelsParsed": labels,
        "resolvedCount": len(resolved),
        "roundtripOk": labels == ["C1", "C2"] and len(resolved) == 2,
    }


DEFAULT_FIXTURE_WEEKLY = ROOT / "tests" / "fixtures" / "sample-weekly.json"


def load_weekly_fixture(path=DEFAULT_FIXTURE_WEEKLY):
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data.get("weekly_schedule") if isinstance(data.get("weekly_schedule"), dict) else {}


def evaluate_text_chunking(
    graph_path=DEFAULT_GRAPH,
    *,
    use_fixture=False,
    max_files=12,
):
    graph_path = DEFAULT_FIXTURE if use_fixture else graph_path
    graph = load_graph(graph_path)
    graph_eval = evaluate_graph_chunks(graph, max_files=max_files)
    graph_align = evaluate_chunk_graph_alignment(graph, max_files=max_files)
    weekly_fixture = load_weekly_fixture() if use_fixture else {}
    weekly_eval = evaluate_weekly_edge_attachment(graph, weekly_fixture, max_files=max_files)
    retrieval = evaluate_retrieval_grounding(graph)
    grounding = evaluate_grounding_roundtrip()

    passed = (
        graph_eval["filesWithChunks"] > 0
        and graph_eval["allChunkIdsUnique"]
        and grounding["roundtripOk"]
        and retrieval.get("hasRetrievalLabels", False)
        and (not use_fixture or weekly_eval.get("filesWithWeeklyEdges", 0) > 0)
    )

    return {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "graphPath": str(graph_path),
        "graph": graph_eval,
        "chunkGraph": graph_align,
        "weeklyEdges": weekly_eval,
        "retrievalGrounding": retrieval,
        "grounding": grounding,
        "passed": passed,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", default=str(DEFAULT_GRAPH))
    parser.add_argument("--fixture", action="store_true")
    parser.add_argument("--max-files", type=int, default=12)
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    args = parser.parse_args()

    report = evaluate_text_chunking(
        graph_path=Path(args.graph),
        use_fixture=args.fixture,
        max_files=max(1, int(args.max_files)),
    )
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"files with chunks: {report['graph']['filesWithChunks']}")
    print(f"total chunks: {report['graph']['totalChunks']}")
    print(f"unique chunk ids: {report['graph']['allChunkIdsUnique']}")
    print(f"grounding roundtrip: {report['grounding']['roundtripOk']}")
    print(f"retrieval [R#] labels: {report['retrievalGrounding'].get('hasRetrievalLabels')}")
    if report.get("chunkGraph", {}).get("filesScored"):
        print(
            "unit link rate: "
            f"{report['chunkGraph']['aggregateUnitLinkRate']:.1%} "
            f"({report['chunkGraph']['filesScored']} files)"
        )
    if report.get("weeklyEdges"):
        print(f"weekly edge files: {report['weeklyEdges'].get('filesWithWeeklyEdges', 0)}")
    print(f"passed: {report['passed']}")
    print(f"report: {report_path}")
    if not report["passed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
