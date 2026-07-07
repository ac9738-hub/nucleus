#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_health import graph_health_snapshot, validate_graph_checkpoint  # noqa: E402


class ParseHealthTests(unittest.TestCase):
    def test_health_snapshot(self):
        state = {
            'concepts': [{'name': 'a', 'heuristicSource': True}, {'name': 'b'}],
            'files': {
                '1': {
                    'f1': {'pages': [{}]},
                    'f2': {},
                },
            },
        }
        snap = graph_health_snapshot(state)
        self.assertEqual(snap['conceptCount'], 2)
        self.assertEqual(snap['heuristicConceptCount'], 1)
        self.assertEqual(snap['parsedFiles'], 1)

    def test_validate_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'graph.json'
            path.write_text(json.dumps({'concepts': [{'name': 'x'}], 'files': {}}), encoding='utf-8')
            snap = validate_graph_checkpoint(path)
            self.assertEqual(snap['conceptCount'], 1)


if __name__ == '__main__':
    unittest.main()
