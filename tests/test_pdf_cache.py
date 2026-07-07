"""Tests for PDF extract disk cache paths."""
from pathlib import Path

from canvas_parser.parse.pdf_cache import _cache_dir


def test_cache_dir_honors_absolute_env(monkeypatch, tmp_path):
    target = tmp_path / 'pdf_extract'
    monkeypatch.setenv('PARSER_PDF_CACHE_DIR', str(target))
    assert _cache_dir(root=Path('/var/task')) == target


def test_cache_dir_relative_joins_workspace_root(monkeypatch):
    monkeypatch.delenv('PARSER_PDF_CACHE_DIR', raising=False)
    root = Path('/workspace')
    assert _cache_dir(root=root) == root / '.cache' / 'pdf_extract'
