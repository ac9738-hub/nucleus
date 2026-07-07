#!/usr/bin/env python3
"""Tests for structural teaching-block detection."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.teaching_blocks import (  # noqa: E402
    classify_teaching_block,
    extract_teaching_units_from_pages,
    summarize_teaching_units,
    teaching_labels_match,
)


class TeachingBlockTests(unittest.TestCase):
    def test_classify_section_and_example(self):
        section = classify_teaching_block("2.3 Matrix Products85")
        self.assertIsNotNone(section)
        self.assertEqual(section["type"], "section")

        example = classify_teaching_block("8.7 Example-A Storage Allocator")
        self.assertIsNotNone(example)
        self.assertEqual(example["type"], "example")

    def test_classify_problem_and_concept(self):
        problem = classify_teaching_block("Problem 4: compute the inverse")
        self.assertIsNotNone(problem)
        self.assertEqual(problem["type"], "problem")

        concept = classify_teaching_block("Cellular neuroanatomy:")
        self.assertIsNotNone(concept)
        self.assertEqual(concept["type"], "concept")

    def test_extract_units_from_pages(self):
        pages = [{
            "pageid": "f:page:1",
            "pageNumber": 1,
            "blocks": [
                {"text": "1.1 Introduction to Linear Systems"},
                {"text": "Example 3: A system without solutions"},
                {"text": "1. Compute the product"},
            ],
        }]
        units = extract_teaching_units_from_pages(pages)
        types = {unit["type"] for unit in units}
        self.assertIn("section", types)
        self.assertTrue({"example", "problem"} & types)

    def test_summarize_teaching_units(self):
        summary = summarize_teaching_units([
            {"type": "section", "name": "Matrix Products", "pageid": "p1", "pageNumber": 1},
        ])
        self.assertIn("Matrix Products", summary)
        self.assertIn("checklist", summary.lower())

    def test_catch_all_title_line_not_concept(self):
        concept = classify_teaching_block("Three in-class quizzes, one cumulative final")
        self.assertIsNone(concept)

    def test_label_match_fuzzy(self):
        self.assertTrue(teaching_labels_match("Matrix Products", "2.3 Matrix Products"))
        self.assertTrue(teaching_labels_match("Problem 4", "Exercise 4"))


if __name__ == "__main__":
    unittest.main()
