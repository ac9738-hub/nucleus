#!/usr/bin/env python3
"""Tests for chunk ↔ teaching-unit ↔ graph-node edges."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.chunk_graph import (  # noqa: E402
    attach_teaching_from_weekly_edges,
    attach_weekly_edges,
    build_file_chunk_graph,
    persist_text_chunks_on_file_node,
    select_chunks_for_query,
    summarize_chunk_graph,
    _apply_filename_teaching_fallback,
)
from canvas_parser.content.text_chunks import (  # noqa: E402
    format_retrieval_chunks_for_grounding,
    parse_retrieval_cite_labels,
)


class ChunkGraphTests(unittest.TestCase):
    def test_attach_teaching_from_weekly_edges(self):
        chunks = [{
            'text': 'Body text',
            'edges': [{
                'type': 'weekly-item',
                'weekLabel': 'Week 3',
                'weekStart': '2025-09-15',
                'itemType': 'file',
                'name': 'Lecture 3_electrical properties.pdf',
            }],
        }]
        updated = attach_teaching_from_weekly_edges(chunks)
        self.assertTrue(any(
            edge.get('type') == 'teaching-unit' and edge.get('name') == 'Lecture 3'
            for edge in updated[0]['edges']
        ))

    def test_apply_filename_teaching_fallback(self):
        chunks = [{'text': 'Some body text without headings.', 'edges': []}]
        updated = _apply_filename_teaching_fallback(
            chunks,
            'Lecture 3_electrical properties I Nernst_slides.pdf',
            graph_nodes=[],
        )
        self.assertTrue(
            any(
                edge.get('type') == 'teaching-unit' and edge.get('name') == 'Lecture 3'
                for edge in updated[0]['edges']
            )
        )

    def test_build_file_chunk_graph_links_teaching_unit(self):
        pages = [{
            "pageid": "f1:page:1",
            "pageNumber": 1,
            "blocks": [
                {"text": "2.3 Matrix Products"},
                {"text": "Example 3: A system without solutions"},
            ],
        }]
        chunks = build_file_chunk_graph(pages, courseid="demo", fileid="1001")
        self.assertGreaterEqual(len(chunks), 2)
        linked = [
            chunk for chunk in chunks
            if any(edge.get("type") == "teaching-unit" for edge in chunk.get("edges", []))
        ]
        self.assertGreaterEqual(len(linked), 1)

    def test_persist_text_chunks_on_file_node(self):
        file_node = {"fileid": "1001", "pages": []}
        persist_text_chunks_on_file_node(file_node, [{
            "chunkId": "file:demo/1001/p1/b0",
            "text": "Matrix Products",
            "citeLabel": "C1",
            "source": {},
            "edges": [],
        }])
        self.assertEqual(len(file_node["textChunks"]), 1)

    def test_select_chunks_for_query_and_retrieval_labels(self):
        chunks = [
            {"chunkId": "a", "text": "Grading policy details", "edges": []},
            {"chunkId": "b", "text": "Unrelated topic", "edges": []},
        ]
        selected = select_chunks_for_query(chunks, query="grading policy", max_chunks=2)
        self.assertEqual(selected[0]["text"], "Grading policy details")
        prompt = format_retrieval_chunks_for_grounding(selected)
        self.assertIn("[R1]", prompt)
        self.assertEqual(parse_retrieval_cite_labels("Policy says [R1]."), ["R1"])

    def test_select_chunks_for_query_uses_semantic_embeddings(self):
        chunks = [
            {
                "chunkId": "a",
                "text": "Unrelated topic",
                "embedded": {"text": [1.0, 0.0, 0.0]},
                "edges": [],
            },
            {
                "chunkId": "b",
                "text": "Matrix multiplication properties",
                "embedded": {"text": [0.0, 1.0, 0.0]},
                "edges": [],
            },
        ]
        selected = select_chunks_for_query(
            chunks,
            query="matrix multiplication",
            max_chunks=1,
            query_embedding=[0.0, 1.0, 0.0],
        )
        self.assertEqual(selected[0]["chunkId"], "b")

    def test_infer_teaching_edges_from_graph_nodes(self):
        from canvas_parser.content.chunk_graph import infer_teaching_edges_from_graph_nodes

        page = {'pageid': 'p1', 'pageNumber': 1}
        block = {'text': 'Matrix Products'}
        nodes = [('detail', 'demo:Matrix Products', 'Matrix Products')]
        unit, node_edges = infer_teaching_edges_from_graph_nodes(block, 0, page, nodes)
        self.assertIsNotNone(unit)
        self.assertEqual(len(node_edges), 1)

    def test_attach_graph_nodes_by_chunk_text(self):
        from canvas_parser.content.chunk_graph import attach_graph_nodes_by_chunk_text

        chunks = [{
            'chunkId': 'c1',
            'text': 'Matrix Products and multiplication properties',
            'edges': [],
        }]
        nodes = [('detail', 'demo:Matrix Products', 'Matrix Products')]
        enriched = attach_graph_nodes_by_chunk_text(chunks, nodes)
        graph_edges = [e for e in enriched[0]['edges'] if e.get('type') == 'graph-node']
        self.assertEqual(len(graph_edges), 1)

    def test_attach_weekly_edges_links_file_to_week(self):
        chunks = [{
            "chunkId": "file:demo/1001/p1/b0",
            "text": "Grading policy details",
            "edges": [],
        }]
        weekly = {
            "demo": [{
                "weekLabel": "Week 2",
                "weekStart": "2026-02-10T00:00:00.000Z",
                "files": [{"name": "Sample Syllabus.pdf"}],
                "assignments": [],
                "events": [],
            }],
        }
        enriched = attach_weekly_edges(chunks, weekly, "demo", filename="Sample Syllabus.pdf")
        weekly_edges = [
            edge for edge in enriched[0]["edges"]
            if edge.get("type") == "weekly-item"
        ]
        self.assertEqual(len(weekly_edges), 1)
        self.assertEqual(weekly_edges[0]["weekLabel"], "Week 2")

    def test_summarize_chunk_graph(self):
        summary = summarize_chunk_graph([
            {"edges": [{"type": "teaching-unit", "name": "Matrix Products"}]},
            {"edges": []},
        ])
        self.assertEqual(summary["withTeachingUnit"], 1)

    def test_chunks_from_file_node_rebuilds_weekly_edges_with_graph(self):
        from canvas_parser.content.chunk_graph import chunks_from_file_node

        file_node = {
            'fileid': '1001',
            'courseid': 'demo',
            'name': 'Sample Syllabus.pdf',
            'pages': [{
                'pageid': 'p1',
                'pageNumber': 1,
                'blocks': [{'text': 'Grading policy details'}],
            }],
            'textChunks': [{
                'chunkId': 'file:demo/1001/p1/b0',
                'text': 'Grading policy details',
                'source': {'pageid': 'p1', 'blockIndex': 0},
                'edges': [],
                'embedded': {'text': [0.1, 0.2]},
            }],
        }
        weekly = {
            'demo': [{
                'weekLabel': 'Week 2',
                'weekStart': '2026-02-10T00:00:00.000Z',
                'start_date': '2026-02-10',
                'files': [{'name': 'Sample Syllabus.pdf'}],
                'assignments': [],
                'events': [],
            }],
        }
        chunks = chunks_from_file_node(
            file_node,
            courseid='demo',
            fileid='1001',
            graph={'concepts': [], 'problems': [], 'logged_details': {}},
            weekly_schedule=weekly,
        )
        weekly_edges = [
            edge for edge in chunks[0]['edges']
            if edge.get('type') == 'weekly-item'
        ]
        self.assertEqual(len(weekly_edges), 1)
        self.assertEqual(chunks[0]['embedded'], {'text': [0.1, 0.2]})

    def test_attach_type_extraction_edges_in_chunks_from_file_node(self):
        from canvas_parser.content.chunk_graph import chunks_from_file_node

        file_node = {
            'fileid': '1001',
            'courseid': 'demo',
            'textChunks': [{
                'chunkId': 'file:demo/1001/p1/b0',
                'text': 'Second law of thermodynamics',
                'source': {'pageid': 'p1', 'blockIndex': 4},
                'edges': [],
            }],
            'typeExtractions': {
                'lecture': {
                    'slides': [{
                        'slideOrder': 5,
                        'title': 'Entropy',
                        'summary': 'Second law',
                        'pageid': 'p1',
                    }],
                },
            },
        }
        chunks = chunks_from_file_node(file_node, courseid='demo', fileid='1001')
        type_edges = [
            edge for edge in chunks[0]['edges']
            if edge.get('type') == 'type-extraction'
        ]
        self.assertEqual(len(type_edges), 1)
        selected = select_chunks_for_query(chunks, query='slide 5 entropy', max_chunks=1)
        self.assertEqual(selected[0]['chunkId'], 'file:demo/1001/p1/b0')

    def test_build_file_chunk_graph_persists_type_extraction_edges(self):
        pages = [{
            'pageid': 'p1',
            'pageNumber': 1,
            'blocks': [{'text': 'Second law of thermodynamics'}],
        }]
        chunks = build_file_chunk_graph(
            pages,
            courseid='demo',
            fileid='1001',
            type_extractions={
                'lecture': {
                    'slides': [{
                        'slideOrder': 1,
                        'title': 'Entropy',
                        'summary': 'Second law',
                        'pageid': 'p1',
                    }],
                },
            },
        )
        type_edges = [
            edge for edge in chunks[0]['edges']
            if edge.get('type') == 'type-extraction'
        ]
        self.assertEqual(len(type_edges), 1)


if __name__ == "__main__":
    unittest.main()
