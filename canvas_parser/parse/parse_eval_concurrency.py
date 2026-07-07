"""Concurrency presets for parse eval (rotating file eval at high fan-out)."""
from __future__ import annotations

import os

DEFAULT_EVAL_CONCURRENCY = 1000

EVAL_CONCURRENCY_ENV_KEYS = (
    'PARSE_MAX_CONCURRENT',
    'DEEPSEEK_MAX_CONCURRENT',
    'PARSER_LAMBDA_INVOKE_WORKERS',
    'PARSER_SYLLABUS_DISCOVER_CONCURRENCY',
    'PARSER_EVAL_CONCURRENT_FILE_FANOUT',
)


def apply_eval_concurrency_env(concurrency: int = DEFAULT_EVAL_CONCURRENCY) -> int:
    """Set parser/Lambda concurrency knobs for high-fan-out eval runs."""
    level = max(1, int(concurrency))
    os.environ['PARSE_MAX_CONCURRENT'] = str(level)
    os.environ['DEEPSEEK_MAX_CONCURRENT'] = str(level)
    os.environ['PARSER_LAMBDA_INVOKE_WORKERS'] = str(level)
    os.environ['PARSER_SYLLABUS_DISCOVER_CONCURRENCY'] = str(min(level, 128))
    os.environ['PARSER_EVAL_CONCURRENT_FILE_FANOUT'] = str(level)
    # File-level eval needs promoted details, not deferred finalize.
    os.environ['PARSER_DEFER_PER_FILE_FINALIZE'] = '0'
    os.environ['PARSER_DEFER_BATCH_FINALIZE'] = '0'
    return level


def active_eval_concurrency() -> int:
    raw = os.getenv('PARSER_EVAL_CONCURRENT_FILE_FANOUT') or os.getenv('PARSE_MAX_CONCURRENT')
    try:
        return max(1, int(raw or DEFAULT_EVAL_CONCURRENCY))
    except (TypeError, ValueError):
        return DEFAULT_EVAL_CONCURRENCY
