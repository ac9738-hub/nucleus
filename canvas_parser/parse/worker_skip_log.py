"""Structured debug log for Lambda/local worker parse skips."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SKIP_LINE_RE = re.compile(
    r'skipped|forbidden|download failure|download/extract failure|missing url|unsupported file type|extract failed',
    re.I,
)


def skip_log_path() -> Path:
    raw = os.getenv('PARSER_WORKER_SKIP_LOG', '').strip()
    if raw:
        return Path(raw)
    return Path('.cache/parse_trial/debug/worker_skips.jsonl')


def _classify_skip_line(line: str) -> str:
    lower = line.lower()
    if 'forbidden' in lower:
        return 'forbidden_download'
    if 'extract failed' in lower:
        return 'extract_failed'
    if 'download failure' in lower or 'download/extract failure' in lower or 'download request failed' in lower:
        return 'download_failure'
    if 'missing url' in lower:
        return 'missing_url'
    if 'unsupported file type' in lower:
        return 'unsupported_type'
    if 'oversize' in lower or 'context' in lower:
        return 'oversize_context'
    if 'deepseek' in lower and 'skipped' in lower:
        return 'deepseek_skipped'
    if 'linked file' in lower:
        return 'linked_file_skipped'
    if 'resume' in lower and 'skipped parsed' in lower:
        return 'already_parsed'
    return 'parser_skip'


def collect_parser_skip_lines(lines: list[str]) -> list[str]:
    return [line for line in lines if _SKIP_LINE_RE.search(line)]


def _item_had_deepseek(fragment: dict[str, Any], course_id: str, item_id: str) -> bool:
    calls = fragment.get('completed_model_calls') or {}
    cid, iid = str(course_id), str(item_id)
    for row in calls.get('deepseek_file_passes') or []:
        if str(row.get('courseid') or '') == cid and str(row.get('fileid') or '') == iid:
            return True
    for row in calls.get('parse_file_stats') or []:
        if str(row.get('courseid') or '') == cid and str(row.get('fileid') or '') == iid:
            return True
    for row in calls.get('deepseek_classifications') or []:
        if str(row.get('courseid') or '') == cid and str(row.get('fileid') or '') == iid:
            return True
    return False


def infer_fragment_skip(
    fragment: dict[str, Any],
    item: dict[str, Any],
    batch_type: str,
    parser_skip_lines: list[str],
) -> dict[str, Any] | None:
    course_id = str(item.get('courseid') or '')
    item_id = str(item.get('id') or '')
    if batch_type != 'file':
        if parser_skip_lines:
            return {
                'reason': _classify_skip_line(parser_skip_lines[-1]),
                'parser_skip_lines': parser_skip_lines,
            }
        return None

    if _item_had_deepseek(fragment, course_id, item_id):
        return None

    files = (fragment.get('files') or {}).get(course_id, {})
    has_file_node = str(item_id) in files
    parsed = fragment.get('parsed_items') or {}
    marked_parsed = any(
        str(row.get('id') or '') == item_id for row in (parsed.get('file') or [])
    )

    if parser_skip_lines:
        reason = _classify_skip_line(parser_skip_lines[-1])
    elif not has_file_node and not marked_parsed:
        reason = 'no_file_node'
    elif has_file_node and not marked_parsed:
        reason = 'file_node_no_llm'
    else:
        reason = 'no_llm_passes'

    return {
        'reason': reason,
        'parser_skip_lines': parser_skip_lines,
        'has_file_node': has_file_node,
        'marked_parsed': marked_parsed,
    }


def log_worker_skip(
    *,
    run_id: str = '',
    placement: str = '',
    course_id: str = '',
    item_id: str = '',
    batch_type: str = '',
    item_name: str = '',
    reason: str = '',
    parser_skip_lines: list[str] | None = None,
    deepseek_passes: int = 0,
    elapsed_ms: float | None = None,
    url: str = '',
    extra: dict[str, Any] | None = None,
) -> None:
    row = {
        'ts': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'run_id': run_id,
        'placement': placement,
        'course_id': course_id,
        'item_id': item_id,
        'batch_type': batch_type,
        'item_name': item_name,
        'reason': reason,
        'parser_skip_lines': parser_skip_lines or [],
        'deepseek_passes': deepseek_passes,
        'elapsed_ms': elapsed_ms,
        'url': url,
    }
    if extra:
        row.update(extra)
    path = skip_log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('a', encoding='utf-8') as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')
    except OSError:
        return


def summarize_skip_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_reason: dict[str, int] = {}
    for row in rows:
        reason = str(row.get('reason') or 'unknown')
        by_reason[reason] = by_reason.get(reason, 0) + 1
    return {
        'total': len(rows),
        'by_reason': by_reason,
    }
