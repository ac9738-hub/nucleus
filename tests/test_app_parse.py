"""Tests for app_parse graph archival."""
from __future__ import annotations

import json
from pathlib import Path

from canvas_parser.parse.app_parse import archive_live_graph, write_graph_atomic


def test_archive_live_graph_copies_without_unlinking_live(tmp_path: Path) -> None:
    graph = tmp_path / 'canvas_graph.json'
    graph.write_text(json.dumps({'concepts': []}), encoding='utf-8')

    dest = archive_live_graph(tmp_path)
    assert dest is not None
    assert graph.is_file()
    assert dest.is_file()
    assert json.loads(dest.read_text(encoding='utf-8')) == {'concepts': []}
    assert dest.parent.name == 'graph_archive'


def test_write_graph_atomic(tmp_path: Path) -> None:
    target = write_graph_atomic(tmp_path, {'events': [1]})
    assert target.is_file()
    payload = json.loads(target.read_text(encoding='utf-8'))
    assert payload['events'] == [1]
