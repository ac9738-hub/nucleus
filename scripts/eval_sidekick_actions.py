#!/usr/bin/env python3
"""Evaluate sidekick routing on action-style queries (workspace, deadlines, explain)."""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidekick_router import choose_model_route, classify_message  # noqa: E402
from tests.sidekick_action_fixtures import ACTION_FIXTURES  # noqa: E402


def eval_actions():
    by_category: dict[str, list[dict]] = defaultdict(list)
    route_ok = retrieval_ok = 0
    cases = []

    for fixture in ACTION_FIXTURES:
        decision = classify_message(fixture.text, hints=fixture.hints)
        route = choose_model_route(decision)
        route_match = route == fixture.expected_route
        retrieval_match = decision.needs_retrieval == fixture.expected_retrieval
        if route_match:
            route_ok += 1
        if retrieval_match:
            retrieval_ok += 1
        row = {
            "text": fixture.text,
            "category": fixture.category,
            "route": route.value,
            "expected_route": fixture.expected_route.value,
            "route_ok": route_match,
            "needs_retrieval": decision.needs_retrieval,
            "expected_retrieval": fixture.expected_retrieval,
            "retrieval_ok": retrieval_match,
            "reason": decision.reason,
            "confidence": round(decision.confidence, 3),
            "has_course_focus": fixture.hints.has_course_focus,
        }
        cases.append(row)
        by_category[fixture.category].append(row)

    total = len(ACTION_FIXTURES)
    category_summary = {}
    for category, rows in sorted(by_category.items()):
        category_summary[category] = {
            "count": len(rows),
            "route_accuracy": sum(1 for row in rows if row["route_ok"]) / len(rows),
            "retrieval_accuracy": sum(1 for row in rows if row["retrieval_ok"]) / len(rows),
        }

    return {
        "queries": total,
        "route_accuracy": route_ok / total if total else 1.0,
        "retrieval_accuracy": retrieval_ok / total if total else 1.0,
        "all_ok": route_ok == total and retrieval_ok == total,
        "by_category": category_summary,
        "cases": cases,
    }


def main():
    report = eval_actions()
    print(json.dumps(report, indent=2))
    return 0 if report["all_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
