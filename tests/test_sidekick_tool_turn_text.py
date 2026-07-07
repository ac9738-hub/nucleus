#!/usr/bin/env python3
"""Tests for suppressing interim text during tool-use turns."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sidekick  # noqa: E402


class SidekickToolTurnTextTests(unittest.TestCase):
    def test_finalize_claude_turn_drops_text_when_tools_called(self):
        sidekick.stage_one_handoff_tool_ids.clear()
        assistant_content, tools, visible = sidekick._finalize_claude_turn(
            full_text="Let me look that up for you.",
            tool_calls={
                0: {
                    "id": "toolu_1",
                    "name": "retrieve_user_context",
                    "input": '{"query":"syllabus"}',
                }
            },
            stage=2,
        )
        self.assertEqual(visible, "")
        self.assertEqual(len(tools), 1)
        self.assertEqual(len(assistant_content), 1)
        self.assertEqual(assistant_content[0]["type"], "tool_use")
        self.assertTrue(all(block.get("type") != "text" for block in assistant_content))

    def test_finalize_claude_turn_keeps_text_when_no_tools(self):
        assistant_content, tools, visible = sidekick._finalize_claude_turn(
            full_text="Here is the answer.",
            tool_calls={},
            stage=2,
        )
        self.assertEqual(visible, "Here is the answer.")
        self.assertEqual(tools, [])
        self.assertEqual(assistant_content[0]["text"], "Here is the answer.")

    def test_tool_prompt_includes_silence_instruction(self):
        sidekick.runtime_answer_mode = "grounded"
        prompt = sidekick._system_prompt_for_mode(include_tools=True)
        self.assertIn("without writing planning notes", prompt)


if __name__ == "__main__":
    unittest.main()
