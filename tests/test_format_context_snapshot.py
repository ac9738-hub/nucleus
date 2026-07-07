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

    def test_renders_navigation_tabs_and_index(self):
        rendered = format_context_snapshot({
            "schemaVersion": 2,
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
            "tabs": [{
                "id": "canvas:100",
                "type": "canvastab",
                "label": "Biology",
                "active": True,
                "courseId": "100",
            }],
            "activeTab": {
                "id": "canvas:100",
                "type": "canvastab",
                "label": "Biology",
                "active": True,
                "courseId": "100",
            },
            "surface": {
                "kind": "canvas-native",
                "description": "Canvas native view — course 100",
                "courseId": "100",
            },
            "index": {
                "courses": [{"id": "100", "code": "BIO 101", "name": "Biology"}],
                "tasks": [{"id": "t1", "title": "Study for quiz", "due": "Friday", "course": "BIO 101"}],
                "dueSoon": [{
                    "id": "a1",
                    "name": "Quiz 2",
                    "courseid": "100",
                    "due_at": "2026-06-18T00:00:00.000Z",
                }],
                "weekly": {
                    "100": {
                        "current": {
                            "weekLabel": "Week 3",
                            "dateRange": "Jun 16 – Jun 22",
                            "assignments": ["Quiz 2"],
                            "files": ["Lecture 3.pdf"],
                            "events": [],
                        }
                    }
                },
                "focus": {
                    "courseId": "100",
                    "file": {"filename": "Lecture 3.pdf", "pageNumbers": [2]},
                    "concepts": ["Mitosis"],
                },
                "focusCourseIds": ["100"],
            },
        })
        self.assertIn("Live app context (structured snapshot):", rendered)
        self.assertIn("Navigation:", rendered)
        self.assertIn("Open tabs (1):", rendered)
        self.assertIn("Indexed app state:", rendered)
        self.assertIn("Due soon", rendered)
        self.assertIn("Quiz 2", rendered)
        self.assertIn("Weekly schedule", rendered)
        self.assertIn("Mitosis", rendered)
        self.assertNotIn("On-screen content", rendered)

    def test_renders_screen_chunks_with_cite_labels(self):
        rendered = format_context_snapshot({
            "schemaVersion": 2,
            "app": {"top": "workspace", "activeSection": "", "activeWorkspaceId": "nucleus"},
            "layout": {"workspaceSidebarCollapsed": False, "aiPanel": {"width": 340, "minimized": False}},
            "workspaces": {"active": "nucleus", "open": []},
            "tabs": [],
            "activeTab": None,
            "surface": {"kind": "canvas-web", "description": "Canvas PDF"},
            "index": {"courses": [], "tasks": [], "dueSoon": [], "weekly": {}, "focus": None, "focusCourseIds": []},
            "screen": {
                "source": "pdf",
                "surfaceKind": "canvas-web",
                "url": "https://canvas.test/courses/1/files?preview=99",
                "title": "Lecture 3.pdf",
                "scroll": {"y": 120, "ratio": 0.1, "viewportHeight": 800, "contentHeight": 8000},
                "chunks": [
                    {
                        "citeLabel": "C1",
                        "chunkId": "screen:pdf-viewport/b0",
                        "text": "Mitosis begins in prophase.",
                        "source": {"type": "screen-block", "fileid": "99", "pageNumber": 2, "tag": "pdf"},
                    }
                ],
            },
        })
        self.assertIn("On-screen content:", rendered)
        self.assertIn("On-screen source chunks", rendered)
        self.assertIn("[C1]", rendered)
        self.assertIn("Mitosis begins in prophase", rendered)


if __name__ == "__main__":
    unittest.main()
