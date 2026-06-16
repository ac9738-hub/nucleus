"""Evaluate RAG retrieval against RAG_ground_truth.json and intent-quality heuristics."""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vector_retreival import (  # noqa: E402
    classify_query_intent,
    retreive,
    serialize_startpoint,
)

GT_PATH = ROOT / "RAG_ground_truth.json"
GRAPH_PATH = ROOT / "canvas_graph.json"

INTENT_EXPECTED_TYPES = {
    "deadline": {"event", "assignment", "syllabus"},
    "exam": {"event", "syllabus", "file"},
    "assignment": {"assignment", "file"},
    "practice": {"problem", "example", "file", "concept"},
    "concept": {"concept", "detail", "example", "file"},
    "syllabus": {"syllabus", "file", "event"},
    "general": {"assignment", "file", "concept", "event", "syllabus"},
}


def audit_embedding_coverage(path: Path = GRAPH_PATH) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))

    def has_embedding(node: dict) -> bool:
        embedded = node.get("embedded") if isinstance(node, dict) else {}
        if not isinstance(embedded, dict):
            return False
        for key in ("name", "description"):
            value = embedded.get(key)
            if isinstance(value, list) and value:
                return True
        return False

    files = [
        file_node
        for course_files in (data.get("files") or {}).values()
        if isinstance(course_files, dict)
        for file_node in course_files.values()
    ]
    assignments = [
        assignment
        for syllabus in (data.get("syllabi") or {}).values()
        for assignment in (syllabus.get("assignments") or [])
    ]
    groups = {
        "concept": data.get("concepts") or [],
        "problem": data.get("problems") or [],
        "event": data.get("events") or [],
        "syllabus": list((data.get("syllabi") or {}).values()),
        "assignment": assignments,
        "file": files,
    }
    report = {}
    for label, nodes in groups.items():
        total = len(nodes)
        embedded = sum(1 for node in nodes if has_embedding(node))
        report[label] = {"total": total, "embedded": embedded, "pct": embedded / total if total else 1.0}
    return report


def print_embedding_audit() -> None:
    report = audit_embedding_coverage()
    if not report:
        print("No canvas_graph.json found for embedding audit.")
        return
    print("Embedding coverage (canvas_graph.json):")
    for label, stats in report.items():
        pct = 100 * stats["pct"]
        print(f"  {label:12s} {stats['embedded']:4d}/{stats['total']:<4d} ({pct:5.1f}%)")


