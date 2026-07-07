import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from canvas_parser.index_on_read import (
    count_page_blocks,
    file_node_has_blocks,
    is_indexable_file,
    patch_graph_file_node,
)


class IndexOnReadTests(unittest.TestCase):
    def test_is_indexable_file_accepts_pdf_and_images(self):
        self.assertTrue(is_indexable_file('Lecture 1.pdf', 'application/pdf'))
        self.assertTrue(is_indexable_file('diagram.png', 'image/png'))
        self.assertFalse(is_indexable_file('archive.zip', 'application/zip'))

    def test_file_node_has_blocks(self):
        self.assertFalse(file_node_has_blocks({'pages': []}))
        self.assertTrue(file_node_has_blocks({
            'pages': [{'blocks': [{'text': 'hello', 'yRatio0': 0.0, 'yRatio1': 0.1}]}]
        }))

    def test_patch_graph_file_node_merges_pages(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            graph_path = Path(tmpdir) / 'canvas_graph.json'
            graph_path.write_text(json.dumps({
                'graph_version': 3,
                'files': {
                    '101': {
                        '55': {
                            'fileid': '55',
                            'courseid': '101',
                            'name': 'Syllabus.pdf',
                            'pages': [{'pageid': '55:page:1', 'pageNumber': 1, 'text': 'old'}]
                        }
                    }
                }
            }), encoding='utf-8')

            pages = [{
                'pageid': '55:page:1',
                'pageNumber': 1,
                'text': 'updated',
                'blocks': [{'text': 'updated block', 'yRatio0': 0.0, 'yRatio1': 0.2}],
            }]
            with mock.patch('parser.atomic_write_json', side_effect=lambda path, data: graph_path.write_text(
                json.dumps(data), encoding='utf-8'
            )):
                node = patch_graph_file_node(graph_path, '101', '55', pages, {'name': 'Syllabus.pdf'})

            self.assertTrue(file_node_has_blocks(node))
            self.assertEqual(count_page_blocks(node['pages']), 1)
            saved = json.loads(graph_path.read_text(encoding='utf-8'))
            saved_node = saved['files']['101']['55']
            self.assertEqual(saved_node['name'], 'Syllabus.pdf')
            self.assertTrue(file_node_has_blocks(saved_node))


if __name__ == '__main__':
    unittest.main()
