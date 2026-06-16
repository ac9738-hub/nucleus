"""Batch-embed all nodes in canvas_graph.json (RAG iteration 2).

Loads parser in-memory state from disk, embeds missing concepts/problems/events/
files/syllabi/assignments, then writes canvas_graph.json atomically.

Requires OPENAI_API_KEY (text-embedding-3-small, same as parser.py).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.eval_rag import audit_embedding_coverage, print_embedding_audit  # noqa: E402


def _import_parser():
    import parser as graph_parser  # noqa: WPS433 — local module name

    return graph_parser


def collect_assignment_tasks(graph_parser, *, force: bool) -> list[tuple]:
    tasks = []
    for courseid, syllabus in graph_parser.syllabusNodes.items():
        for assignment in syllabus.assignments:
            description = graph_parser.html_to_text(assignment.description or '')
            tasks.append((
                assignment,
                graph_parser.embed_named_description,
                graph_parser.course_scoped_embedding_name(courseid, assignment.name),
                description,
                force,
            ))
    return tasks


def reembed_graph(*, force: bool = False, dry_run: bool = False) -> int:
    graph_parser = _import_parser()
    if graph_parser.openai_client is None:
        print("OPENAI_API_KEY is not set; cannot embed.", file=sys.stderr)
        return 1

    print("Embedding coverage before:")
    print_embedding_audit()

    if dry_run:
        report = audit_embedding_coverage()
        missing = sum(stats["total"] - stats["embedded"] for stats in report.values())
        total = sum(stats["total"] for stats in report.values())
        print(f"\nDry run: would embed up to {missing} of {total} nodes (--force re-embeds all).")
        return 0

    started = time.perf_counter()
    graph_parser.load_embedding_cache_from_disk()
    graph_parser.load_state_from_disk()

    if force:
        print("Force mode: clearing existing embeddings on all graph nodes.", flush=True)
        for course_nodes in graph_parser.conceptNodes.values():
            for concept in course_nodes:
                concept.embedded = {}
                for detail in concept.details:
                    detail.embedded = {}
                for example in concept.examples:
                    example.embedded = {}
        for course_problems in graph_parser.problems.values():
            for problem in course_problems:
                problem.embedded = {}
        for syllabus in graph_parser.syllabusNodes.values():
            syllabus.embedded = {}
            for assignment in syllabus.assignments:
                assignment.embedded = {}
        for course_files in graph_parser.fileNodes.values():
            for file_node in course_files.values():
                file_node.embedded = {}
        for course_events in graph_parser.eventNodes.values():
            for event in course_events:
                event.embedded = {}

    print("Embedding concepts, problems, syllabi, files, events...", flush=True)
    graph_parser.update_file_embedded_fields()

    assignment_tasks = collect_assignment_tasks(graph_parser, force=force)
    print(f"Embedding assignments ({len(assignment_tasks)} total)...", flush=True)
    graph_parser.safe_embed_nodes(assignment_tasks)

    graph_parser.flush_write_state(force=True)
    graph_parser.write_embedding_cache_to_disk()

    elapsed = time.perf_counter() - started
    print(f"\nRe-embed complete in {elapsed / 60:.1f} min.")
    print("\nEmbedding coverage after:")
    print_embedding_audit()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch-embed canvas_graph.json nodes.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-embed every node even if embeddings already exist.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print coverage only; do not call OpenAI.",
    )
    args = parser.parse_args()
    return reembed_graph(force=args.force, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
