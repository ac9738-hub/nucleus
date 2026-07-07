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

    def test_stage_handoff_defers_claude_until_continue(self):
        stage_one_handoff_tool_ids.clear()
        stage_one_handoff_tool_ids.add("toolu_handoff")
        self.assertTrue(_tool_response_is_stage_handoff("toolu_handoff"))
        self.assertFalse(_tool_response_is_stage_handoff("toolu_handoff"))
        self.assertFalse(stage_one_handoff_tool_ids)

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


if __name__ == "__main__":
    unittest.main()
