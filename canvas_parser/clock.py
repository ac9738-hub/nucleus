"""Fake clock for local dev — mirrors lib/clock.js via NUCLEUS_FAKE_DATE."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

_installed = False
_checked = False
_offset_sec = 0.0
_fake_label = ''


def _parse_fake_ms(raw: str) -> float | None:
    text = str(raw or '').strip()
    if not text:
        return None
    try:
        if 'T' in text:
            dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
        else:
            dt = datetime.fromisoformat(f'{text}T12:00:00')
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return None


def install_clock_shim() -> dict:
    global _installed, _checked, _offset_sec, _fake_label
    if _installed or _checked:
        return clock_status()

    raw = os.environ.get('NUCLEUS_FAKE_DATE', '').strip()
    target = _parse_fake_ms(raw)
    if target is None:
        _checked = True
        return clock_status()

    _offset_sec = target - time.time()
    _fake_label = datetime.fromtimestamp(target, tz=timezone.utc).isoformat()
    _installed = True
    return clock_status()


def now_ms() -> int:
    if not _installed and not _checked:
        install_clock_shim()
    if not _installed:
        return int(time.time() * 1000)
    return int((time.time() + _offset_sec) * 1000)


def now() -> datetime:
    return datetime.fromtimestamp(now_ms() / 1000, tz=timezone.utc)


def clock_status() -> dict:
    if _installed:
        current_ms = int((time.time() + _offset_sec) * 1000)
    else:
        current_ms = int(time.time() * 1000)
    return {
        'active': _installed,
        'offset_sec': _offset_sec,
        'fake_date': _fake_label,
        'fake_date_raw': os.environ.get('NUCLEUS_FAKE_DATE', '').strip(),
        'now_ms': current_ms,
    }
