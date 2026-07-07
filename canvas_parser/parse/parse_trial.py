"""Parse trial placements: local vs AWS Lambda concurrent per-item parse."""
from __future__ import annotations

import os
from typing import Literal

from canvas_parser.parse.parse_modes import (
    PARSE_MODE_ENV_KEYS,
    apply_llm_fast_mode,
    apply_parse_mode,
    clear_parse_mode_env,
)

Placement = Literal[
    'local_download_lambda_parse',
    'lambda_download_parse',
    'local_download_parse',
]

PLACEMENT_ENV = 'PARSER_TRIAL_PLACEMENT'
TRIAL_SIMPLE_FINALIZE_ENV = 'PARSER_TRIAL_SIMPLE_FINALIZE'
DOWNLOAD_ONLY_ENV = 'PARSER_DOWNLOAD_ONLY'
INFERENCE_ONLY_ENV = 'PARSER_INFERENCE_ONLY'
STATS_REPORT_ENV = 'PARSER_STATS_REPORT_PATH'
PRODUCTION_PARSE_ENV = 'PARSER_PRODUCTION_PARSE'

PLACEMENT_LABELS = {
    'local_download_lambda_parse': 'Local Canvas URLs/auth -> Lambda download+parse (concurrent)',
    'lambda_download_parse': 'Lambda download+parse from item URLs (concurrent)',
    'local_download_parse': 'Local download+parse from item URLs (concurrent)',
}

TRIAL_ENV_KEYS = (
    PLACEMENT_ENV,
    TRIAL_SIMPLE_FINALIZE_ENV,
    DOWNLOAD_ONLY_ENV,
    INFERENCE_ONLY_ENV,
    STATS_REPORT_ENV,
    PRODUCTION_PARSE_ENV,
)

_PLACEMENT_ALIASES = {
    'local_dl_server_llm': 'local_download_lambda_parse',
    'local_download_remote_parse': 'local_download_lambda_parse',
    'all_server': 'lambda_download_parse',
    'remote_download_parse': 'lambda_download_parse',
    'fully_local': 'local_download_parse',
    'local_all': 'local_download_parse',
}


def normalize_placement(name: str | None) -> Placement:
    text = str(name or '').strip().casefold().replace('-', '_')
    text = _PLACEMENT_ALIASES.get(text, text)
    if text not in PLACEMENT_LABELS:
        allowed = ', '.join(PLACEMENT_LABELS)
        raise ValueError(f'Unknown placement {name!r}; use one of: {allowed}')
    return text  # type: ignore[return-value]


def clear_trial_env() -> None:
    for key in TRIAL_ENV_KEYS:
        os.environ.pop(key, None)


def clear_all_parse_trial_env() -> None:
    clear_parse_mode_env()
    clear_trial_env()


def _apply_trial_shared() -> None:
    os.environ[TRIAL_SIMPLE_FINALIZE_ENV] = '1'
    os.environ['PARSER_DEFER_FILE_EMBED'] = '1'
    os.environ['PARSER_SKIP_EXTERNAL'] = '1'
    os.environ['PARSER_SKIP_ASSIGNMENT_SUMMARY'] = '1'
    os.environ.setdefault('PARSE_MAX_CONCURRENT', '28')
    os.environ.setdefault('DEEPSEEK_MAX_CONCURRENT', '32')
    os.environ.setdefault('PARSER_MAX_BATCH_ITEMS', '300')
    os.environ.setdefault('PARSER_DEFER_BATCH_FINALIZE', '0')


def apply_download_prefetch_env() -> None:
    os.environ[DOWNLOAD_ONLY_ENV] = '1'
    os.environ.pop(INFERENCE_ONLY_ENV, None)
    os.environ['PARSER_BULK_MODE'] = '1'
    os.environ['PARSER_SKIP_DOWNLOAD_IF_CACHED'] = '0'
    os.environ['PARSER_HEURISTIC_ONLY'] = '0'
    os.environ['PARSER_SKIP_PASS2'] = '1'
    os.environ['PARSER_SKIP_PAGE_LLM'] = '1'
    os.environ['PARSER_SKIP_LLM_CLASSIFY'] = '1'
    os.environ['PARSER_SKIP_SYLLABUS_FINAL_PASS'] = '1'
    os.environ['PARSER_DEFER_CHECKPOINT'] = '1'


