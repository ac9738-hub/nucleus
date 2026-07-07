#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.humanities_promote import (  # noqa: E402
    promote_humanities_key_term_concepts_dict,
    _reading_filename_titles,
)
from canvas_parser.graph.lecture_slide_promote import (  # noqa: E402
    _bulk_stem_recall_names,
    _bulk_stem_slide_names,
    _numbered_heading_titles,
    promote_bulk_stem_recall_boost_dict,
    promote_numbered_slide_heading_concepts_dict,
)


class Iter10PromoteTests(unittest.TestCase):
    def test_numbered_heading_from_colon_slide(self):
        titles = _numbered_heading_titles('1: THE TOOLS OF THE ARCHITECT')
        self.assertIn('1 the tools of the architect', titles)
        self.assertIn('the tools of the architect', titles)

    def test_numbered_heading_from_art102_section(self):
        titles = _numbered_heading_titles('ART 102 11.1: Gardens')
        self.assertEqual(titles, ['11 1 gardens'])

    def test_reading_filename_titles(self):
        titles = _reading_filename_titles('Shah, Stranger Intimacy, Chapter 2 .pdf')
        self.assertIn('Stranger Intimacy, Chapter 2', titles)
        self.assertTrue(any(title.startswith('chapter 2') for title in titles))

    def test_bulk_stem_slide_names(self):
        names = _bulk_stem_slide_names('Balanced Equation - Fructose Combustion')
        self.assertIn('Balanced Equation', names)

    def test_bulk_stem_recall_names(self):
        names = _bulk_stem_recall_names('Balanced Equation - Fructose Combustion')
        self.assertIn('Balanced Equation', names)
        self.assertNotIn('Balanced Equation - Fructose Combustion', names)
        self.assertEqual(_bulk_stem_recall_names('Germanium (Ge)'), ['Germanium (Ge)'])

    def test_promote_bulk_stem_recall_boost(self):
        state = {
            'concepts': [],
            'files': {
                '15160': {
                    **{
                        f'lecture-{index}': {
                            'parserFileType': 'lecture_slides',
                            'name': f'Lecture {index}.pdf',
                            'typeExtractions': {'lecture': {'slides': []}},
                        }
                        for index in range(20)
                    },
                    'lecture-1': {
                        'parserFileType': 'lecture_slides',
                        'name': 'Thermo.pdf',
                        'typeExtractions': {
                            'lecture': {
                                'slides': [
                                    {
                                        'slideOrder': 1,
                                        'title': 'Balanced Equation - Fructose Combustion',
                                        'summary': '',
                                    },
                                    {
                                        'slideOrder': 2,
                                        'title': 'Germanium (Ge)',
                                        'summary': '',
                                    },
                                ],
                            },
                        },
                    },
                    **{f'extra-{index}': {'name': f'file{index}.pdf'} for index in range(41)},
                },
            },
        }
        promoted = promote_bulk_stem_recall_boost_dict(state)
        self.assertGreaterEqual(promoted, 2)
        names = {concept['name'] for concept in state['concepts']}
        self.assertIn('Balanced Equation', names)
        self.assertIn('Germanium (Ge)', names)

    def test_promote_humanities_key_terms(self):
        state = {
            'concepts': [],
            'files': {
                '19971': {
                    '401': {
                        'name': 'Essay.pdf',
                        'parserFileType': 'humanities_reading',
                        'typeExtractions': {
                            'humanities': {
                                'key_terms': [
                                    {'term': 'coercive assimilation', 'definition': 'Forced cultural adoption.'},
                                ],
                            },
                        },
                    },
                },
            },
        }
        promoted = promote_humanities_key_term_concepts_dict(state)
        self.assertEqual(promoted, 2)
        names = {concept['name'] for concept in state['concepts']}
        self.assertIn('coercive assimilation', names)

    def test_promote_humanities_argument_colon_clause(self):
        state = {
            'concepts': [],
            'files': {
                '19971': {
                    '401': {
                        'name': 'Tsing.pdf',
                        'parserFileType': 'humanities_reading',
                        'typeExtractions': {
                            'humanities': {
                                'arguments': [
                                    {
                                        'argument': (
                                            'Two kinds of Asian Americans: coercive assimilation '
                                            'vs. neoliberal multiculturalism'
                                        ),
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        }
        promoted = promote_humanities_key_term_concepts_dict(state)
        self.assertGreaterEqual(promoted, 1)
        names = {concept['name'] for concept in state['concepts']}
        self.assertIn('coercive assimilation', names)


if __name__ == '__main__':
    unittest.main()
