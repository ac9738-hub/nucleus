#!/usr/bin/env python3
"""Sidekick citation repair helpers."""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sidekick  # noqa: E402


class SidekickCitationTests(unittest.TestCase):
    def test_answer_has_citations(self):
        self.assertTrue(sidekick.answer_has_citations("Policy is stated in the syllabus [R1]."))
        self.assertFalse(sidekick.answer_has_citations("Policy is stated in the syllabus."))

    def test_repair_skips_without_require_flag(self):
        sidekick.runtime_require_citations = False
        sidekick.runtime_grounding_labels = {"retrieval": ["R1"], "screen": []}
        text = sidekick.repair_missing_citations("No cites here.")
        self.assertEqual(text, "No cites here.")

    @patch.object(sidekick, "deepseek_client")
    def test_repair_adds_citations(self, mock_client):
        sidekick.runtime_require_citations = True
        sidekick.runtime_grounding_labels = {"retrieval": ["R1"], "screen": []}
        response = MagicMock()
        response.choices = [MagicMock(message=MagicMock(content="Grounded claim [R1]."))]
        mock_client.chat.completions.create.return_value = response
        repaired = sidekick.repair_missing_citations("Grounded claim.")
        self.assertIn("[R1]", repaired)


if __name__ == "__main__":
    unittest.main()
