#!/usr/bin/env python3
"""Tests for sidekick grounded vs general answer modes."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sidekick  # noqa: E402
from sidekick_context import build_grounding_instructions, build_stage_one_instructions  # noqa: E402


class SidekickAnswerModeTests(unittest.TestCase):
    def test_stage_one_general_disallows_canvas_escalation(self):
        text = build_stage_one_instructions(answer_mode="general")
        self.assertIn("General mode", text)
        self.assertIn("tool_use only", text)
        self.assertIn("Do not call continue_sidekick with wait_for_context", text)

    def test_grounding_instructions_general(self):
        text = build_grounding_instructions(answer_mode="general", screen_labels=["C1"])
        self.assertIn("General answer mode", text)
        self.assertIn("retrieve_user_context", text)
        self.assertIn("C1", text)

    def test_tools_for_stage_hide_retrieval_in_general(self):
        sidekick.runtime_answer_mode = "general"
        names = [tool.get("name") for tool in sidekick._tools_for_stage(2)]
        self.assertNotIn("retrieve_user_context", names)
        self.assertIn("add_task", names)

    def test_tools_for_stage_keep_retrieval_when_grounded(self):
        sidekick.runtime_answer_mode = "grounded"
        names = [tool.get("name") for tool in sidekick._tools_for_stage(2)]
        self.assertIn("retrieve_user_context", names)

    def test_normalize_claude_model(self):
        self.assertEqual(sidekick._normalize_claude_model("claude-opus-4-8"), "claude-opus-4-8")
        self.assertEqual(sidekick._normalize_claude_model("deepseek-chat"), "deepseek-chat")
        self.assertEqual(sidekick._normalize_claude_model("bad-model"), sidekick.CLAUDE_MODEL)

    def test_is_deepseek_model(self):
        sidekick.runtime_claude_model = "deepseek-chat"
        self.assertTrue(sidekick._is_deepseek_model())
        sidekick.runtime_claude_model = "claude-sonnet-4-6"
        self.assertFalse(sidekick._is_deepseek_model())


if __name__ == "__main__":
    unittest.main()
