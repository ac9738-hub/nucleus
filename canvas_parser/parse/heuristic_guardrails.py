"""Guardrails for deterministic heuristic concept titles — reject before seeding.

Incorrect extractions pollute the graph and RAG; missing a title is recoverable.
Only high-confidence structural patterns become concept nodes by default.
"""

from __future__ import annotations

import os
import re

from canvas_parser.weekly_iteration.match_utils import normalize_name

# Env: max heuristic concepts seeded per file (high-confidence first).
HEURISTIC_MAX_PER_FILE = max(1, int(os.getenv('PARSER_HEURISTIC_MAX_PER_FILE', '80')))
FILE_TYPE_CAP_OVERRIDES = {
    'code_technical': 140,
    'reference_sheet': 120,
    'textbook_chapter': 100,
}
# Env: allow medium-confidence titles (teaching-block classified short headings).
HEURISTIC_ALLOW_MEDIUM = os.getenv('PARSER_HEURISTIC_ALLOW_MEDIUM', '1').strip().casefold() in {
    '1', 'true', 'on', 'yes',
}

FRAGMENT_START_PATTERN = re.compile(
    r'^(?:and|or|but|if|then|so|also|see|note|for|the|a|an|in|on|at|to|of|with|'
    r'your|this|that|these|those|we|you|they|it|is|are|was|were|'
    r'click|download|submit|due|page|figure|fig|table|slide|image)\b',
    re.I,
)
SENTENCE_END_PATTERN = re.compile(r'[.!?]\s*$')
URL_PATTERN = re.compile(r'https?://|www\.', re.I)
MOSTLY_DIGITS_PATTERN = re.compile(r'^\d[\d\s./-]{0,20}$')
BOILERPLATE_PATTERN = re.compile(
    r'\b(?:click here|due date|office hours|zoom link|canvas|instructor|'
    r'copyright|all rights reserved|questions\?|any questions)\b',
    re.I,
)
CITATION_FRAGMENT_PATTERN = re.compile(
    r'^\d{4}\s+[a-z]|^\([a-z]+\s+\d{4}\)|\bet\s+al\b',
    re.I,
)
ARM_NOISE_PATTERN = re.compile(
    r'^(?:page faults|sbrk|brk\b|mmap\b|null\b|void\s*\*|typedef\b)',
    re.I,
)

HIGH_CONFIDENCE_SOURCES = frozenset({
    'numbered_outline',
    'single_major_section',
    'art_lecture',
    'chapter',
    'numbered_section',
    'week_filename',
    'week_syllabus',
    'lecture_number',
    'mat_section',
    'teaching_unit',
    'filename_stem',
})

MEDIUM_CONFIDENCE_SOURCES = frozenset({
    'stem_short_heading',
    'colon_tail',
    'slide_classified',
})


def title_rejection_reason(title: str) -> str | None:
    """Return a reason string if title must not become a concept node."""
    text = _clean(title)
    if not text:
        return 'empty'
    if len(text) < 3:
        return 'too_short'
    if len(text) > 120:
        return 'too_long'
    if MOSTLY_DIGITS_PATTERN.match(text.strip()):
        return 'mostly_digits'
    if URL_PATTERN.search(text):
        return 'url'
    if BOILERPLATE_PATTERN.search(text):
        return 'boilerplate'
    if CITATION_FRAGMENT_PATTERN.search(text):
        return 'citation_fragment'
    if FRAGMENT_START_PATTERN.match(text):
        return 'sentence_fragment'
    if SENTENCE_END_PATTERN.search(text) and len(text.split()) > 6:
        return 'full_sentence'
    if ARM_NOISE_PATTERN.match(text):
        return 'arm_noise'
    words = text.split()
    if len(words) == 1 and len(text) <= 4 and not text.isdigit():
        return 'single_token_short'
    alpha = sum(ch.isalpha() for ch in text)
    if alpha < 3:
        return 'no_letters'
    return None


def _clean(text: str) -> str:
    return str(text or '').strip()


def classify_title_confidence(source: str) -> str:
    if source in HIGH_CONFIDENCE_SOURCES:
        return 'high'
    if source in MEDIUM_CONFIDENCE_SOURCES:
        return 'medium'
    return 'low'


def is_acceptable_heuristic_title(title: str, *, source: str = '') -> bool:
    if title_rejection_reason(title):
        return False
    tier = classify_title_confidence(source)
    if tier == 'high':
        return True
    if tier == 'medium' and HEURISTIC_ALLOW_MEDIUM:
        return True
    return False


def filter_heuristic_titles(
    candidates: list[tuple[str, str]],
    *,
    max_count: int | None = None,
) -> tuple[list[str], dict]:
    """Filter (title, source) pairs; prefer high-confidence; cap per file."""
    cap = max_count if max_count is not None else HEURISTIC_MAX_PER_FILE
    accepted: list[str] = []
    seen: set[str] = set()
    stats = {
        'candidates': len(candidates),
        'rejected': 0,
        'rejectionReasons': {},
        'acceptedHigh': 0,
        'acceptedMedium': 0,
        'capped': 0,
    }

    def _reject(reason: str) -> None:
        stats['rejected'] += 1
        stats['rejectionReasons'][reason] = stats['rejectionReasons'].get(reason, 0) + 1

    high: list[tuple[str, str]] = []
    medium: list[tuple[str, str]] = []
    for title, source in candidates:
        reason = title_rejection_reason(title)
        if reason:
            _reject(reason)
            continue
        tier = classify_title_confidence(source)
        if tier == 'high':
            high.append((title, source))
        elif tier == 'medium' and HEURISTIC_ALLOW_MEDIUM:
            medium.append((title, source))
        else:
            _reject('low_confidence')

    for title, source in high + medium:
        key = normalize_name(title)
        if not key or key in seen:
            continue
        if len(accepted) >= cap:
            stats['capped'] += 1
            break
        seen.add(key)
        accepted.append(title)
        if classify_title_confidence(source) == 'high':
            stats['acceptedHigh'] += 1
        else:
            stats['acceptedMedium'] += 1

    stats['accepted'] = len(accepted)
    return accepted, stats
