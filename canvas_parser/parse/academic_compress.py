"""Conservative, deterministic academic text normalization before pass-1 LLM calls.

Strips high-confidence boilerplate (page numbers, copyright lines, repeated
headers/footers/captions, bibliography blocks) without LLM summarization.
"""
from __future__ import annotations

import os
import re
from collections import Counter

from canvas_parser.parse.keyword_extract import DATE_PATTERN, PAGE_MARKER_PATTERN, parse_page_segments

PAGE_NUMBER_LINE = re.compile(
    r'^\s*(?:page\s*)?(\d{1,4})(?:\s*(?:/|of)\s*(\d{1,4}))?\s*$',
    re.I,
)
COPYRIGHT_LINE = re.compile(
    r'(?:©|\(c\)|copyright|all rights reserved|permission(?:s)? (?:is )?granted|isbn[\s:-]*[\d\-x]+)',
    re.I,
)
BIBLIOGRAPHY_HEADING = re.compile(
    r'^\s*(?:references|bibliography|works cited|literature cited)\s*:?\s*$',
    re.I,
)
FIGURE_TABLE_CAPTION = re.compile(
    r'^\s*(?:figure|fig\.|table|tab\.)\s*\d+\b',
    re.I,
)
CITATION_LIKE = re.compile(
    r'et al\.|\[\d+\]|doi:|https?://|\bpp\.\s*\d|\(\d{4}\)|vol\.\s*\d|arxiv:',
    re.I,
)
READING_LIST_HINT = re.compile(
    r'\b(?:chapter|ch\.|reading|assignment|week\s*\d|due|required text|course reader)\b',
    re.I,
)
SCHEDULE_HINT = re.compile(
    r'\b(?:syllabus|grading|office hours|midterm|final exam|problem set|pset|%\s*of)\b',
    re.I,
)


def academic_normalize_enabled():
    return os.getenv('PARSER_ACADEMIC_NORMALIZE', '1').strip().casefold() not in {
        '0', 'false', 'off', 'no',
    }


def header_footer_page_ratio():
    return float(os.getenv('PARSER_ACADEMIC_HEADER_FOOTER_RATIO', '0.55'))


def is_protected_line(line: str) -> bool:
    text = str(line or '').strip()
    if not text:
        return False
    if len(text) > 260:
        return True
    if DATE_PATTERN.search(text):
        return True
    if '%' in text:
        return True
    if SCHEDULE_HINT.search(text):
        return True
    if READING_LIST_HINT.search(text):
        return True
    return False


def split_body_lines(body: str) -> list[str]:
    return str(body or '').splitlines()


def detect_header_footer_lines(page_bodies: list[str]) -> set[str]:
    counts: Counter[str] = Counter()
    page_count = max(len(page_bodies), 1)
    for body in page_bodies:
        seen_on_page = set()
        for line in split_body_lines(body):
            stripped = ' '.join(line.split())
            if not stripped or len(stripped) > 100 or is_protected_line(stripped):
                continue
            if stripped not in seen_on_page:
                counts[stripped] += 1
                seen_on_page.add(stripped)
    threshold = max(3, int(page_count * header_footer_page_ratio()))
    return {line for line, count in counts.items() if count >= threshold}


def looks_like_bibliography_block(following_lines: list[str]) -> bool:
    sample = '\n'.join(following_lines[:10])
    if not sample.strip():
        return False
    if READING_LIST_HINT.search(sample):
        return False
    if SCHEDULE_HINT.search(sample):
        return False
    citation_hits = len(CITATION_LIKE.findall(sample))
    return citation_hits >= 2


