#!/usr/bin/env python3
"""Evaluate sidekick routing accuracy and estimate retrieval savings."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidekick_router import SidekickRoute, choose_model_route, classify_message  # noqa: E402
from tests.test_sidekick_router import ROUTER_FIXTURES  # noqa: E402


def main():
    results = []
    correct_route = 0
    retrieval_calls = 0
    retrieval_saved = 0

    for text, expected_route, expected_retrieval in ROUTER_FIXTURES:
        decision = classify_message(text)
        route = choose_model_route(decision)
        route_ok = route == expected_route
        retrieval_ok = decision.needs_retrieval == expected_retrieval
        if route_ok:
            correct_route += 1
        if decision.needs_retrieval:
            retrieval_calls += 1
        else:
            retrieval_saved += 1
        results.append({
            "text": text,
            "route": route.value,
            "expected_route": expected_route.value,
            "route_ok": route_ok,
            "needs_retrieval": decision.needs_retrieval,
            "expected_retrieval": expected_retrieval,
            "retrieval_ok": retrieval_ok,
            "confidence": round(decision.confidence, 3),
            "reason": decision.reason,
        })

    total = len(ROUTER_FIXTURES)
    report = {
        "route_accuracy": correct_route / total if total else 1.0,
        "retrieval_skip_rate": retrieval_saved / total if total else 0.0,
        "retrieval_calls": retrieval_calls,
        "model_mix": {
            route.value: sum(1 for item in results if item["route"] == route.value)
            for route in SidekickRoute
        },
        "cases": results,
    }
    print(json.dumps(report, indent=2))
    return 0 if correct_route == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
