#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from canvas_parser.graph.repair import (  # noqa: E402
    backfill_concept_sequence_edges,
    backfill_undated_test_events,
    prune_dangling_edges,
    rebuild_learning_block_next_edges,
    regenerate_learning_blocks,
)


class GraphRepairTests(unittest.TestCase):
    def test_backfill_learning_block_sequence_edges(self):
        from canvas_parser.graph.repair import backfill_learning_block_sequence_edges

        state = {
            'concepts': [
                {'conceptid': 'c1', 'courseid': '1'},
                {'conceptid': 'c2', 'courseid': '1'},
            ],
            'learningBlocks': {
                '1': [
                    {'blockId': 'b1', 'conceptId': 'c1', 'order': 1},
                    {'blockId': 'b2', 'conceptId': 'c2', 'order': 2},
                ],
            },
            'edges': [],
        }
        stats = backfill_learning_block_sequence_edges(state)
        self.assertEqual(stats['addedLearningBlockPrerequisite'], 1)
        self.assertTrue(any(
            edge.get('relation') == 'prerequisite'
            and edge.get('fromId') == 'c1'
            and edge.get('toId') == 'c2'
            for edge in state['edges']
        ))

    def test_backfill_undated_test_events(self):
        state = {
            'syllabi': {
                '18857': {
                    'assignments': [{
                        'name': 'Midterm take-home exam',
                        'duedate': '2025-10-10T21:00:00Z',
                    }],
                },
            },
            'events': [{
                'eventid': 'Midtermeventid',
                'courseid': '18857',
                'name': 'Midterm',
                'type': 'test',
                'startdate': '',
            }],
        }
        stats = backfill_undated_test_events(state)
        self.assertEqual(stats['updatedEventDates'], 1)
        self.assertEqual(state['events'][0]['startdate'], '2025-10-10T21:00:00Z')

    def test_backfill_learning_block_content(self):
        from canvas_parser.graph.repair import backfill_learning_block_content

        state = {
            'concepts': [{'conceptid': 'c1', 'courseid': '1', 'name': 'Entropy'}],
            'learningBlocks': {
                '1': [{'blockId': 'b1', 'conceptId': 'c1', 'explanation': ''}],
            },
        }
        stats = backfill_learning_block_content(state)
        self.assertEqual(stats['updatedBlockContent'], 1)
        self.assertEqual(state['learningBlocks']['1'][0]['explanation'], 'Entropy')

    def test_prune_dangling_edges(self):
        state = {
            'concepts': [{'conceptid': 'c1', 'courseid': '1'}],
            'learningBlocks': {'1': [{'blockId': 'b1', 'order': 1}, {'blockId': 'b2', 'order': 2}]},
            'edges': [
                {'fromType': 'learningBlock', 'fromId': 'missing', 'toType': 'learningBlock', 'toId': 'b2', 'relation': 'next'},
                {'fromType': 'concept', 'fromId': 'c1', 'toType': 'concept', 'toId': 'c1', 'relation': 'related'},
            ],
        }
        stats = prune_dangling_edges(state)
        self.assertEqual(stats['removed'], 1)
        self.assertEqual(len(state['edges']), 1)

    def test_backfill_document_order_from_source_pages(self):
        from canvas_parser.graph.repair import backfill_document_order_from_source_pages

        state = {
            'concepts': [{
                'courseid': '1',
                'conceptid': 'c1',
                'name': 'Lecture 2 Nernst',
                'sourcePages': [{'fileid': 'f1', 'pageNumber': 3, 'yScrollRatio': 0.2}],
            }],
        }
        stats = backfill_document_order_from_source_pages(state)
        self.assertEqual(stats['updatedDocumentOrder'], 1)
        order = state['concepts'][0]['documentOrder']
        self.assertEqual(order.get('fileId'), 'f1')
        self.assertEqual(float(order.get('pageNumber') or 0), 3.0)

    def test_backfill_concept_sequence_edges(self):
        state = {
            'concepts': [
                {
                    'courseid': '1',
                    'conceptid': 'c1',
                    'documentOrder': {'fileId': 'f1', 'pageNumber': 1, 'heading': {'sectionMajor': 1.0}},
                },
                {
                    'courseid': '1',
                    'conceptid': 'c2',
                    'documentOrder': {'fileId': 'f1', 'pageNumber': 2, 'heading': {'sectionMajor': 2.0}},
                },
            ],
            'edges': [],
        }
        stats = backfill_concept_sequence_edges(state)
        self.assertGreaterEqual(stats['addedPrerequisite'], 1)
        self.assertTrue(any(edge.get('relation') == 'prerequisite' for edge in state['edges']))

    def test_regenerate_learning_blocks(self):
        state = {
            'concepts': [
                {'courseid': '1', 'conceptid': 'c1', 'name': 'Alpha', 'details': [], 'examples': []},
                {'courseid': '1', 'conceptid': 'c2', 'name': 'Beta', 'details': [], 'examples': [], 'prerequisiteConceptIds': ['c1']},
            ],
            'problems': [],
            'moduleOrderHints': {'1': {'c1': [{'moduleId': 'm1', 'position': 0}], 'c2': [{'moduleId': 'm1', 'position': 1}]}},
            'edges': [],
        }
        stats = regenerate_learning_blocks(state)
        self.assertEqual(stats['courses'], 1)
        self.assertEqual(stats['blocks'], 2)
        self.assertEqual(len(state['learningBlocks']['1']), 2)

    def test_rebuild_learning_block_next_edges(self):
        state = {
            'learningBlocks': {
                '1': [
                    {'blockId': 'b1', 'order': 1},
                    {'blockId': 'b2', 'order': 2},
                ],
            },
            'edges': [
                {'fromType': 'learningBlock', 'fromId': 'stale', 'toType': 'learningBlock', 'toId': 'b2', 'relation': 'next'},
            ],
        }
        stats = rebuild_learning_block_next_edges(state)
        self.assertEqual(stats['addedNext'], 1)
        next_edges = [edge for edge in state['edges'] if edge.get('relation') == 'next']
        self.assertEqual(len(next_edges), 1)
        self.assertEqual(next_edges[0]['fromId'], 'b1')
        self.assertEqual(next_edges[0]['toId'], 'b2')


if __name__ == '__main__':
    unittest.main()
