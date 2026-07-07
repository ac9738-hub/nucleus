#!/usr/bin/env python3
"""Evaluate sidekick routing, grounding plumbing, and retrieval fast-path helpers."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidekick_context import build_grounding_instructions  # noqa: E402
from sidekick_router import RouteContextHints, SidekickRoute, choose_model_route, classify_message  # noqa: E402
from tests.test_sidekick_router import ROUTER_FIXTURES  # noqa: E402
from vector_retreival import (  # noqa: E402
    fast_rank_limits,
    get_cached_retrieval,
    narrow_course_pool,
    retrieval_cache_key,
    should_skip_fast_rank,
    store_cached_retrieval,
)


def eval_router():
    correct = 0
    retrieval_saved = 0
    for text, expected_route, expected_retrieval in ROUTER_FIXTURES:
        decision = classify_message(text)
        route = choose_model_route(decision)
        if route == expected_route:
            correct += 1
        if not decision.needs_retrieval:
            retrieval_saved += 1
    total = len(ROUTER_FIXTURES)
    return {
        "route_accuracy": correct / total if total else 1.0,
        "retrieval_skip_rate": retrieval_saved / total if total else 0.0,
    }


def eval_grounded_routing():
    cases = [
        (
            "explain what a binary search tree is",
            RouteContextHints(),
            True,
        ),
        (
            "explain what a binary search tree is",
            RouteContextHints(has_course_focus=True),
            True,
        ),
        (
            "explain the neuron doctrine from my neuroscience course",
            RouteContextHints(),
            True,
        ),
    ]
    ok = 0
    for text, hints, expect_retrieval in cases:
        decision = classify_message(text, hints=hints)
        if decision.needs_retrieval == expect_retrieval:
            ok += 1
    return {"grounded_routing_accuracy": ok / len(cases)}


def eval_fast_path_helpers():
    from vector_retreival import (
        AGENT_FOCUS_MAX_HEAP_POPS,
        AGENT_FOCUS_MAX_RANK_NODES,
        fast_rank_limits,
        focus_embed_prefilter_enabled,
        narrow_course_pool,
        should_skip_fast_rank,
    )

    pool, mode = narrow_course_pool({"100", "200"}, ["200"], pool_mode="moderate")
    max_rank, max_pops = fast_rank_limits(mode, pool, True, "agent")
    return {
        "focus_pool_ok": pool == {"200"} and mode == "focus",
        "skip_low_signal_rank": should_skip_fast_rank(True, "agent", 0.01, 0.1),
        "focus_rank_cap_ok": max_rank == AGENT_FOCUS_MAX_RANK_NODES and max_pops == AGENT_FOCUS_MAX_HEAP_POPS,
        "focus_embed_prefilter_ok": focus_embed_prefilter_enabled(True, "agent", {"200"}, "focus"),
    }


def eval_grounding_prompt():
    prompt = build_grounding_instructions(
        require_citations=True,
        retrieval_labels=["R1"],
        screen_labels=["C1"],
    )
    return {
        "has_mandatory_cite_rule": "Include at least one inline [R#]" in prompt,
        "lists_labels": "R1" in prompt and "C1" in prompt,
    }


def run_pytest_subset():
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "tests/test_sidekick_router.py",
            "tests/test_sidekick_actions.py",
            "tests/test_sidekick_call_context.py",
            "tests/test_sidekick_citations.py",
            "tests/test_vector_retrieval.py",
            "-q",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return {
        "passed": proc.returncode == 0,
        "exit_code": proc.returncode,
        "output_tail": proc.stdout.splitlines()[-3:],
    }


def eval_cache_helpers():
    key = retrieval_cache_key(
        "explain neurons",
        k=5,
        mode="agent",
        fast=True,
        grounded=True,
        focus_course_ids=["200", "100"],
    )
    store_cached_retrieval(key, [{"type": "concept"}])
    hit = get_cached_retrieval(key)
    return {
        "cache_roundtrip_ok": isinstance(hit, list) and hit[0]["type"] == "concept",
        "cache_key_orders_focus": "100,200" in key,
    }


def eval_rag_agent_holdout():
    gt_path = ROOT / "RAG_holdout_ground_truth.json"
    graph_path = ROOT / "canvas_graph.json"
    if not gt_path.exists() or not graph_path.exists():
        return {"skipped": True}

    from scripts.eval_rag import aggregate, evaluate_query, load_ground_truth, classify_query_intent
    from vector_retreival import retreive, serialize_startpoint

    gt = load_ground_truth(gt_path)
    agent_entries = list(gt.get("agent_queries") or [])
    if not agent_entries:
        return {"skipped": True, "reason": "no agent queries"}

    production_rows = [evaluate_query(entry, k=5, production_cutoff=True) for entry in agent_entries]
    production = aggregate(production_rows)

    fast_rows = []
    for entry in agent_entries:
        query = entry["query"]
        results = retreive(
            query,
            k=5,
            mode="agent",
            fast=True,
            grounded=True,
            use_cache=False,
        )
        actual = [serialize_startpoint(item, query=query) for item in results]
        from scripts.eval_rag import expected_items, intent_match_at_k, ndcg_at_k, recall_at_k

        expected = expected_items(entry)
        intent = entry.get("intent") or classify_query_intent(query)
        fast_rows.append({
            "query": query,
            "intent": intent,
            "recall_at_k": recall_at_k(expected, actual, 5),
            "ndcg_at_k": ndcg_at_k(expected, actual, 5),
            "intent_match_at_k": intent_match_at_k(query, actual, 5),
            "empty": len(actual) == 0,
        })
    fast = aggregate(fast_rows)

    return {
        "queries": len(agent_entries),
        "production_recall_at_5": round(production["recall_at_k"], 3),
        "fast_sidekick_recall_at_5": round(fast["recall_at_k"], 3),
        "production_intent_match": round(production["intent_match_at_k"], 3),
        "fast_sidekick_intent_match": round(fast["intent_match_at_k"], 3),
        "recall_regression_ok": fast["recall_at_k"] >= production["recall_at_k"] - 0.05,
    }


def eval_action_queries():
    from tests.sidekick_action_fixtures import ACTION_FIXTURES
    from scripts.eval_sidekick_actions import eval_actions

    return eval_actions()


def main():
    report = {
        "router": eval_router(),
        "action_queries": eval_action_queries(),
        "grounded_routing": eval_grounded_routing(),
        "fast_path": eval_fast_path_helpers(),
        "cache": eval_cache_helpers(),
        "grounding_prompt": eval_grounding_prompt(),
        "rag_agent_holdout": eval_rag_agent_holdout(),
        "pytest": run_pytest_subset(),
        "notes": {
            "retrieval_benchmark": "python scripts/eval_sidekick_retrieval_benchmark.py",
            "rag_full": "python scripts/eval_rag.py --holdout --production-cutoff",
        },
    }
    rag = report["rag_agent_holdout"]
    rag_ok = rag.get("skipped") or rag.get("recall_regression_ok", False)
    actions = report["action_queries"]
    report["pipeline_ok"] = (
        report["router"]["route_accuracy"] == 1.0
        and actions["all_ok"]
        and report["grounded_routing"]["grounded_routing_accuracy"] == 1.0
        and report["fast_path"]["focus_pool_ok"]
        and report["cache"]["cache_roundtrip_ok"]
        and report["grounding_prompt"]["has_mandatory_cite_rule"]
        and rag_ok
        and report["pytest"]["passed"]
    )
    print(json.dumps(report, indent=2))
    return 0 if report["pipeline_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
