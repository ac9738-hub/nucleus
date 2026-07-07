#!/usr/bin/env python3
"""Tests for positioned page-block ingestion."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.page_blocks import (  # noqa: E402
    build_raw_document_pages,
    merge_page_records,
    pages_missing_positioned_blocks,
    summarize_page_blocks,
)


def _normalize_blocks(blocks):
    return blocks


class PageBlockIngestionTests(unittest.TestCase):
    def test_build_raw_document_pages_creates_positioned_blocks(self):
        pages = build_raw_document_pages("file123", "First paragraph.\n\nSecond paragraph.")
        self.assertEqual(len(pages), 1)
        blocks = pages[0]["blocks"]
        self.assertGreaterEqual(len(blocks), 2)
        self.assertIn("First paragraph", blocks[0]["text"])
        self.assertGreater(blocks[0]["yRatio1"], blocks[0]["yRatio0"])

    def test_merge_page_records_prefers_incoming_blocks(self):
        existing = [{
            "pageid": "f:page:1",
            "pageNumber": 1,
            "yScroll": 0,
            "text": "legacy",
            "blocks": [],
            "nodes": [{"type": "concept", "id": "c1", "name": "Concept"}],
        }]
        incoming = [{
            "pageid": "f:page:1",
            "pageNumber": 1,
            "yScroll": 0,
            "text": "fresh",
            "blocks": [{"text": "Visible block", "y0": 0, "y1": 24, "yRatio0": 0, "yRatio1": 0.1}],
            "nodes": [],
        }]
        merged = merge_page_records(existing, incoming, _normalize_blocks)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["blocks"][0]["text"], "Visible block")
        self.assertEqual(merged[0]["nodes"][0]["id"], "c1")

    def test_pages_missing_positioned_blocks(self):
        self.assertTrue(pages_missing_positioned_blocks([]))
        self.assertTrue(pages_missing_positioned_blocks([{"text": "only page text", "blocks": []}]))
        self.assertFalse(pages_missing_positioned_blocks([
            {"blocks": [{"text": "block"}]}
        ]))

    def test_summarize_page_blocks(self):
        summary = summarize_page_blocks([
            {"pageNumber": 2, "blocks": [{"text": "Eigenvalues overview"}]}
        ])
        self.assertIn("Eigenvalues", summary)


if __name__ == "__main__":
    unittest.main()
