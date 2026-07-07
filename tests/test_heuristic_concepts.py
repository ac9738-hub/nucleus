#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.heuristic_concepts import (  # noqa: E402
    deterministic_preseed_enabled,
    extract_heuristic_concept_titles,
    extract_syllabus_week_rows,
    titles_from_block_text,
    titles_from_filename,
)
from canvas_parser.parse.heuristic_guardrails import (  # noqa: E402
    filter_heuristic_titles,
    is_acceptable_heuristic_title,
    title_rejection_reason,
)


class HeuristicConceptTests(unittest.TestCase):
    def test_numbered_outline_block(self):
        titles = [t for t, _ in titles_from_block_text('6 1 The Dome')]
        self.assertIn('6 1 the dome', titles)

    def test_art_lecture_title(self):
        titles = [t for t, _ in titles_from_block_text('ART 102 6.1: Brunelleschi s Dome')]
        joined = ' '.join(titles).casefold()
        self.assertIn('6 1', joined)

    def test_week_filename_shell(self):
        titles = titles_from_filename('Week 4 Worksheets.pdf')
        self.assertIn('week 4 worksheets', titles)

    def test_syllabus_week_rows(self):
        pages = [{'text': 'Week 3: Proportions\nWeek 4: Design', 'blocks': []}]
        rows = extract_syllabus_week_rows(pages)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['title'], 'week 3 proportions')

    def test_mat_page_section(self):
        titles = [t for t, _ in titles_from_block_text('6 linear dynamical systemspage 265')]
        joined = ' '.join(titles).casefold()
        self.assertIn('6 linear dynamical systems', joined)

    def test_chapter_heading_extraction(self):
        pages = [{
            'blocks': [{'text': 'Chapter 2 Policing Strangers and Borderlands'}],
            'pageNumber': 1,
        }]
        titles = extract_heuristic_concept_titles(
            filename='reading.pdf',
            pages=pages,
            file_type='humanities_reading',
        )
        joined = ' '.join(titles).casefold()
        self.assertIn('chapter 2', joined)
        self.assertIn('policing', joined)


class HeuristicGuardrailTests(unittest.TestCase):
    def test_rejects_sentence_fragments(self):
        self.assertEqual(title_rejection_reason('and detected by pet machine'), 'sentence_fragment')

    def test_rejects_boilerplate(self):
        self.assertEqual(title_rejection_reason('click here for office hours'), 'boilerplate')

    def test_per_file_cap(self):
        candidates = [(f'topic {index}', 'numbered_outline') for index in range(200)]
        accepted, stats = filter_heuristic_titles(candidates, max_count=10)
        self.assertEqual(len(accepted), 10)
        self.assertEqual(stats['capped'], 1)

    def test_long_prose_not_extracted(self):
        titles = extract_heuristic_concept_titles(
            filename='slide.pdf',
            pages=[{'blocks': [{'text': 'and detected by pet machine'}], 'pageNumber': 1}],
            file_type='lecture_slides',
        )
        self.assertEqual(titles, [])

    def test_high_confidence_passes(self):
        self.assertTrue(
            is_acceptable_heuristic_title('6 1 the dome', source='numbered_outline')
        )


class DeterministicPreseedGateTests(unittest.TestCase):
    def test_disabled_without_heuristic_only_mode(self):
        import os
        from canvas_parser.parse import heuristic_concepts as hc

        old_preseed = os.environ.get('PARSER_HEURISTIC_CONCEPTS')
        old_only = os.environ.get('PARSER_HEURISTIC_ONLY')
        try:
            os.environ['PARSER_HEURISTIC_CONCEPTS'] = '1'
            os.environ.pop('PARSER_HEURISTIC_ONLY', None)
            self.assertFalse(hc.deterministic_preseed_enabled())
            os.environ['PARSER_HEURISTIC_ONLY'] = '1'
            self.assertTrue(hc.deterministic_preseed_enabled())
        finally:
            if old_preseed is None:
                os.environ.pop('PARSER_HEURISTIC_CONCEPTS', None)
            else:
                os.environ['PARSER_HEURISTIC_CONCEPTS'] = old_preseed
            if old_only is None:
                os.environ.pop('PARSER_HEURISTIC_ONLY', None)
            else:
                os.environ['PARSER_HEURISTIC_ONLY'] = old_only


if __name__ == '__main__':
    unittest.main()
