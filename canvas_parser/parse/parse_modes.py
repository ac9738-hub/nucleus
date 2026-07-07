"""Central parse-mode presets for full reparse and benchmarks.

Modes:
  heuristic — download/extract files, heuristic classify only, no LLM or concept seeding
  llm       — full DeepSeek pass1/pass2, syllabus final pass (quality baseline)
  llm-fast  — bulk throughput settings; still uses LLM (default for app reparse)
"""
from __future__ import annotations

import os
from typing import Literal

ParseMode = Literal['heuristic', 'llm', 'llm-fast', 'llm-cost']

PARSE_MODE_ENV = 'PARSER_PARSE_MODE'
HEURISTIC_ONLY_ENV = 'PARSER_HEURISTIC_ONLY'

PARSE_MODE_ENV_KEYS = (
    PARSE_MODE_ENV,
    HEURISTIC_ONLY_ENV,
    'PARSER_BULK_MODE',
    'PARSER_SKIP_PASS2',
    'PARSER_DEFER_FILE_EMBED',
    'PARSER_DEFER_CHECKPOINT',
    'PARSER_SKIP_ASSIGNMENT_SUMMARY',
    'PARSER_SKIP_SYLLABUS_FINAL_PASS',
    'PARSER_SKIP_EXTERNAL',
    'PARSER_SKIP_PAGE_LLM',
    'PARSER_DEFER_PER_FILE_FINALIZE',
    'PARSER_DEFER_FILE_INDEX',
    'PARSER_DEFER_BATCH_FINALIZE',
    'PARSER_SKIP_LLM_CLASSIFY',
    'PARSER_PASS_PLAN',
    'PARSER_SKIP_DOWNLOAD_IF_CACHED',
    'PARSER_SKIP_PDF_BLOCKS',
    'PARSER_SKIP_PAGE_LINK_HUB',
    'PARSER_LINKED_FILE_MODE',
    'PARSER_KEYWORD_EXTRACT',
    'PARSER_HEURISTIC_CONCEPTS',
    'PARSER_HEURISTIC_MAX_PER_FILE',
    'PARSE_MAX_CONCURRENT',
    'DEEPSEEK_MAX_CONCURRENT',
    'DEEPSEEK_MAX_TURNS_PASS',
    'PARSER_MAX_BATCH_ITEMS',
    'WRITE_DEBOUNCE_SECONDS',
)

MODE_LABELS = {
    'heuristic': 'Heuristic only (no LLM)',
    'llm': 'Full LLM (quality)',
    'llm-fast': 'LLM bulk (fast)',
    'llm-cost': 'LLM cost-optimized (GT/eval)',
}


def normalize_parse_mode(mode: str | None) -> ParseMode:
    text = str(mode or 'llm-fast').strip().casefold().replace('_', '-')
    aliases = {
        'non-heuristic': 'llm',
        'nonheuristic': 'llm',
        'quality': 'llm',
        'full': 'llm',
        'fast': 'llm-fast',
        'bulk': 'llm-fast',
        'cost': 'llm-cost',
        'cost-optimized': 'llm-cost',
    }
    text = aliases.get(text, text)
    if text not in MODE_LABELS:
        allowed = ', '.join(MODE_LABELS)
        raise ValueError(f'Unknown parse mode {mode!r}; use one of: {allowed}')
    return text  # type: ignore[return-value]


def clear_parse_mode_env() -> None:
    for key in PARSE_MODE_ENV_KEYS:
        os.environ.pop(key, None)


def _apply_shared_bulk_throughput() -> None:
    os.environ['PARSER_BULK_MODE'] = '1'
    os.environ['PARSER_DEFER_FILE_EMBED'] = '1'
    os.environ['PARSER_DEFER_CHECKPOINT'] = '1'
    os.environ['PARSER_SKIP_ASSIGNMENT_SUMMARY'] = '1'
    os.environ['PARSER_SKIP_DOWNLOAD_IF_CACHED'] = '1'
    os.environ.setdefault('PARSER_DEFER_PER_FILE_FINALIZE', '1')
    os.environ.setdefault('PARSER_DEFER_FILE_INDEX', '1')
    os.environ['PARSE_MAX_CONCURRENT'] = '28'
    os.environ['DEEPSEEK_MAX_CONCURRENT'] = '32'
    os.environ['DEEPSEEK_MAX_TURNS_PASS'] = '3'
    os.environ['WRITE_DEBOUNCE_SECONDS'] = '180'
    os.environ['PARSER_MAX_BATCH_ITEMS'] = '300'
    os.environ['PARSER_DEFER_BATCH_FINALIZE'] = '0'


def apply_heuristic_mode() -> None:
    """Rules-only parse: files + heuristic classify; no DeepSeek calls or concept seeding."""
    os.environ[HEURISTIC_ONLY_ENV] = '1'
    os.environ['PARSER_HEURISTIC_CONCEPTS'] = '0'
    os.environ.setdefault('PARSER_HEURISTIC_MAX_PER_FILE', '80')
    os.environ['PARSER_SKIP_PASS2'] = '1'
    os.environ['PARSER_SKIP_PAGE_LLM'] = '1'
    os.environ['PARSER_SKIP_LLM_CLASSIFY'] = '1'
    os.environ['PARSER_SKIP_SYLLABUS_FINAL_PASS'] = '1'
    os.environ['PARSER_SKIP_EXTERNAL'] = '1'
    os.environ['PARSER_SKIP_PAGE_LINK_HUB'] = '1'
    _apply_shared_bulk_throughput()


