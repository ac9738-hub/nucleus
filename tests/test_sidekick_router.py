#!/usr/bin/env python3
"""Sidekick router + latency eval fixtures."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidekick_router import (  # noqa: E402
    RouteContextHints,
    SidekickRoute,
    choose_model_route,
    classify_message,
)


ROUTER_FIXTURES = [
    ("create a task called study for exam", SidekickRoute.TOOL, False),
    ("open my calculus workspace", SidekickRoute.TOOL, False),
    ("what assignments are due tomorrow", SidekickRoute.DATA, False),
    ("show my tasks for this week", SidekickRoute.DATA, False),
    ("when is the CHM 201 midterm exam", SidekickRoute.DATA, True),
    ("do I have notes on parallelism", SidekickRoute.DATA, True),
    ("explain what a binary search tree is", SidekickRoute.CHAT, True),
    ("what is currently on my screen", SidekickRoute.DATA, False),
    ("thanks!", SidekickRoute.FALLBACK, False),
]


class SidekickRouterTests(unittest.TestCase):
    def test_router_fixtures(self):
        for text, expected_route, expected_retrieval in ROUTER_FIXTURES:
            with self.subTest(text=text):
                decision = classify_message(text)
                route = choose_model_route(decision)
                self.assertEqual(route, expected_route, decision.reason)
                self.assertEqual(decision.needs_retrieval, expected_retrieval)

    def test_attachment_tool_route(self):
        decision = classify_message("summarize this pdf", has_attachments=True)
        self.assertEqual(choose_model_route(decision), SidekickRoute.FALLBACK)

    def test_low_confidence_escalates(self):
        decision = classify_message("thanks!")
        self.assertEqual(choose_model_route(decision), SidekickRoute.FALLBACK)

    def test_grounded_explain_retrieves_without_course_focus(self):
        decision = classify_message("explain what a binary search tree is")
        self.assertEqual(choose_model_route(decision), SidekickRoute.CHAT)
        self.assertTrue(decision.needs_retrieval)
        self.assertTrue(decision.grounded_explain)

    def test_grounded_explain_retrieves_with_course_focus(self):
        decision = classify_message(
            "explain what a binary search tree is",
            hints=RouteContextHints(has_course_focus=True),
        )
        self.assertEqual(choose_model_route(decision), SidekickRoute.CHAT)
        self.assertTrue(decision.needs_retrieval)
        self.assertTrue(decision.grounded_explain)

    def test_problem_query_retrieves_without_course_focus(self):
        decision = classify_message("how do I solve this eigenvalue problem")
        self.assertEqual(choose_model_route(decision), SidekickRoute.CHAT)
        self.assertTrue(decision.needs_retrieval)
        self.assertTrue(decision.problem_query)
        self.assertEqual(decision.reason, "problem_solve")

    def test_problem_hint_query_retrieves(self):
        decision = classify_message("give me a hint for problem 3 on the pset")
        self.assertTrue(decision.needs_retrieval)
        self.assertTrue(decision.problem_query)


if __name__ == "__main__":
    unittest.main()
