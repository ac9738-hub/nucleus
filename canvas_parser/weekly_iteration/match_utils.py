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


HEADING_NUMBER_PATTERN = re.compile(r'^(\d+(?:\s+\d+)+)\s+')


def _heading_content_tokens(text: str) -> list[str]:
    stripped = HEADING_NUMBER_PATTERN.sub('', str(text or '').strip()).strip() or str(text or '')
    stopwords = {'the', 'a', 'an', 'for', 'and', 'of', 'to', 'in'}
    tokens = []
    for token in stripped.split():
        if token in stopwords or token.isdigit() or len(token) < 4:
            continue
        tokens.append(token)
    return tokens


def heading_concepts_match(left: str, right: str) -> bool:
    """Match numbered outline headings to LLM paraphrases (e.g. '6 1 the dome')."""
    a = normalize_name(left)
    b = normalize_name(right)
    if not a or not b:
        return False
    for numbered, other in ((a, b), (b, a)):
        if HEADING_NUMBER_PATTERN.match(numbered):
            for token in _heading_content_tokens(numbered):
                if token in other.split():
                    return True
    return False


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
    for numbered, other in ((a, b), (b, a)):
        if HEADING_NUMBER_PATTERN.match(numbered):
            for token in _heading_content_tokens(numbered):
                if token in other.split():
                    return True

    stopwords = {'the', 'a', 'an', 'for', 'and', 'of', 'to', 'in'}
    key_tokens = [token for token in shorter.split() if token not in stopwords]
    if len(key_tokens) >= 3 and all(token in longer.split() for token in key_tokens):
        return True

    content_tokens = [
        token for token in a.split()
        if token not in stopwords and len(token) >= 4
    ]
    other_tokens = set(
        token for token in b.split()
        if token not in stopwords and len(token) >= 4
    )
    if content_tokens and other_tokens:
        exam_tokens = {'exam', 'midterm', 'final', 'quiz', 'test'}
        overlap = sum(1 for token in content_tokens if token in other_tokens)
        meaningful_overlap = sum(
            1 for token in content_tokens
            if token in other_tokens and token not in exam_tokens
        )
        if overlap >= 3 or meaningful_overlap >= 2:
            return True

    return SequenceMatcher(None, a, b).ratio() >= threshold
