#!/usr/bin/env python3
"""Unit tests for UTF-8 sanitization."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from text_sanitize import clean_surrogates  # noqa: E402


class CleanSurrogatesTests(unittest.TestCase):
    def test_lone_surrogate_is_replaced(self):
        bad = "hello\udc8fworld"
        cleaned = clean_surrogates(bad)
        self.assertNotIn("\udc8f", cleaned)
        json.dumps({"text": cleaned})

    def test_valid_emoji_survives(self):
        text = "hello 👍 world"
        self.assertEqual(clean_surrogates(text), text)

    def test_nested_structures_are_cleaned(self):
        payload = {"items": [{"name": "bad\udc8f"}]}
        cleaned = clean_surrogates(payload)
        json.dumps(cleaned)


if __name__ == "__main__":
    unittest.main()
