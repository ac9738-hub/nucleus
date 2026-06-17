"""Build RAG_ground_truth.json with human-judged expected answers + live retrieval snapshot."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vector_retreival import classify_query_intent, retreive, serialize_startpoint  # noqa: E402

TOP_K = 5

# Curated queries with expected relevant nodes (graph-verified 2026-06-16).
# `answer` is the human-readable target; `expected` drives recall@k in eval_rag.py.
QUERY_SPECS: list[dict] = [
    {
        "query": "CHM 201 syllabus",
        "mode": "browser",
        "intent": "syllabus",
        "answer": "CHM 201 General Chemistry I syllabus PDF or syllabus node for course 15160.",
        "expected": [
            {"type": "file", "name": "CHM201_F2024 General Chemistry I syllabus", "courseid": "15160", "id": "course-syllabus-15160"},
            {"type": "syllabus", "name": "", "courseid": "15160", "id": "15160"},
        ],
    },
    {
        "query": "MAT 201 pset solutions",
        "mode": "browser",
        "intent": "assignment",
        "answer": "MAT 201 problem set assignments (solutions may be in linked PDFs or PSET pages).",
        "expected": [
            {"type": "assignment", "name": "Problem Set 1", "courseid": "20812", "id": "6c86190908786cc0"},
            {"type": "file", "name": "MAT201_S2026 Multivariable Calculus homepage", "courseid": "20812", "id": "homepage-20812"},
        ],
    },
    {
        "query": "ECO 101 lecture slides",
        "mode": "browser",
        "intent": "material",
        "answer": "ECO 101 course homepage or lecture materials file (no dedicated slide PDFs in graph).",
        "expected": [
            {"type": "file", "name": "ECO101_S2026 Introduction to Macroeconomics homepage", "courseid": "20959", "id": "homepage-20959"},
        ],
    },
    {
        "query": "CHI 108 audio material",
        "mode": "browser",
        "intent": "material",
        "answer": "CHI 108 course homepage — audio linked from Canvas modules not yet in graph files.",
        "expected": [
            {"type": "file", "name": "CHI108_S2025 Intensive Intermediate Chinese homepage", "courseid": "17239", "id": "homepage-17239"},
        ],
    },
    {
        "query": "MAT 202 linear algebra pset",
        "mode": "browser",
        "intent": "assignment",
        "answer": "MAT 202 PSET assignments or solution PDFs.",
        "expected": [
            {"type": "assignment", "name": "PSET 1", "courseid": "19097", "id": "6a08065d33765feb"},
            {"type": "file", "name": "MAT202-PSET-1Solutions.pdf", "courseid": "19097", "id": "4017280"},
        ],
    },
    {
        "query": "CHM 201 practice exam",
        "mode": "browser",
        "intent": "exam",
        "answer": "CHM 201 exam assignments or practice exam files.",
        "expected": [
            {"type": "assignment", "name": "Exam 1", "courseid": "15160", "id": "0a33afeb9c31dbda"},
            {"type": "assignment", "name": "Final Exam", "courseid": "15160", "id": "c2df94d568ec2cc7"},
            {"type": "event", "name": "Exam", "courseid": "15160", "id": "Exameventid"},
        ],
    },
    {
        "query": "MAT 202 midterm review",
        "mode": "browser",
        "intent": "exam",
        "answer": "MAT 202 midterm review PDF or midterm review event.",
        "expected": [
            {"type": "file", "name": "MidtermReviewSessionQuestions-Fall2025.pdf", "courseid": "19097", "id": "4122913"},
            {"type": "event", "name": "Midterm Review", "courseid": "19097", "id": "Midterm Revieweventid"},
        ],
    },
    {
        "query": "ECO 101 precept notes",
        "mode": "browser",
        "intent": "material",
        "answer": "ECO 101 course homepage — precept notes live in Canvas modules not yet parsed as files.",
        "expected": [
            {"type": "file", "name": "ECO101_S2026 Introduction to Macroeconomics homepage", "courseid": "20959", "id": "homepage-20959"},
        ],
    },
    {
        "query": "CHI 108 pronunciation",
        "mode": "browser",
        "intent": "general",
        "answer": "CHI 108 course materials homepage (pinyin/pronunciation in module pages).",
        "expected": [
            {"type": "file", "name": "CHI108_S2025 Intensive Intermediate Chinese homepage", "courseid": "17239", "id": "homepage-17239"},
        ],
    },
    {
        "query": "COS 126 loops assignment",
        "mode": "browser",
        "intent": "assignment",
        "answer": "COS 126 Loops programming assignment.",
        "expected": [
            {"type": "assignment", "name": "Loops", "courseid": "18906", "id": "4ba9ca18d97bae2f"},
        ],
    },
    {
        "query": "When is the CHM 201 exam?",
        "mode": "agent",
        "intent": "deadline",
        "answer": "CHM 201 exam dates from Exam 1/2/Final assignments or Exam event nodes.",
        "expected": [
            {"type": "assignment", "name": "Exam 1", "courseid": "15160", "id": "0a33afeb9c31dbda"},
            {"type": "assignment", "name": "Exam 2", "courseid": "15160", "id": "fb10fc8c02996ea8"},
            {"type": "event", "name": "Exam", "courseid": "15160", "id": "Exameventid"},
        ],
    },
    {
        "query": "What topics are on the MAT 201 midterm?",
        "mode": "agent",
        "intent": "exam",
        "answer": "MAT 201 midterm exam assignment and any linked concepts or syllabus policy.",
        "expected": [
            {"type": "assignment", "name": "MIDTERM EXAM", "courseid": "20812", "id": "3d2b6bcb22506d23"},
            {"type": "event", "name": "MIDTERM EXAM", "courseid": "20812", "id": "MIDTERM EXAMeventid"},
            {"type": "syllabus", "name": "", "courseid": "20812", "id": "20812"},
        ],
    },
    {
        "query": "What ECO 101 homework is due soon?",
        "mode": "agent",
        "intent": "deadline",
        "answer": "ECO 101 homework assignments with due dates (Homework 1, etc.).",
        "expected": [
            {"type": "assignment", "name": "Homework 1", "courseid": "20959", "id": "fe4c3a1c2ce36034"},
            {"type": "syllabus", "name": "", "courseid": "20959", "id": "20959"},
        ],
    },
    {
        "query": "What is the grading policy for CHM 201?",
        "mode": "agent",
        "intent": "syllabus",
        "answer": "CHM 201 syllabus node or syllabus PDF with grading breakdown.",
        "expected": [
            {"type": "syllabus", "name": "", "courseid": "15160", "id": "15160"},
            {"type": "file", "name": "CHM201_F2024 General Chemistry I syllabus", "courseid": "15160", "id": "course-syllabus-15160"},
        ],
    },
    {
        "query": "Where are the CHI 108 week 3 materials?",
        "mode": "agent",
        "intent": "material",
        "answer": "CHI 108 Week 3 grammar homework or week-tagged course files.",
        "expected": [
            {"type": "assignment", "name": "Week 3 语法作业", "courseid": "17239", "id": "f233c7d2e10f218e"},
            {"type": "file", "name": "CHI108_S2025 Intensive Intermediate Chinese homepage", "courseid": "17239", "id": "homepage-17239"},
        ],
    },
    {
        "query": "What readings are before the ASA344 midterm?",
        "mode": "agent",
        "intent": "exam",
        "answer": "ASA344/urban studies midterm assignment and linked reading materials.",
        "expected": [
            {"type": "assignment", "name": "Midterm", "courseid": "19971", "id": "23c49ab423445599"},
            {"type": "file", "name": "ASA344-AMS344-URB344_F2025 Building Asian America", "courseid": "19971", "id": "homepage-19971"},
        ],
    },
    {
        "query": "Show me CHM 201 practice problems",
        "mode": "agent",
        "intent": "practice",
        "answer": "CHM 201 problem set assignments (practice problems).",
        "expected": [
            {"type": "assignment", "name": "Problem Set 1", "courseid": "15160", "id": "bef0d8d8afc28004"},
            {"type": "assignment", "name": "Problem Set 2", "courseid": "15160", "id": "0254254c1a0c5c01"},
        ],
    },
    {
        "query": "What are the office hours for MAT 201?",
        "mode": "agent",
        "intent": "syllabus",
        "answer": "MAT 201 office hours events (Regular, Lunch, Dinner) or syllabus.",
        "expected": [
            {"type": "event", "name": "Regular Office Hours", "courseid": "20812", "id": "Regular Office Hourseventid"},
            {"type": "event", "name": "Lunch Office Hours (NCW)", "courseid": "20812", "id": "Lunch Office Hours (NCW)eventid"},
            {"type": "syllabus", "name": "", "courseid": "20812", "id": "20812"},
        ],
    },
    {
        "query": "Find ECO 101 readings on trade policy",
        "mode": "agent",
        "intent": "material",
        "answer": "ECO 101 course homepage or reading-linked assignments (tariff/trade content in modules).",
        "expected": [
            {"type": "file", "name": "ECO101_S2026 Introduction to Macroeconomics homepage", "courseid": "20959", "id": "homepage-20959"},
            {"type": "syllabus", "name": "", "courseid": "20959", "id": "20959"},
        ],
    },
    {
        "query": "When is the ECO 101 final exam?",
        "mode": "agent",
        "intent": "deadline",
        "answer": "ECO 101 Final Exam assignment or final exam event.",
        "expected": [
            {"type": "assignment", "name": "Final Exam", "courseid": "20959", "id": "42cb958509d21ddb"},
            {"type": "event", "name": "Final", "courseid": "20959", "id": "Finaleventid"},
        ],
    },
]


def run_query(query: str, mode: str, *, production_cutoff: bool) -> list[dict]:
    import vector_retreival as vr

    original_retrieval_cutoff = vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF
    original_browser_cutoff = vr.BROWSER_INTERNAL_SCORE_CUTOFF
    if not production_cutoff:
        vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF = 0.0
        vr.BROWSER_INTERNAL_SCORE_CUTOFF = 0.0
    try:
        results = retreive(query, k=max(TOP_K, 20), mode=mode)
    finally:
        vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF = original_retrieval_cutoff
        vr.BROWSER_INTERNAL_SCORE_CUTOFF = original_browser_cutoff
    return [serialize_startpoint(item) for item in results[:TOP_K]]


def build_entry(spec: dict, *, production_cutoff: bool) -> dict:
    query = spec["query"]
    mode = spec["mode"]
    intent = spec.get("intent") or classify_query_intent(query)
    print(f"{mode}: {query}", flush=True)
    return {
        "query": query,
        "mode": mode,
        "intent": intent,
        "answer": spec.get("answer", ""),
        "expected": spec.get("expected") or [],
        "results": run_query(query, mode, production_cutoff=production_cutoff),
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build RAG_ground_truth.json")
    parser.add_argument(
        "--no-production-cutoff",
        action="store_true",
        help="Capture live results with cutoff disabled (legacy full-rank snapshot)",
    )
    parser.add_argument(
        "--holdout",
        action="store_true",
        help="Build RAG_holdout_ground_truth.json from HOLDOUT_QUERY_SPECS",
    )
    args = parser.parse_args()
    production_cutoff = not args.no_production_cutoff

    specs = QUERY_SPECS
    out_path = ROOT / "RAG_ground_truth.json"
    if args.holdout:
        from scripts.rag_holdout_specs import HOLDOUT_QUERY_SPECS

        specs = HOLDOUT_QUERY_SPECS
        out_path = ROOT / "RAG_holdout_ground_truth.json"

    search_queries = [build_entry(spec, production_cutoff=production_cutoff) for spec in specs if spec["mode"] == "browser"]
    agent_queries = [build_entry(spec, production_cutoff=production_cutoff) for spec in specs if spec["mode"] == "agent"]

    output: dict = {
        "version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "top_k": TOP_K,
        "notes": (
            "Human-judged expected nodes per query plus live retrieval snapshot. "
            "Search queries use browser mode; agent queries use agent mode. "
            f"Live results captured with production_cutoff={production_cutoff}."
            + (" Held-out set — not in QUERY_SPECS." if args.holdout else "")
        ),
        "retrieval_modes": {
            "search": "browser",
            "agent": "agent",
        },
        "search_queries": search_queries,
        "agent_queries": agent_queries,
    }

    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out_path} ({len(search_queries)} search + {len(agent_queries)} agent)", flush=True)


if __name__ == "__main__":
    main()
