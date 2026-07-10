#!/usr/bin/env python3
"""Tests for Canvas file ingestion gaps (chunks, extractors, parser batches)."""
import sys
import unittest
import unittest.mock
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.extractors import (  # noqa: E402
    detect_extractor,
    resolve_extractor_kind,
    sniff_extractor_from_path,
)
from canvas_parser.content.links import extract_canvas_file_id_from_url  # noqa: E402
from canvas_parser.weekly_iteration.llm_parse import (  # noqa: E402
    _is_parseable_file,
    _synthesize_module_only_files,
    build_parser_batches,
    normalize_canvas_file_download_url,
)
from parser import (  # noqa: E402
    enqueue_linked_canvas_file_id,
    fileNode,
    infer_canvas_file_download_url,
    pending_linked_canvas_files,
    persist_file_node_text_chunks,
    summarize_file_chunks_for_embedding,
)
from scripts.build_harvard_snapshots_from_canvas_data import build_snapshot  # noqa: E402


class FileIngestionTests(unittest.TestCase):
    def test_detect_extractor_accepts_csv_and_code(self):
        self.assertEqual(detect_extractor('', 'grades.csv'), 'text')
        self.assertEqual(detect_extractor('', 'class14.m'), 'text')
        self.assertEqual(detect_extractor('', 'plot.py'), 'text')
        self.assertEqual(detect_extractor('', 'budget.xlsx'), 'xlsx')

    def test_sniff_extractor_from_canvas_download_name(self):
        pdf_path = ROOT / 'canvasfiles' / '3229520'
        if not pdf_path.is_file():
            self.skipTest('cached CHM201 lecture PDF missing')
        self.assertEqual(sniff_extractor_from_path(pdf_path), 'pdf')
        self.assertEqual(resolve_extractor_kind('', 'Download Lecture Slides', path=pdf_path), 'pdf')

    def test_extract_canvas_file_id_from_url(self):
        self.assertEqual(
            extract_canvas_file_id_from_url('https://canvas.example.edu/courses/1/files/55/download'),
            '55',
        )
        self.assertEqual(
            extract_canvas_file_id_from_url('https://canvas.example.edu/courses/1/files?preview=77'),
            '77',
        )

    def test_enqueue_linked_canvas_file_id_tracks_pending(self):
        pending_linked_canvas_files.clear()
        enqueue_linked_canvas_file_id('101', '999', name='Week 1.pdf')
        self.assertIn('999', pending_linked_canvas_files.get('101', {}))

    def test_infer_canvas_file_download_url_uses_env(self):
        with unittest.mock.patch.dict('os.environ', {'CANVAS_BASE_URL': 'https://canvas.example.edu'}):
            url = infer_canvas_file_download_url('101', '55')
        self.assertEqual(url, 'https://canvas.example.edu/courses/101/files/55/download')

    def test_normalize_canvas_file_download_url_preserves_canvas_api_url(self):
        raw = 'https://princeton.instructure.com/files/3555446/download?download_frd=1'
        url = normalize_canvas_file_download_url(
            'https://princeton.instructure.com',
            '17581',
            '3555446',
            raw,
        )
        self.assertEqual(url, raw)

    def test_normalize_canvas_file_download_url_synthesizes_with_download_frd(self):
        url = normalize_canvas_file_download_url(
            'https://princeton.instructure.com',
            '17581',
            '3555446',
            '',
        )
        self.assertEqual(
            url,
            'https://princeton.instructure.com/courses/17581/files/3555446/download?download_frd=1',
        )

    def test_normalize_canvas_file_download_url_keeps_course_scoped(self):
        raw = 'https://canvas.example.edu/courses/101/files/55/download?download_frd=1'
        url = normalize_canvas_file_download_url('https://canvas.example.edu', '101', '55', raw)
        self.assertEqual(url, raw)

    def test_build_parser_batches_preserves_canvas_api_file_urls(self):
        snapshot = {
            'course': {'id': '17581', 'name': 'Demo'},
            'assignments': [],
            'files': [{
                'id': '3555446',
                'display_name': 'Lecture.pdf',
                'content-type': 'application/pdf',
                'url': 'https://princeton.instructure.com/files/3555446/download?download_frd=1',
            }],
            'modules': [],
            'module_items': {},
            'page_bodies': {},
            'pages': [],
        }
        batches = build_parser_batches(snapshot, 'https://princeton.instructure.com')
        file_batch = next(batch for batch in batches if batch.get('type') == 'file')
        item = file_batch['content'][0]
        self.assertEqual(
            item['url'],
            'https://princeton.instructure.com/files/3555446/download?download_frd=1',
        )

    def test_summarize_file_chunks_for_embedding(self):
        node = fileNode('55', '101', 'Lecture.pdf', '', '')
        node.textChunks = [
            {'text': 'Matrix products combine rows and columns.'},
            {'text': 'Example: multiply two 2x2 matrices.'},
        ]
        summary = summarize_file_chunks_for_embedding(node)
        self.assertIn('Matrix products', summary)
        self.assertIn('Example', summary)

    def test_persist_file_node_text_chunks_on_parser_node(self):
        node = fileNode('55', '101', 'Lecture.pdf', '', '')
        node.pages = [{
            'pageid': '55:page:1',
            'pageNumber': 1,
            'blocks': [{'text': 'Matrix Products', 'yRatio0': 0.0, 'yRatio1': 0.1}],
        }]
        persist_file_node_text_chunks(node)
        self.assertGreaterEqual(len(node.textChunks), 1)
        self.assertTrue(node.textChunks[0].get('chunkId'))

    def test_synthesize_module_only_files(self):
        files = _synthesize_module_only_files([], {
            '10': [{
                'type': 'File',
                'content_id': '999',
                'title': 'Week 1 Slides.pdf',
            }],
        })
        self.assertEqual(len(files), 1)
        self.assertEqual(str(files[0]['id']), '999')

    def test_build_parser_batches_skips_non_parseable_and_adds_module_files(self):
        snapshot = {
            'course': {'id': '101', 'name': 'Demo'},
            'assignments': [],
            'files': [{'id': '1', 'display_name': 'photo.png', 'content-type': 'image/png'}],
            'modules': [{'id': '10', 'name': 'Week 1'}],
            'module_items': {
                '10': [{
                    'type': 'file',
                    'content_id': '55',
                    'title': 'Syllabus.pdf',
                }],
            },
            'page_bodies': {},
            'pages': [],
        }
        batches = build_parser_batches(snapshot, 'https://canvas.example.edu')
        file_batch = next(batch for batch in batches if batch.get('type') == 'file')
        file_ids = {str(item['id']) for item in file_batch['content']}
        self.assertIn('55', file_ids)
        self.assertIn('1', file_ids)

    def test_canvas_data_snapshot_preserves_explicit_syllabus_and_gradescope(self):
        data = {
            'courses': [{'id': 101, 'name': 'Demo'}],
            'assignments': {'101': []},
            'files': {'101': []},
            'modules': {'101': []},
            'module_items': {'101': {}},
            'pages': {'101': []},
            'syllabi': {
                '101': {
                    'name': 'Demo',
                    'html_url': 'https://canvas.example.edu/courses/101/assignments/syllabus',
                    'syllabus_text': 'Final exam: May 8.',
                },
            },
            'gradescope': {
                'mappings': [{
                    'courseId': '101',
                    'canvasAssignmentId': '77',
                    'canvasAssignmentName': 'Problem Set 1',
                    'gradescopeAssignmentId': 'gs-77',
                    'gradescopeUrl': 'https://www.gradescope.com/courses/1/assignments/77',
                    'gradescopeAssignmentTitle': 'PS1',
                    'submissionStatus': 'submitted',
                    'dueText': 'Jan 30',
                }],
            },
        }

        snapshot = build_snapshot(data, 101)
        batches = build_parser_batches(snapshot, 'https://canvas.example.edu')

        syllabus_batch = next(batch for batch in batches if batch.get('type') == 'syllabus')
        syllabus_payload = json.loads(syllabus_batch['content'][0]['content'])
        self.assertEqual(syllabus_payload['syllabus'], 'Final exam: May 8.')

        external_batch = next(batch for batch in batches if batch.get('type') == 'external_submission')
        external_item = external_batch['content'][0]
        external_payload = json.loads(external_item['content'])
        self.assertEqual(external_item['id'], 'gradescope-101-77')
        self.assertEqual(external_payload['submissionStatus'], 'submitted')


if __name__ == '__main__':
    unittest.main()