def apply_inference_env() -> None:
    os.environ.pop(DOWNLOAD_ONLY_ENV, None)
    os.environ[INFERENCE_ONLY_ENV] = '1'
    os.environ['PARSER_BULK_MODE'] = '1'
    os.environ['PARSER_SKIP_DOWNLOAD_IF_CACHED'] = '1'
    os.environ.pop('PARSER_HEURISTIC_ONLY', None)
    os.environ.pop('PARSER_SKIP_PASS2', None)
    os.environ.pop('PARSER_SKIP_PAGE_LLM', None)
    os.environ.pop('PARSER_SKIP_LLM_CLASSIFY', None)
    os.environ['PARSER_SKIP_SYLLABUS_FINAL_PASS'] = '1'
    os.environ['PARSER_LINKED_FILE_MODE'] = 'light'
    os.environ['PARSER_DEFER_CHECKPOINT'] = '1'
    os.environ.setdefault('PARSER_HEURISTIC_CONCEPTS', '0')


def apply_full_llm_env() -> None:
    apply_llm_fast_mode()
    os.environ[TRIAL_SIMPLE_FINALIZE_ENV] = '1'
    os.environ.pop(DOWNLOAD_ONLY_ENV, None)
    os.environ.pop(INFERENCE_ONLY_ENV, None)


def is_production_parse() -> bool:
    return os.environ.get(PRODUCTION_PARSE_ENV) == '1'


def apply_production_placement(placement: str | None) -> Placement:
    """App-representative llm-fast parse (no trial skips or simple finalize)."""
    clear_all_parse_trial_env()
    normalized = normalize_placement(placement)
    os.environ[PLACEMENT_ENV] = normalized
    os.environ[PRODUCTION_PARSE_ENV] = '1'
    apply_parse_mode('llm-fast')
    os.environ['PARSER_HEURISTIC_CONCEPTS'] = '0'
    # Concurrent per-item workers: pass plan on by default (opt out with PARSER_PASS_PLAN=0).
    os.environ.setdefault('PARSER_PASS_PLAN', '1')
    # Per-item URL download (Lambda / concurrent local), not on-disk cache.
    os.environ['PARSER_SKIP_DOWNLOAD_IF_CACHED'] = '0'
    return normalized


def apply_placement(
    placement: str | None,
    *,
    phase: str | None = None,
) -> Placement:
    clear_all_parse_trial_env()
    normalized = normalize_placement(placement)
    os.environ[PLACEMENT_ENV] = normalized
    _apply_trial_shared()

    if normalized == 'local_download_parse':
        apply_full_llm_env()
        os.environ['PARSER_PARSE_MODE'] = 'llm-fast'
        return normalized

    if normalized == 'local_download_lambda_parse':
        apply_full_llm_env()
        os.environ['PARSER_PARSE_MODE'] = 'llm-fast'
        return normalized

    if normalized == 'lambda_download_parse':
        apply_full_llm_env()
        os.environ['PARSER_PARSE_MODE'] = 'llm-fast'
        return normalized

    raise ValueError(f'Unknown placement {placement!r}')


def placement_needs_lambda(placement: str | None) -> bool:
    return normalize_placement(placement) in {
        'local_download_lambda_parse',
        'lambda_download_parse',
    }


def format_placement(name: str | None = None) -> str:
    key = normalize_placement(name or os.environ.get(PLACEMENT_ENV))
    return f'{key} ({PLACEMENT_LABELS[key]})'


TRIAL_ARM_LABELS = PLACEMENT_LABELS
normalize_trial_arm = normalize_placement
apply_trial_arm = apply_placement
format_trial_arm = format_placement
