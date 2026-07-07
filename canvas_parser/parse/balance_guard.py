"""Detect DeepSeek balance exhaustion and abort bulk parses early."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

_balance_strikes = 0


class InsufficientBalanceAbort(RuntimeError):
    """Raised when DeepSeek returns 402 and abort-on-balance is enabled."""


def reset_balance_guard() -> None:
    global _balance_strikes
    _balance_strikes = 0


def balance_strikes() -> int:
    return _balance_strikes


def is_insufficient_balance_error(error) -> bool:
    message = str(error or '').casefold()
    return 'insufficient balance' in message or 'error code: 402' in message


def abort_on_balance_enabled() -> bool:
    explicit = os.getenv('PARSER_ABORT_ON_BALANCE', '').strip()
    if explicit:
        return explicit == '1'
    return os.getenv('PARSER_BULK_MODE', '') == '1'


def balance_abort_threshold() -> int:
    return max(1, int(os.getenv('PARSER_BALANCE_ABORT_AFTER', '1')))


def record_balance_failure(error) -> int:
    global _balance_strikes
    _balance_strikes += 1
    return _balance_strikes


def should_abort_parse() -> bool:
    if not abort_on_balance_enabled():
        return False
    return _balance_strikes >= balance_abort_threshold()


def handle_balance_error(error, *, where: str) -> None:
    strikes = record_balance_failure(error)
    print(
        f"parser fatal: insufficient_balance where={where} strikes={strikes} error={error}",
        flush=True,
    )
    if should_abort_parse():
        cause = error if isinstance(error, BaseException) else RuntimeError(str(error))
        raise InsufficientBalanceAbort(
            f"DeepSeek insufficient balance after {strikes} failure(s) at {where}"
        ) from cause


def load_deepseek_api_key(root: Path | None = None) -> str:
    api_key = (os.getenv('DEEP_SEEK_API_KEY') or '').strip()
    if api_key:
        return api_key
    if root is None:
        return ''
    try:
        from canvas_parser.weekly_iteration.auth import load_env_file

        env_values = load_env_file(root / '.env')
        return (env_values.get('DEEP_SEEK_API_KEY') or '').strip()
    except Exception:
        return ''


async def _probe_deepseek_api(api_key: str) -> None:
    import openai

    client = openai.AsyncOpenAI(api_key=api_key, base_url='https://api.deepseek.com')
    await client.chat.completions.create(
        model='deepseek-v4-flash',
        messages=[{'role': 'user', 'content': 'ping'}],
        max_tokens=4,
    )


def preflight_deepseek_api(root: Path) -> None:
    """Fail fast when DeepSeek balance/key is unusable before a long parse."""
    api_key = load_deepseek_api_key(root)
    if not api_key:
        raise RuntimeError('DEEP_SEEK_API_KEY missing - set it in .env before running parse benchmark')

    try:
        asyncio.run(_probe_deepseek_api(api_key))
    except Exception as error:
        message = str(error)
        if is_insufficient_balance_error(error) or '402' in message:
            raise RuntimeError(
                'DeepSeek API returned 402 Insufficient Balance - top up DEEP_SEEK_API_KEY before benchmarking'
            ) from error
        raise RuntimeError(f'DeepSeek API preflight failed: {error}') from error
