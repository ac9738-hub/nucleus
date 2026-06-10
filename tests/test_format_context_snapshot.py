#!/usr/bin/env python3
"""Unit tests for context snapshot formatting."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from context_format import format_context_snapshot  # noqa: E402


class FormatContextSnapshotTests(unittest.TestCase):
    def test_empty_snapshot_returns_empty_string(self):
        self.assertEqual(format_context_snapshot(None), "")
        self.assertEqual(format_context_snapshot("bad"), "")

    def test_renders_navigation_tabs_and_screen_text(self):
        rendered = format_context_snapshot({
            "schemaVersion": 1,
            "app": {
                "top": "workspace",
                "activeSection": "",
                "activeWorkspaceId": "nucleus",
            },
            "layout": {
                "workspaceSidebarCollapsed": False,
                "aiPanel": {"width": 340, "minimized": False},
            },
            "workspaces": {
                "active": "nucleus",
                "open": [{"id": "nucleus", "name": "Project Center", "openTabIds": ["center:nucleus"]}],
            },
            "tabs": [{"id": "center:nucleus", "type": "center", "label": "Project Center", "active": True}],
            "activeTab": {"id": "center:nucleus", "type": "center", "label": "Project Center", "active": True},
            "surface": {"kind": "project-center", "description": "Workspace Project Center"},
            "screen": {
                "source": "renderer-dom",
                "scroll": {"y": 0, "ratio": 0, "viewportHeight": 800, "contentHeight": 1200},
                "text": [{"tag": "h2", "text": "Welcome back"}],
            },
        })
        self.assertIn("Live app context (structured snapshot):", rendered)
        self.assertIn("Navigation:", rendered)
        self.assertIn("Open tabs (1):", rendered)
        self.assertIn("On-screen content", rendered)
        self.assertIn("Welcome back", rendered)


if __name__ == "__main__":
    unittest.main()
