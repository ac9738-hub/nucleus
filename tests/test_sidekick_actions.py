#!/usr/bin/env python3
"""Tests for sidekick action-query routing fixtures."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidekick_router import choose_model_route, classify_message  # noqa: E402
from tests.sidekick_action_fixtures import ACTION_FIXTURES  # noqa: E402


class SidekickActionRouterTests(unittest.TestCase):
    def test_action_fixtures(self):
        for fixture in ACTION_FIXTURES:
            with self.subTest(text=fixture.text, category=fixture.category):
                decision = classify_message(fixture.text, hints=fixture.hints)
                route = choose_model_route(decision)
                self.assertEqual(route, fixture.expected_route, decision.reason)
                self.assertEqual(decision.needs_retrieval, fixture.expected_retrieval)


if __name__ == "__main__":
    unittest.main()
