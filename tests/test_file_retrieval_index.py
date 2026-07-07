#!/usr/bin/env python3
"""Tests for graph-side retrieval indexing."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.file_retrieval_index import (  # noqa: E402
    enrich_graph_retrieval,
    index_file_node_for_retrieval,
    merge_missing_courses_from_backup,
    merge_searchtext_with_type_extractions,
)


class FileRetrievalIndexTests(unittest.TestCase):
    def test_merge_searchtext_with_type_extractions(self):
        file_node = {
            'searchtext': 'Lecture notes on entropy.',
            'academicFileType': 'lecture_slides',
            'typeExtractions': {
                'lecture': {
                    'slides': [{
                        'slideOrder': 5,
                        'title': 'Entropy',
                        'summary': 'Second law of thermodynamics',
                        'pageid': 'p1',
                    }],
                },
            },
        }
        self.assertTrue(merge_searchtext_with_type_extractions(file_node))
        self.assertIn('Entropy', file_node['searchtext'])
        self.assertIn('lecture_slides', file_node['searchtext'])

    def test_index_file_node_persists_type_extraction_edges(self):
        graph = {'concepts': [], 'problems': [], 'logged_details': {}, 'logged_examples': {}, 'logged_problems': {}}
        file_node = {
            'name': 'Lecture 5.pdf',
            'pages': [{
                'pageid': 'p1',
                'pageNumber': 1,
                'blocks': [{'text': 'Second law of thermodynamics', 'yRatio0': 0.0, 'yRatio1': 0.2}],
            }],
            'typeExtractions': {
                'lecture': {
                    'slides': [{
                        'slideOrder': 1,
                        'title': 'Entropy',
                        'summary': 'Second law',
                        'pageid': 'p1',
                    }],
                },
            },
        }
        result = index_file_node_for_retrieval(
            file_node,
            courseid='101',
            fileid='55',
            graph=graph,
        )
        self.assertTrue(result['indexed'])
        self.assertGreaterEqual(result['withTypeExtraction'], 1)
        type_edges = [
            edge for edge in file_node['textChunks'][0]['edges']
            if edge.get('type') == 'type-extraction'
        ]
        self.assertEqual(len(type_edges), 1)

    def test_merge_missing_courses_from_backup(self):
        graph = {'syllabi': {'101': {'courseid': '101'}}, 'files': {}, 'concepts': []}
        backup = {
            'syllabi': {'101': {'courseid': '101'}, '202': {'courseid': '202'}},
            'files': {'202': {'999': {'fileid': '999', 'name': 'Syllabus.pdf'}}},
            'concepts': [{'courseid': '202', 'name': 'Demo', 'conceptid': 'demo'}],
            'problems': [],
            'events': [],
            'logged_details': {},
            'logged_examples': {},
            'logged_problems': {},
            'logged_assignments': {},
            'logged_events': {},
        }
        merged = merge_missing_courses_from_backup(graph, backup)
        self.assertIn('202', merged)
        self.assertIn('202', graph['files'])

    def test_enrich_graph_retrieval(self):
        graph = {
            'files': {
                '101': {
                    '55': {
                        'name': 'Lecture.pdf',
                        'pages': [{
                            'pageid': 'p1',
                            'pageNumber': 1,
                            'blocks': [{'text': 'Matrix products', 'yRatio0': 0.0, 'yRatio1': 0.2}],
                        }],
                        'typeExtractions': {},
                    },
                },
            },
            'concepts': [],
            'problems': [],
            'logged_details': {},
            'logged_examples': {},
            'logged_problems': {},
        }
        stats = enrich_graph_retrieval(graph)
        self.assertEqual(stats['filesIndexed'], 1)
        self.assertGreaterEqual(stats['chunksWritten'], 1)


if __name__ == '__main__':
    unittest.main()
