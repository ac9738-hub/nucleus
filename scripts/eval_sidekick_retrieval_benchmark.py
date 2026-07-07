#!/usr/bin/env python3
"""Benchmark sidekick fast retrieval latency and cache behavior."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

GRAPH_PATH = ROOT / "canvas_graph.json"

BENCHMARKS = [
    {
        "label": "focused_explain",
        "query": "explain the midterm topics for this course",
        "options": {"mode": "agent", "fast": True, "grounded": True, "k": 5, "focus_course_ids": ["15237"]},
    },
    {
        "label": "broad_notes",
        "query": "do I have notes on parallelism and concurrency?",
        "options": {"mode": "agent", "fast": True, "grounded": False, "k": 3, "focus_course_ids": []},
    },
    {
        "label": "course_exam",
        "query": "when is the CHM 201 midterm exam",
        "options": {"mode": "agent", "fast": True, "grounded": False, "k": 3, "focus_course_ids": []},
    },
]


def timed_retrieve(query, **options):
    from vector_retreival import retreive, warm_retrieval

    warm_retrieval()
    started = time.perf_counter()
    results = retreive(query, use_cache=options.pop("use_cache", False), **options)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return elapsed_ms, len(results)


def main():
    if not GRAPH_PATH.exists():
        print(json.dumps({"skipped": True, "reason": "canvas_graph.json missing"}))
        return 1

    rows = []
    for item in BENCHMARKS:
        cold_ms, cold_count = timed_retrieve(item["query"], use_cache=False, **item["options"])
        warm_ms, warm_count = timed_retrieve(item["query"], use_cache=True, **item["options"])
        rows.append({
            "label": item["label"],
            "query": item["query"],
            "coldMs": cold_ms,
            "warmMs": warm_ms,
            "speedup": round(cold_ms / warm_ms, 2) if warm_ms else None,
            "resultCountCold": cold_count,
            "resultCountWarm": warm_count,
        })

    report = {
        "benchmarks": rows,
        "medianColdMs": sorted(row["coldMs"] for row in rows)[len(rows) // 2],
        "medianWarmMs": sorted(row["warmMs"] for row in rows)[len(rows) // 2],
        "cache_effective": all(row["warmMs"] <= max(row["coldMs"], 1) for row in rows),
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
