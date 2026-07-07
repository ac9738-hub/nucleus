"""Retry and classify transient DeepSeek API failures (rate limits, context/token limits)."""

from __future__ import annotations

import asyncio
import os

from canvas_parser.parse.balance_guard import (
    handle_balance_error,
    is_insufficient_balance_error,
)
from canvas_parser.parse.fast_path import is_non_fatal_llm_error


def is_rate_limit_error(error) -> bool:
    message = str(error or '').casefold()
    return (
        '429' in message
        or 'rate limit' in message
        or 'too many requests' in message
    )


def is_token_limit_error(error) -> bool:
    message = str(error or '').casefold()
    return (
        'maximum context length' in message
        or 'context length is' in message
        or 'context length exceeded' in message
        or 'max_tokens' in message and 'exceed' in message
        or 'token limit' in message
    )


def is_skippable_llm_error(error) -> bool:
    """Errors where we skip the current file and continue the bulk parse."""
    if is_insufficient_balance_error(error):
        return False
    if is_non_fatal_llm_error(error):
        return True
    if is_token_limit_error(error):
        return True
    return False


def _retry_delays() -> list[float]:
    raw = os.getenv('PARSER_LLM_RETRY_DELAYS_SEC', '2,5,15')
    delays: list[float] = []
    for part in raw.split(','):
        part = part.strip()
        if not part:
            continue
        try:
            delays.append(float(part))
        except ValueError:
            continue
    return delays or [2.0, 5.0, 15.0]


async def deepseek_completion_with_retry(client, *, where: str = 'deepseek', **kwargs):
    """Call chat.completions.create with rate-limit backoff; re-raise balance/token fatal errors."""
    delays = _retry_delays()
    last_error = None
    for attempt in range(len(delays) + 1):
        if attempt:
            delay = delays[attempt - 1]
            print(
                f"parser warning: llm retry where={where} attempt={attempt} "
                f"sleep={delay}s error={last_error}",
                flush=True,
            )
            await asyncio.sleep(delay)
        try:
            return await client.chat.completions.create(**kwargs)
        except Exception as error:
            last_error = error
            if is_insufficient_balance_error(error):
                handle_balance_error(error, where=where)
            if is_rate_limit_error(error) and attempt < len(delays):
                continue
            if is_skippable_llm_error(error):
                raise
            raise
    raise RuntimeError(f'deepseek retries exhausted at {where}: {last_error}')