def apply_llm_mode() -> None:
    """Quality-first LLM parse (pass2, classify, syllabus final pass)."""
    os.environ.pop(HEURISTIC_ONLY_ENV, None)
    os.environ['PARSER_HEURISTIC_CONCEPTS'] = '0'
    os.environ.setdefault('PARSE_MAX_CONCURRENT', '12')
    os.environ.setdefault('DEEPSEEK_MAX_CONCURRENT', '14')
    os.environ.setdefault('DEEPSEEK_MAX_TURNS_PASS', '3')


def apply_llm_cost_mode() -> None:
    """Cost-aware LLM parse: single-pass profiles, skip redundant classify/final passes."""
    os.environ.pop(HEURISTIC_ONLY_ENV, None)
    os.environ['PARSER_SKIP_SYLLABUS_FINAL_PASS'] = '1'
    os.environ['PARSER_SKIP_EXTERNAL'] = '1'
    os.environ['PARSER_SKIP_PAGE_LINK_HUB'] = '1'
    os.environ['PARSER_LINKED_FILE_MODE'] = 'light'
    os.environ.pop('PARSER_SKIP_PASS2', None)
    os.environ.pop('PARSER_SKIP_PAGE_LLM', None)
    os.environ['PARSER_SKIP_LLM_CLASSIFY'] = '1'
    os.environ['PARSER_PASS_PLAN'] = '1'
    os.environ['PARSER_HEURISTIC_CONCEPTS'] = '0'
    # GT/file eval: promote details immediately; still defer embed for cost.
    os.environ['PARSER_DEFER_PER_FILE_FINALIZE'] = '0'
    os.environ['PARSER_DEFER_BATCH_FINALIZE'] = '0'
    os.environ['PARSER_BULK_MODE'] = '1'
    os.environ['PARSER_DEFER_FILE_EMBED'] = '1'
    os.environ['PARSER_DEFER_CHECKPOINT'] = '1'
    os.environ['PARSER_SKIP_ASSIGNMENT_SUMMARY'] = '1'
    os.environ['PARSER_SKIP_DOWNLOAD_IF_CACHED'] = '1'
    os.environ.setdefault('PARSER_DEFER_FILE_INDEX', '1')
    os.environ.setdefault('PARSE_MAX_CONCURRENT', '12')
    os.environ.setdefault('DEEPSEEK_MAX_CONCURRENT', '14')
    os.environ.setdefault('DEEPSEEK_MAX_TURNS_PASS', '3')


def apply_llm_fast_mode() -> None:
    """Bulk LLM parse — same extraction depth as llm, fewer checkpoints/embed passes."""
    os.environ.pop(HEURISTIC_ONLY_ENV, None)
    os.environ['PARSER_SKIP_SYLLABUS_FINAL_PASS'] = '1'
    os.environ['PARSER_SKIP_EXTERNAL'] = '1'
    os.environ['PARSER_SKIP_PAGE_LINK_HUB'] = '1'
    os.environ['PARSER_LINKED_FILE_MODE'] = 'light'
    os.environ.pop('PARSER_SKIP_PASS2', None)
    os.environ.pop('PARSER_SKIP_PAGE_LLM', None)
    os.environ.pop('PARSER_SKIP_LLM_CLASSIFY', None)
    os.environ.pop('PARSER_SKIP_PDF_BLOCKS', None)
    os.environ.pop('PARSER_KEYWORD_EXTRACT', None)
    os.environ['PARSER_HEURISTIC_CONCEPTS'] = '0'
    _apply_shared_bulk_throughput()


def apply_parse_mode(mode: str | None) -> ParseMode:
    clear_parse_mode_env()
    normalized = normalize_parse_mode(mode)
    if normalized == 'heuristic':
        apply_heuristic_mode()
    elif normalized == 'llm':
        apply_llm_mode()
    elif normalized == 'llm-cost':
        apply_llm_cost_mode()
    else:
        apply_llm_fast_mode()
    os.environ[PARSE_MODE_ENV] = normalized
    return normalized


def active_parse_mode() -> str:
    return os.environ.get(PARSE_MODE_ENV, 'llm-fast')


def format_active_parse_mode() -> str:
    mode = active_parse_mode()
    label = MODE_LABELS.get(mode, mode)
    return f'{mode} ({label})'


def active_parse_env() -> dict[str, str]:
    return {key: os.environ[key] for key in PARSE_MODE_ENV_KEYS if os.environ.get(key)}


def print_active_parse_mode() -> None:
    print(f'Parse mode: {format_active_parse_mode()}')
    active = active_parse_env()
    if active:
        print('Parser env:', ' '.join(f'{key}={value}' for key, value in active.items()))


# Backward-compatible names used by older scripts.
def apply_fast_reparse_env() -> None:
    apply_llm_fast_mode()
    os.environ[PARSE_MODE_ENV] = 'llm-fast'


def apply_quality_reparse_env() -> None:
    apply_llm_mode()
    os.environ[PARSE_MODE_ENV] = 'llm'


def print_active_parser_tuning() -> None:
    print_active_parse_mode()
