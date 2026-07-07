"""Disk cache for extracted PDF page text — avoids repeat fitz work on re-parses."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any


def pdf_cache_enabled() -> bool:
    return os.getenv('PARSER_PDF_CACHE', '1').strip().casefold() not in {'0', 'false', 'off', 'no'}


def _cache_dir(root: Path | None = None) -> Path:
    cache_root = Path(os.getenv('PARSER_PDF_CACHE_DIR', '.cache/pdf_extract'))
    if cache_root.is_absolute():
        return cache_root
    base = root or Path(__file__).resolve().parents[2]
    return base / cache_root


def _fingerprint(filepath: Path) -> str:
    stat = filepath.stat()
    digest = hashlib.sha256(
        f'{stat.st_size}:{stat.st_mtime_ns}:{filepath.name}'.encode('utf-8'),
    ).hexdigest()[:24]
    return digest


def cache_path_for_pdf(filepath: Path, *, root: Path | None = None) -> Path:
    return _cache_dir(root) / f'{_fingerprint(filepath)}.json'


def load_cached_pdf_pages(filepath: Path, fileid: str, *, root: Path | None = None) -> list[dict[str, Any]] | None:
    if not pdf_cache_enabled() or not filepath.is_file():
        return None
    path = cache_path_for_pdf(filepath, root=root)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return None
    if str(payload.get('fingerprint') or '') != _fingerprint(filepath):
        return None
    pages = payload.get('pages')
    if not isinstance(pages, list):
        return None
    return pages


def store_cached_pdf_pages(
    filepath: Path,
    fileid: str,
    pages: list[dict[str, Any]],
    *,
    root: Path | None = None,
) -> None:
    if not pdf_cache_enabled() or not filepath.is_file() or not pages:
        return
    path = cache_path_for_pdf(filepath, root=root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'fileid': str(fileid or ''),
        'fingerprint': _fingerprint(filepath),
        'pages': pages,
    }
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    temp.replace(path)
