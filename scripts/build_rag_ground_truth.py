"""Build RAG_ground_truth.json by running vector retrieval for representative queries."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vector_retreival import retreive, serialize_startpoint  # noqa: E402

TOP_K = 5

SEARCH_QUERIES = [
    "CHM 201 syllabus",
    "MAT 201 pset solutions",
    "ECO 101 lecture slides",
    "CHI 108 audio material",
    "MAT 202 linear algebra pset",
    "general chemistry practice exams",
    "linear algebra midterm review",
    "economics precept notes",
    "chinese pinyin pronunciation",
    "COS 126 programming assignment loops",
]

AGENT_QUERIES = [
    "When is the CHM 201 exam?",
    "What concepts are covered on the MAT 201 midterm?",
    "Help me find the ECO 101 assignment due this week",
    "What is the grading policy for CHM 201?",
    "Where can I find CHI 108 course slides for week 3?",
    "What readings do I need before the midterm in my urban studies course?",
    "Show me practice problems for general chemistry",
    "What are the office hours for MAT 201?",
    "Find ECO 101 readings on tariffs and trade policy",
    "What is the final exam schedule for my economics course?",
]


def run_query(query: str, mode: str) -> list[dict]:
    # Ground-truth capture uses the full ranked pool (no semantic cutoff) so every
    # query records exactly top_k nodes from the current retrieval scorer.
    import vector_retreival as vr

    original_retrieval_cutoff = vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF
    original_browser_cutoff = vr.BROWSER_INTERNAL_SCORE_CUTOFF
    vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF = 0.0
    vr.BROWSER_INTERNAL_SCORE_CUTOFF = 0.0
    try:
        results = retreive(query, k=max(TOP_K, 20), mode=mode)
    finally:
        vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF = original_retrieval_cutoff
        vr.BROWSER_INTERNAL_SCORE_CUTOFF = original_browser_cutoff
    serialized = [serialize_startpoint(item) for item in results[:TOP_K]]
    return serialized


def main() -> None:
    output: dict = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "top_k": TOP_K,
        "notes": (
            "Ground truth built from canvas_graph.json via vector_retreival.py. "
            "Search queries use browser mode (files/assignments only); agent queries use "
            "agent mode (full graph expansion). Rankings use the production scorer with "
            "semantic cutoff disabled so each query records exactly top_k nodes."
        ),
        "retrieval_modes": {
            "search": "browser",
            "agent": "agent",
        },
        "search_queries": [],
        "agent_queries": [],
    }

    for query in SEARCH_QUERIES:
        print(f"search: {query}", flush=True)
        output["search_queries"].append({
            "query": query,
            "mode": "browser",
            "results": run_query(query, "browser"),
        })

    for query in AGENT_QUERIES:
        print(f"agent: {query}", flush=True)
        output["agent_queries"].append({
            "query": query,
            "mode": "agent",
            "results": run_query(query, "agent"),
        })

    out_path = ROOT / "RAG_ground_truth.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}", flush=True)


if __name__ == "__main__":
    main()
