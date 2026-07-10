"""Tests for app_parse graph archival."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

from canvas_parser.parse import app_parse


def test_archive_live_graph_moves_without_deleting(tmp_path: Path) -> None:
    graph = tmp_path / 'canvas_graph.json'
    graph.write_text(json.dumps({'concepts': []}), encoding='utf-8')

    dest = app_parse.archive_live_graph(tmp_path)
    assert dest is not None
    assert not graph.is_file()
    assert dest.is_file()
    assert dest.parent.name == 'graph_archive'


def test_write_graph_atomic(tmp_path: Path) -> None:
    target = app_parse.write_graph_atomic(tmp_path, {'events': [1]})
    assert target.is_file()
    payload = json.loads(target.read_text(encoding='utf-8'))
    assert payload['events'] == [1]


def test_run_app_parse_reembeds_deferred_graph(tmp_path: Path, monkeypatch) -> None:
    from canvas_parser.parse import balance_guard, course_orchestrator, lambda_deploy
    from scripts import postprocess_parse_graph, run_full_reparse_canvas_data

    calls: list[str] = []

    async def fake_orchestrated_lambda(*_args, **_kwargs):
        calls.append('orchestrate')
        return ({'events': [{'name': 'Exam'}]}, {'items': 1})

    def fake_reembed() -> int:
        calls.append('reembed')
        assert (tmp_path / 'canvas_graph.json').is_file()
        assert 'PARSER_SKIP_DISK_RESUME' not in app_parse.os.environ
        assert 'PARSER_SKIP_EMBEDDING_CACHE' not in app_parse.os.environ
        return 0

    monkeypatch.setattr(balance_guard, 'preflight_deepseek_api', lambda _root: None)
    monkeypatch.setattr(course_orchestrator, 'run_course_orchestrated_lambda', fake_orchestrated_lambda)
    monkeypatch.setattr(lambda_deploy, 'load_lambda_state', lambda _root: {'function': 'parser'})
    monkeypatch.setattr(
        run_full_reparse_canvas_data,
        'load_batches',
        lambda _root, princeton_only=False: ([{'type': 'course'}], ['course-1']),
    )
    monkeypatch.setattr(postprocess_parse_graph, 'postprocess_graph', lambda graph, **_kwargs: graph)
    monkeypatch.setattr(app_parse, 'load_auth_from_env', lambda _root: SimpleNamespace(base_url='https://canvas.example'))
    monkeypatch.setattr(app_parse, '_run_reembed_graph', fake_reembed)
    monkeypatch.setenv('PARSER_SKIP_DISK_RESUME', '1')
    monkeypatch.setenv('PARSER_SKIP_EMBEDDING_CACHE', '1')

    result = asyncio.run(
        app_parse.run_app_parse(
            tmp_path,
            placement='local_download_lambda_parse',
            skip_archive=True,
        )
    )

    assert result['meta'] == {'items': 1}
    assert calls == ['orchestrate', 'reembed']
    assert app_parse.os.environ['PARSER_SKIP_DISK_RESUME'] == '1'
    assert app_parse.os.environ['PARSER_SKIP_EMBEDDING_CACHE'] == '1'
