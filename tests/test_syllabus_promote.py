#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.merge import (  # noqa: E402
    _course_is_lecture_slides_heavy,
    cap_course_concept_budget,
    cap_concepts_per_source_file,
    build_file_type_resolver,
)
from canvas_parser.graph.lecture_week_promote import promote_stem_week_shell_concepts_dict  # noqa: E402
from canvas_parser.graph.syllabus_promote import promote_syllabus_week_concepts_dict  # noqa: E402


class ConceptStub:
    def __init__(self, name, conceptid, documentOrder=None):
        self.name = name
        self.conceptid = conceptid
        self.description = ''
        self.details = []
        self.examples = []
        self.problems = []
        self.documentOrder = documentOrder or {}


class SyllabusPromoteTests(unittest.TestCase):
    def test_promote_syllabus_week_concepts(self):
        state = {
            'concepts': [],
            'files': {
                '101': {
                    '201': {
                        'name': 'Syllabus.pdf',
                        'parserFileType': 'syllabus',
                        'typeExtractions': {
                            'syllabus': {
                                'weeks': [
                                    {'weekNumber': 2, 'topic': 'Nomenclature, Stoichiometry'},
                                ],
                            },
                        },
                    },
                },
            },
        }
        promoted = promote_syllabus_week_concepts_dict(state)
        self.assertEqual(promoted, 1)
        self.assertEqual(state['concepts'][0]['name'], 'week 2 nomenclature, stoichiometry')

    def test_lecture_slides_heavy_course_budget(self):
        course_files = {
            f'file-{index}': {'parserFileType': 'lecture_slides', 'name': f'Lecture {index}.pdf'}
            for index in range(12)
        }
        resolver = build_file_type_resolver(course_files)
        self.assertTrue(_course_is_lecture_slides_heavy(course_files, resolver))
        concepts = [
            ConceptStub(f'topic {slot}', f'file-{file_index}-{slot}', documentOrder={'fileId': f'file-{file_index}'})
            for file_index in range(12)
            for slot in range(12)
        ]
        cap_concepts_per_source_file(concepts, file_type_resolver=resolver)
        removed = cap_course_concept_budget(
            concepts,
            force_detail_sparse=True,
            file_type_resolver=resolver,
            course_files=course_files,
        )
        self.assertGreater(len(concepts), 60)
        self.assertGreaterEqual(removed, 0)

    def test_promote_stem_week_shell_concepts(self):
        lecture_files = {
            str(1000 + index): {
                'parserFileType': 'lecture_slides',
                'name': 'Download Lecture Slides',
            }
            for index in range(24)
        }
        filler_files = {
            f'page-{index}': {'parserFileType': 'generic_content', 'name': f'Page {index}'}
            for index in range(20)
        }
        course_files = {**lecture_files, **filler_files}
        state = {
            'concepts': [],
            'files': {'15160': course_files},
        }
        promoted = promote_stem_week_shell_concepts_dict(state)
        self.assertEqual(promoted, 36)
        titles = {concept['name'] for concept in state['concepts']}
        self.assertIn('week 1 lectures', titles)
        self.assertIn('week 12 lectures', titles)
        self.assertIn('week 3 worksheets', titles)
        self.assertIn('week 8 precept', titles)


if __name__ == '__main__':
    unittest.main()
