"""Shared fuzzy matching helpers for ground-truth evaluation."""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

MONTH_NAME_PATTERN = re.compile(
    r'\b(january|february|march|april|may|june|july|august|september|october|november|december)\b'
)
WEEK_NAME_PATTERN = re.compile(r'\bweek\s*(\d+)\b')
LOW_INFORMATION_TOKENS = {'a', 'an', 'and', 'or', 'the', 'of', 'for', 'to', 'in', 'on'}


def normalize_name(value: str) -> str:
    text = unicodedata.normalize('NFKC', str(value or '')).lower()
    text = text.replace('_', ' ')
    text = re.sub(r'[^\w\s]', ' ', text, flags=re.UNICODE)
    return re.sub(r'\s+', ' ', text).strip()


def names_match(left: str, right: str, threshold: float = 0.82) -> bool:
    a = normalize_name(left)
    b = normalize_name(right)
    if not a or not b:
        return False
    if a == b:
        return True

    week_a = WEEK_NAME_PATTERN.search(a)
    week_b = WEEK_NAME_PATTERN.search(b)
    if week_a and week_b:
        return week_a.group(1) == week_b.group(1)

    if MONTH_NAME_PATTERN.search(a) or MONTH_NAME_PATTERN.search(b):
        return a == b

    if a in b or b in a:
        return True

    tokens_a = [token for token in a.split() if token not in LOW_INFORMATION_TOKENS]
    tokens_b = [token for token in b.split() if token not in LOW_INFORMATION_TOKENS]
    if len(tokens_a) >= 3 and set(tokens_a).issubset(tokens_b):
        return True
    if len(tokens_b) >= 3 and set(tokens_b).issubset(tokens_a):
        return True
    return SequenceMatcher(None, a, b).ratio() >= threshold
