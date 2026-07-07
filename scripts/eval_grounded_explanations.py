#!/usr/bin/env python3
"""Evaluate grounded explanation routing and citation label plumbing."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidekick_context import build_grounding_instructions  # noqa: E402
from sidekick_router import RouteContextHints, classify_message  # noqa: E402


CASES = [
    {
        "text": "explain what a binary search tree is",
        "hints": RouteContextHints(),
        "expect_retrieval": True,
        "expect_grounded": True,
    },
    {
        "text": "explain what a binary search tree is",
        "hints": RouteContextHints(has_course_focus=True),
        "expect_retrieval": True,
        "expect_grounded": True,
    },
    {
        "text": "explain the neuron doctrine from my neuroscience course",
        "hints": RouteContextHints(),
        "expect_retrieval": True,
        "expect_grounded": True,
    },
]


def main():
    rows = []
    passed = 0
    for case in CASES:
        decision = classify_message(case["text"], hints=case["hints"])
        ok = (
            decision.needs_retrieval == case["expect_retrieval"]
            and decision.grounded_explain == case["expect_grounded"]
        )
        passed += int(ok)
        rows.append({
            "text": case["text"],
            "has_course_focus": case["hints"].has_course_focus,
            "needs_retrieval": decision.needs_retrieval,
            "expect_retrieval": case["expect_retrieval"],
            "grounded_explain": decision.grounded_explain,
            "reason": decision.reason,
            "ok": ok,
        })

    sample_prompt = build_grounding_instructions(
        require_citations=True,
        retrieval_labels=["R1", "R2"],
        screen_labels=["C1"],
    )
    report = {
        "grounded_routing_accuracy": passed / len(CASES),
        "cases": rows,
        "grounding_prompt_has_cite_rules": "MUST cite them inline" in sample_prompt,
        "grounding_prompt_lists_labels": "R1" in sample_prompt and "C1" in sample_prompt,
    }
    print(json.dumps(report, indent=2))
    return 0 if passed == len(CASES) and report["grounding_prompt_has_cite_rules"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
