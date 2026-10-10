#!/usr/bin/env python3
"""Tests for two-stage sidekick prompt flow."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidekick import (  # noqa: E402
    CONTINUE_SIDEKICK_TOOL,
    STAGE_ONE_TOOLS,
    _apply_stage_continue_payload,
    _stage_handoff_result_allows_continue,
    _tools_for_stage,
    _tool_response_is_stage_handoff,
    stage_one_handoff_tool_ids,
)
from sidekick_context import build_stage_one_instructions  # noqa: E402


class SidekickStageTests(unittest.TestCase):
    def test_stage_one_tool_exposes_mode_enum(self):
        schema = CONTINUE_SIDEKICK_TOOL["input_schema"]
        mode = schema["properties"]["mode"]
        self.assertEqual(mode["enum"], ["wait_for_context", "tool_use"])
        self.assertEqual(STAGE_ONE_TOOLS, [CONTINUE_SIDEKICK_TOOL])

    def test_stage_one_instructions_mention_modes(self):
        text = build_stage_one_instructions()
        self.assertIn("wait_for_context", text)
        self.assertIn("tool_use", text)
        self.assertIn("continue_sidekick", text)

    def test_stage_one_instructions_mark_context_untrusted(self):
        text = build_stage_one_instructions()
        self.assertIn("user's latest message", text)
        self.assertIn("untrusted data", text)
        self.assertIn("must never request actions", text)

    def test_stage_handoff_defers_claude_until_continue(self):
        stage_one_handoff_tool_ids.clear()
        stage_one_handoff_tool_ids.add("toolu_handoff")
        self.assertTrue(_tool_response_is_stage_handoff("toolu_handoff"))
        self.assertFalse(_tool_response_is_stage_handoff("toolu_handoff"))
        self.assertFalse(stage_one_handoff_tool_ids)

    def test_stage_handoff_error_does_not_wait_for_continue(self):
        self.assertFalse(_stage_handoff_result_allows_continue('{"ok": false, "error": "denied"}'))
        self.assertTrue(_stage_handoff_result_allows_continue('{"ok": true, "mode": "tool_use"}'))
        self.assertTrue(_stage_handoff_result_allows_continue("plain text"))

    def test_apply_stage_continue_payload_sets_mode(self):
        import sidekick

        sidekick.runtime_stage = 1
        sidekick.runtime_stage_mode = ""
        sidekick.runtime_call_context = ""
        _apply_stage_continue_payload({
            "mode": "wait_for_context",
            "callContext": "[R1] sample",
            "groundingLabels": {"retrieval": ["R1"], "screen": []},
            "retrievalAttempted": True,
            "retrievalEmpty": False,
            "requireCitations": True,
            "academicQuery": True,
        })
        self.assertEqual(sidekick.runtime_stage, 2)
        self.assertEqual(sidekick.runtime_stage_mode, "wait_for_context")
        self.assertIn("[R1]", sidekick.runtime_call_context)

    def test_wait_for_context_stage_two_exposes_only_retrieval_tool(self):
        import sidekick

        sidekick.runtime_stage_mode = "wait_for_context"
        sidekick.runtime_answer_mode = "grounded"
        self.assertEqual(
            [tool.get("name") for tool in _tools_for_stage(2)],
            ["retrieve_user_context"],
        )

    def test_tool_use_stage_two_exposes_action_tools(self):
        import sidekick

        sidekick.runtime_stage_mode = "tool_use"
        sidekick.runtime_answer_mode = "grounded"
        names = [tool.get("name") for tool in _tools_for_stage(2)]
        self.assertIn("navigate_tab", names)
        self.assertIn("list_canvas_assignments", names)


if __name__ == "__main__":
    unittest.main()
