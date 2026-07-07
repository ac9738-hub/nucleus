#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.type_extraction_retrieval import (  # noqa: E402
    attach_type_extraction_edges,
    type_extraction_query_boost,
    type_extraction_search_text,
    week_match_boost_from_type_extractions,
)


class TypeExtractionRetrievalTests(unittest.TestCase):
    class FakeNode:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    SAMPLE = {
        'syllabus': {
            'weeks': [{
                'weekNumber': 3,
                'topic': 'Thermodynamics',
                'readings': ['Chapter 4', 'Chapter 5'],
            }],
            'policies': [{
                'policyType': 'Grading',
                'text': 'Homework is 40 percent of the final grade.',
            }],
        },
        'lecture': {
            'slides': [
                {'slideOrder': 1, 'title': 'Intro', 'summary': 'Course overview', 'pageid': 'p1'},
                {'slideOrder': 5, 'title': 'Entropy', 'summary': 'Second law', 'pageid': 'p1'},
            ],
        },
    }

    def test_search_text_includes_week_and_slide_labels(self):
        text = type_extraction_search_text(self.SAMPLE)
        self.assertIn('Thermodynamics', text)
        self.assertIn('Entropy', text)
        self.assertIn('Chapter 4', text)

    def test_week_boost_from_type_extractions(self):
        boost = week_match_boost_from_type_extractions('week 3 readings', self.SAMPLE)
        self.assertGreater(boost, 0.0)

    def test_query_boost_for_slide_number(self):
        node = self.FakeNode(typeExtractions=self.SAMPLE, academicFileType='lecture_slides')
        boost = type_extraction_query_boost(
            'CHM 201 slide 5 entropy',
            'file',
            node,
            type_extractions=self.SAMPLE,
        )
        self.assertGreater(boost, 0.3)

    def test_query_boost_for_syllabus_policy(self):
        node = self.FakeNode(typeExtractions=self.SAMPLE)
        boost = type_extraction_query_boost(
            'grading policy',
            'syllabus',
            node,
            type_extractions=self.SAMPLE,
        )
        self.assertGreater(boost, 0.15)

    def test_attach_type_extraction_edges_by_pageid(self):
        chunks = [{
            'chunkId': 'a',
            'text': 'Entropy increases in isolated systems.',
            'source': {'pageid': 'p1', 'blockIndex': 1},
            'edges': [],
        }]
        enriched = attach_type_extraction_edges(chunks, self.SAMPLE)
        type_edges = [
            edge for edge in enriched[0]['edges']
            if edge.get('type') == 'type-extraction'
        ]
        self.assertGreaterEqual(len(type_edges), 1)
        labels = {edge.get('label') for edge in type_edges}
        self.assertIn('Entropy', labels)


if __name__ == '__main__':
    unittest.main()
