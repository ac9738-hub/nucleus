"""Tests for worker skip debug logging."""
from canvas_parser.parse.worker_skip_log import (
    collect_parser_skip_lines,
    infer_fragment_skip,
    summarize_skip_rows,
)


def test_collect_parser_skip_lines():
    lines = [
        'parser: normal line',
        'parser: skipped forbidden canvas download status=403 url=https://x',
        'parser cost: file=1',
    ]
    hits = collect_parser_skip_lines(lines)
    assert len(hits) == 1
    assert 'forbidden' in hits[0]


def test_infer_fragment_skip_download_failure():
    item = {'courseid': '17581', 'id': '99', 'name': 'slides.pdf', 'url': 'https://x'}
    fragment = {
        'files': {},
        'parsed_items': {'file': []},
        'completed_model_calls': {'deepseek_file_passes': [], 'parse_file_stats': []},
    }
    skip_lines = ['parser: skipped file after download/extract failure type=file course=17581 id=99 url=https://x']
    info = infer_fragment_skip(fragment, item, 'file', skip_lines)
    assert info is not None
    assert info['reason'] == 'download_failure'


def test_infer_fragment_skip_none_when_deepseek_ran():
    item = {'courseid': '17581', 'id': '99', 'name': 'slides.pdf'}
    fragment = {
        'files': {'17581': {'99': {}}},
        'parsed_items': {'file': []},
        'completed_model_calls': {
            'deepseek_file_passes': [{'courseid': '17581', 'fileid': '99'}],
            'parse_file_stats': [],
        },
    }
    assert infer_fragment_skip(fragment, item, 'file', []) is None


def test_summarize_skip_rows():
    summary = summarize_skip_rows([
        {'reason': 'forbidden_download'},
        {'reason': 'forbidden_download'},
        {'reason': 'missing_url'},
    ])
    assert summary['total'] == 3
    assert summary['by_reason']['forbidden_download'] == 2