def clean_page_lines(
    lines: list[str],
    *,
    header_footer_lines: set[str],
    seen_captions: set[str],
    in_bibliography: bool,
) -> tuple[list[str], bool]:
    cleaned: list[str] = []
    prev_stripped = ''
    bibliography = in_bibliography

    for line in lines:
        stripped = ' '.join(str(line or '').split())
        if not stripped:
            if cleaned and cleaned[-1] != '':
                cleaned.append('')
            continue

        if bibliography:
            continue

        if BIBLIOGRAPHY_HEADING.match(stripped):
            tail = []
            tail_started = False
            for future in lines:
                future_stripped = ' '.join(str(future or '').split())
                if not tail_started:
                    if future_stripped == stripped:
                        tail_started = True
                    continue
                if future_stripped:
                    tail.append(future_stripped)
            if looks_like_bibliography_block(tail):
                bibliography = True
                continue

        if is_protected_line(stripped):
            cleaned.append(stripped)
            prev_stripped = stripped
            continue

        if PAGE_NUMBER_LINE.match(stripped):
            continue

        if COPYRIGHT_LINE.search(stripped) and len(stripped) < 220:
            continue

        if stripped in header_footer_lines:
            continue

        if prev_stripped and stripped == prev_stripped and len(stripped) < 160:
            continue

        caption_key = stripped.casefold()
        if FIGURE_TABLE_CAPTION.match(stripped):
            if caption_key in seen_captions:
                continue
            seen_captions.add(caption_key)

        cleaned.append(stripped)
        prev_stripped = stripped

    while cleaned and cleaned[-1] == '':
        cleaned.pop()
    return cleaned, bibliography


def normalize_page_body(
    body: str,
    *,
    header_footer_lines: set[str],
    seen_captions: set[str],
    in_bibliography: bool,
) -> tuple[str, bool, int]:
    before = str(body or '')
    cleaned_lines, bibliography = clean_page_lines(
        split_body_lines(before),
        header_footer_lines=header_footer_lines,
        seen_captions=seen_captions,
        in_bibliography=in_bibliography,
    )
    after = '\n'.join(cleaned_lines).strip()
    removed = max(0, len(before) - len(after))
    return after, bibliography, removed


def normalize_academic_prompt(prompt_text: str) -> tuple[str, dict]:
    """Return normalized prompt text and stats."""
    text = str(prompt_text or '')
    stats = {
        'normalized': False,
        'input_chars': len(text),
        'output_chars': len(text),
        'removed_chars': 0,
        'removed_lines': 0,
        'pages_processed': 0,
        'bibliography_stripped': False,
        'skipped': None,
    }
    if not text.strip() or not academic_normalize_enabled():
        stats['skipped'] = 'disabled'
        return text, stats

    segments = parse_page_segments(text)
    if not segments:
        header_footer_lines: set[str] = set()
        seen_captions: set[str] = set()
        cleaned, bibliography, removed = normalize_page_body(
            text,
            header_footer_lines=header_footer_lines,
            seen_captions=seen_captions,
            in_bibliography=False,
        )
        stats.update({
            'normalized': removed > 0 or bibliography,
            'output_chars': len(cleaned),
            'removed_chars': max(0, len(text) - len(cleaned)),
            'bibliography_stripped': bibliography,
            'pages_processed': 1,
        })
        return cleaned, stats

    bodies = [str(segment.get('body') or '') for segment in segments]
    header_footer_lines = detect_header_footer_lines(bodies)
    seen_captions: set[str] = set()
    in_bibliography = False
    output_parts: list[str] = []
    removed_total = 0

    for segment in segments:
        marker = segment.get('marker') or ''
        body = str(segment.get('body') or '')
        cleaned_body, in_bibliography, removed = normalize_page_body(
            body,
            header_footer_lines=header_footer_lines,
            seen_captions=seen_captions,
            in_bibliography=in_bibliography,
        )
        removed_total += removed
        if marker:
            output_parts.append(marker)
        if cleaned_body:
            output_parts.append(cleaned_body)

    output = '\n\n'.join(part for part in output_parts if part)
    stats.update({
        'normalized': removed_total > 0 or in_bibliography,
        'output_chars': len(output),
        'removed_chars': max(0, len(text) - len(output)),
        'bibliography_stripped': in_bibliography,
        'pages_processed': len(segments),
        'header_footer_lines': len(header_footer_lines),
    })
    return output, stats
