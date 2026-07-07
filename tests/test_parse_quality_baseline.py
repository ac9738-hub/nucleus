#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.pdf_cache import (  # noqa: E402
    load_cached_pdf_pages,
    store_cached_pdf_pages,
)


class PdfCacheTests(unittest.TestCase):
    def test_store_and_load_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf = root / 'sample.pdf'
            pdf.write_bytes(b'%PDF-1.4 sample')
            pages = [{'pageid': 'sample.pdf:page:1', 'pageNumber': 1, 'text': 'hello'}]
            store_cached_pdf_pages(pdf, 'sample.pdf', pages, root=root)
            loaded = load_cached_pdf_pages(pdf, 'sample.pdf', root=root)
            self.assertEqual(loaded, pages)

    def test_cache_miss_after_file_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf = root / 'sample.pdf'
            pdf.write_bytes(b'%PDF-1.4 v1')
            pages = [{'pageid': 'sample.pdf:page:1', 'pageNumber': 1, 'text': 'v1'}]
            store_cached_pdf_pages(pdf, 'sample.pdf', pages, root=root)
            pdf.write_bytes(b'%PDF-1.4 v2 longer content')
            self.assertIsNone(load_cached_pdf_pages(pdf, 'sample.pdf', root=root))


class ParseQualityBaselineTests(unittest.TestCase):
    def test_build_manifest_from_minimal_graph(self):
        from scripts.build_parse_quality_baseline import build_manifest

        graph = {
            'concepts': [
                {'courseid': '18857', 'name': 'Gothic Architecture', 'details': [{'name': 'Arch'}]},
            ],
            'events': [
                {'courseid': '18857', 'name': 'Midterm', 'type': 'test', 'startdate': '2025-10-10'},
            ],
            'problems': [],
            'files': {'18857': {'1': {'fileid': '1', 'pages': [{'text': 'x'}]}}},
        }
        manifest = build_manifest(
            graph,
            course_ids=['18857'],
            source_graph=Path('canvas_graph.json'),
            include_subgraphs=False,
        )
        self.assertEqual(manifest['courseIds'], ['18857'])
        self.assertEqual(manifest['courses'][0]['metrics']['concepts'], 1)
        self.assertIn('gothic architecture', manifest['courses'][0]['conceptTitles'])


def test_quality_gt_baseline_self_eval_passes():
    from scripts.eval_parse_quality import eval_against_manifest, load_manifest

    manifest_path = ROOT / 'fixtures' / 'parse_quality' / 'benchmark_baseline.json'
    quality_path = ROOT / '.cache' / 'graph_eval' / 'quality_3course.json'
    if not manifest_path.is_file() or not quality_path.is_file():
        return
    manifest = load_manifest(manifest_path)
    graph = json.loads(quality_path.read_text(encoding='utf-8'))
    report = eval_against_manifest(graph, manifest)
    assert report['passed'] is True


if __name__ == '__main__':
    unittest.main()
