"""Shared fuzzy matching helpers for ground-truth evaluation."""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

MONTH_NAME_PATTERN = re.compile(
    r'\b(january|february|march|april|may|june|july|august|september|october|november|december)\b'
)
WEEK_NAME_PATTERN = re.compile(r'\bweek\s*(\d+)\b')


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

    shorter, longer = (a, b) if len(a.split()) <= len(b.split()) else (b, a)
    stopwords = {'the', 'a', 'an', 'for', 'and', 'of', 'to', 'in'}
    key_tokens = [token for token in shorter.split() if token not in stopwords]
    if len(key_tokens) >= 3 and all(token in longer.split() for token in key_tokens):
        return True

    return SequenceMatcher(None, a, b).ratio() >= threshold