def load_ground_truth(path: Path = GT_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def result_id(item: dict) -> str:
    return f"{item.get('type')}:{item.get('id') or item.get('name')}"


def run_retrieval(query: str, mode: str, k: int, production_cutoff: bool) -> list[dict]:
    import vector_retreival as vr

    original_retrieval_cutoff = vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF
    original_browser_cutoff = vr.BROWSER_INTERNAL_SCORE_CUTOFF
    if not production_cutoff:
        vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF = 0.0
        vr.BROWSER_INTERNAL_SCORE_CUTOFF = 0.0
    try:
        results = retreive(query, k=k, mode=mode)
    finally:
        vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF = original_retrieval_cutoff
        vr.BROWSER_INTERNAL_SCORE_CUTOFF = original_browser_cutoff
    return [serialize_startpoint(item) for item in results[:k]]


def recall_at_k(expected_ids: set[str], actual: list[dict], k: int) -> float:
    if not expected_ids:
        return 1.0
    actual_ids = {result_id(item) for item in actual[:k]}
    return len(expected_ids & actual_ids) / len(expected_ids)


def ndcg_at_k(expected_ids: set[str], actual: list[dict], k: int) -> float:
    if not expected_ids:
        return 1.0
    dcg = 0.0
    for index, item in enumerate(actual[:k], start=1):
        if result_id(item) in expected_ids:
            dcg += 1.0 / math.log2(index + 1)
    ideal_hits = min(len(expected_ids), k)
    if ideal_hits == 0:
        return 0.0
    idcg = sum(1.0 / math.log2(index + 2) for index in range(ideal_hits))
    return dcg / idcg if idcg else 0.0


def intent_match_at_k(query: str, actual: list[dict], k: int) -> float:
    intent = classify_query_intent(query)
    expected_types = INTENT_EXPECTED_TYPES.get(intent, INTENT_EXPECTED_TYPES["general"])
    top_types = {item.get("type") for item in actual[:k]}
    return 1.0 if top_types & expected_types else 0.0


def type_distribution(results: list[dict]) -> Counter:
    return Counter(item.get("type") or "unknown" for item in results)


def evaluate_query(entry: dict, k: int, production_cutoff: bool) -> dict:
    query = entry["query"]
    mode = entry.get("mode", "browser")
    gt_results = entry.get("results") or []
    expected_ids = {result_id(item) for item in gt_results[:k]}
    actual = run_retrieval(query, mode, k, production_cutoff)
    intent = classify_query_intent(query)
    return {
        "query": query,
        "mode": mode,
        "intent": intent,
        "recall_at_k": recall_at_k(expected_ids, actual, k),
        "ndcg_at_k": ndcg_at_k(expected_ids, actual, k),
        "intent_match_at_k": intent_match_at_k(query, actual, k),
        "empty": len(actual) == 0,
        "gt_types": dict(type_distribution(gt_results)),
        "live_types": dict(type_distribution(actual)),
        "live_top": [
            {"type": item.get("type"), "name": item.get("name"), "id": item.get("id")}
            for item in actual[:k]
        ],
    }


def aggregate(rows: list[dict]) -> dict:
    count = len(rows) or 1
    by_intent: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_intent[row["intent"]].append(row)
    return {
        "queries": len(rows),
        "recall_at_k": sum(row["recall_at_k"] for row in rows) / count,
        "ndcg_at_k": sum(row["ndcg_at_k"] for row in rows) / count,
        "intent_match_at_k": sum(row["intent_match_at_k"] for row in rows) / count,
        "empty_rate": sum(1 for row in rows if row["empty"]) / count,
        "by_intent": {
            intent: {
                "count": len(intent_rows),
                "intent_match_at_k": sum(r["intent_match_at_k"] for r in intent_rows) / len(intent_rows),
                "empty_rate": sum(1 for r in intent_rows if r["empty"]) / len(intent_rows),
            }
            for intent, intent_rows in sorted(by_intent.items())
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate vector retrieval against RAG ground truth.")
    parser.add_argument("--k", type=int, default=5, help="Top-k to compare (default: 5)")
    parser.add_argument(
        "--production-cutoff",
        action="store_true",
        help="Use production semantic cutoff (default: compare against GT full-rank snapshot with cutoff off)",
    )
    parser.add_argument("--json", action="store_true", help="Print full JSON report")
    parser.add_argument(
        "--audit-embeddings",
        action="store_true",
        help="Print embedding coverage from canvas_graph.json and exit",
    )
    args = parser.parse_args()

    if args.audit_embeddings:
        print_embedding_audit()
        return

    gt = load_ground_truth()
    rows = []
    for section in ("search_queries", "agent_queries"):
        for entry in gt.get(section, []) or []:
            rows.append(evaluate_query(entry, args.k, args.production_cutoff))

    summary = aggregate(rows)
    if args.json:
        print(json.dumps({"summary": summary, "queries": rows}, ensure_ascii=False, indent=2))
        return

    print(f"RAG eval (k={args.k}, production_cutoff={args.production_cutoff})")
    print(f"  recall@{args.k}:        {summary['recall_at_k']:.3f}")
    print(f"  nDCG@{args.k}:          {summary['ndcg_at_k']:.3f}")
    print(f"  intent_match@{args.k}:  {summary['intent_match_at_k']:.3f}")
    print(f"  empty_rate:             {summary['empty_rate']:.3f}")
    print("\nBy intent:")
    for intent, stats in summary["by_intent"].items():
        print(
            f"  {intent:12s} n={stats['count']} "
            f"intent_match={stats['intent_match_at_k']:.2f} empty={stats['empty_rate']:.2f}"
        )
    print("\nPer query:")
    for row in rows:
        status = "EMPTY" if row["empty"] else "ok"
        print(
            f"  [{status}] {row['mode']:7s} intent={row['intent']:9s} "
            f"recall={row['recall_at_k']:.2f} intent_match={row['intent_match_at_k']:.0f} "
            f"{row['query']!r}"
        )
        if row["live_types"] != row["gt_types"]:
            print(f"           types live={row['live_types']} gt={row['gt_types']}")


if __name__ == "__main__":
    main()
