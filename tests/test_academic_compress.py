#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.academic_compress import normalize_academic_prompt  # noqa: E402
from canvas_parser.parse.fast_path import pass1_max_prompt_chars, pass1_max_prompt_tokens  # noqa: E402


class AcademicCompressTests(unittest.TestCase):
    def test_removes_page_numbers_and_copyright(self):
        prompt = '\n'.join([
            '[[PAGE 1 | pageid=p1 | yScroll=0 | yScrollRatio=0]]',
            'CHM 201 General Chemistry',
            '12',
            '© 2024 Pearson Education. All rights reserved.',
            'The midterm exam is worth 30% of the final grade on March 12, 2026.',
        ])
        output, stats = normalize_academic_prompt(prompt)
        self.assertTrue(stats['normalized'])
        self.assertNotIn('All rights reserved', output)
        self.assertIn('midterm exam', output.casefold())
        self.assertIn('30%', output)

    def test_removes_repeated_header_footer(self):
        header = 'Fundamentals of Neuroscience | Princeton University'
        pages = []
        for page_num in range(1, 6):
            pages.extend([
                f'[[PAGE {page_num} | pageid=p{page_num} | yScroll=0 | yScrollRatio=0]]',
                header,
                f'Lecture topic content for page {page_num} with neurons and synapses.',
                str(page_num),
            ])
        output, stats = normalize_academic_prompt('\n\n'.join(pages))
        self.assertTrue(stats['normalized'])
        self.assertNotIn(header, output)
        self.assertIn('neurons', output.casefold())

    def test_strips_bibliography_but_keeps_reading_list(self):
        paper = '\n\n'.join([
            '[[PAGE 1 | pageid=p1 | yScroll=0 | yScrollRatio=0]]',
            'Main argument about cognitive load and working memory.',
            '[[PAGE 2 | pageid=p2 | yScroll=0 | yScrollRatio=0]]',
            'References',
            'Smith J et al. (2019). Neural evidence. doi:10.1000/example pp. 12-18.',
            'Jones A et al. (2021). Another study. vol. 4 pp. 90-95.',
        ])
        output, stats = normalize_academic_prompt(paper)
        self.assertTrue(stats['bibliography_stripped'])
        self.assertNotIn('doi:10.1000/example', output)
        self.assertIn('working memory', output.casefold())

        syllabus = '\n\n'.join([
            '[[PAGE 1 | pageid=p1 | yScroll=0 | yScrollRatio=0]]',
            'References',
            'Week 2 reading: Chapter 4 assignment due Friday.',
            'Required text for the course.',
        ])
        syllabus_out, syllabus_stats = normalize_academic_prompt(syllabus)
        self.assertFalse(syllabus_stats['bibliography_stripped'])
        self.assertIn('Chapter 4', syllabus_out)

    def test_pass1_token_cap_defaults_to_200k(self):
        self.assertEqual(pass1_max_prompt_tokens(), 200_000)
        self.assertEqual(pass1_max_prompt_chars(), 800_000)


if __name__ == '__main__':
    unittest.main()
