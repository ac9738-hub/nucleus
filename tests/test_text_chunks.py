#!/usr/bin/env python3
"""Tests for citeable text chunking and grounding."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.text_chunks import (  # noqa: E402
    assign_cite_labels,
    chunk_from_page_blocks,
    chunk_from_screen_blocks,
    chunk_ids_unique,
    format_chunks_for_grounding,
    make_file_block_chunk_id,
    parse_cite_labels,
    resolve_citations,
)


class TextChunkTests(unittest.TestCase):
    def test_file_block_chunk_ids_are_stable(self):
        chunk_id = make_file_block_chunk_id("100", "f1", 2, 3)
        self.assertEqual(chunk_id, "file:100/f1/p2/b3")

    def test_chunk_from_page_blocks_assigns_cite_labels(self):
        pages = [{
            "pageid": "f1:page:1",
            "pageNumber": 1,
            "blocks": [
                {"text": "Mitosis overview", "yRatio0": 0.1, "yRatio1": 0.2},
                {"text": "Quiz due Friday", "yRatio0": 0.3, "yRatio1": 0.4},
            ],
        }]
        chunks = chunk_from_page_blocks(pages, courseid="100", fileid="f1")
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0]["citeLabel"], "C1")
        self.assertTrue(chunk_ids_unique(chunks))

    def test_chunk_from_screen_blocks(self):
        blocks = [{"tag": "p", "text": "Hello world", "y": 12}]
        chunks = chunk_from_screen_blocks(blocks, surface_kind="mail")
        self.assertEqual(chunks[0]["citeLabel"], "C1")
        self.assertEqual(chunks[0]["source"]["surfaceKind"], "mail")

    def test_format_and_resolve_citations(self):
        chunks = assign_cite_labels([
            {"chunkId": "a", "text": "Alpha fact", "source": {}},
            {"chunkId": "b", "text": "Beta fact", "source": {}},
        ])
        prompt = format_chunks_for_grounding(chunks)
        self.assertIn("[C1]", prompt)
        answer = "Alpha is true [C1] and beta follows [C2]."
        self.assertEqual(parse_cite_labels(answer), ["C1", "C2"])
        resolved = resolve_citations(answer, chunks)
        self.assertEqual(len(resolved), 2)
        self.assertEqual(resolved[0]["text"], "Alpha fact")


if __name__ == "__main__":
    unittest.main()
