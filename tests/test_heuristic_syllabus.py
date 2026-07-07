#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.heuristic_syllabus import (  # noqa: E402
    build_syllabus_type_extractions,
    extract_syllabus_assignment_dues,
    extract_syllabus_exam_rows,
    extract_syllabus_grade_components,
    extract_syllabus_heuristic_bundle,
    extract_syllabus_participation_grade,
)


class HeuristicSyllabusTests(unittest.TestCase):
    def test_grade_components(self):
        text = (
            "Grading breakdown\n"
            "Problem Sets 30%\n"
            "Midterm Exam 25%\n"
            "Final Exam 30%\n"
            "Participation 5%"
        )
        rows = extract_syllabus_grade_components(text)
        names = {row['name'].casefold() for row in rows}
        self.assertIn('problem sets', names)
        self.assertIn('midterm exam', names)
        self.assertEqual(extract_syllabus_participation_grade(text), 5)

    def test_assignment_due_dates(self):
        text = "Problem Set 1 due March 15, 2025\nHomework 2 deadline 2/14/2025"
        rows = extract_syllabus_assignment_dues(text)
        self.assertEqual(len(rows), 2)
        self.assertIn('problem set 1', rows[0]['name'].casefold())

    def test_exam_rows_with_grade_and_date(self):
        text = "Midterm Exam: March 10, 2025 (25%)\nFinal Exam — May 8, 2026 — 35%"
        rows = extract_syllabus_exam_rows(text)
        by_name = {row['name']: row for row in rows}
        self.assertIn('Midterm', by_name)
        self.assertEqual(by_name['Midterm']['gradepercentage'], 25)
        self.assertTrue(by_name['Midterm']['startdate'])

    def test_bundle_merges_assignments(self):
        text = (
            "Problem Set 1 10%\n"
            "Problem Set 1 due March 15, 2025\n"
            "Week 1: Introduction\n"
            "Week 2: Cells"
        )
        bundle = extract_syllabus_heuristic_bundle(
            text=text,
            pages=[{'text': text, 'blocks': []}],
        )
        self.assertEqual(len(bundle['assignments']), 1)
        self.assertEqual(bundle['assignments'][0]['gradepercentage'], 10)
        self.assertTrue(bundle['assignments'][0]['duedate'])
        self.assertEqual(len(bundle['weeks']), 2)
        store = build_syllabus_type_extractions(bundle)
        self.assertIn('weeks', store.get('syllabus', {}))
        self.assertIn('grades', store.get('syllabus', {}))


if __name__ == '__main__':
    unittest.main()
