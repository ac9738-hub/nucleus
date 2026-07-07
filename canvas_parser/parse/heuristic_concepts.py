"""Deterministic concept + type-extraction seeding from PDF blocks and filenames."""

from __future__ import annotations

import hashlib
import os
import re

from canvas_parser.content.page_blocks import compact_block_text
from canvas_parser.content.teaching_blocks import (
    classify_teaching_block,
    extract_teaching_units_from_pages,
)
from canvas_parser.parse.heuristic_guardrails import (
    FILE_TYPE_CAP_OVERRIDES,
    HEURISTIC_MAX_PER_FILE,
    filter_heuristic_titles,
)
from canvas_parser.weekly_iteration.match_utils import normalize_name

PARSER_HEURISTIC_CONCEPTS_ENV = 'PARSER_HEURISTIC_CONCEPTS'
PARSER_SEED_ON_SKIP_PASS1_ENV = 'PARSER_SEED_HEURISTIC_ON_SKIP_PASS1'


def _heuristic_concepts_flag() -> bool:
    return os.getenv(PARSER_HEURISTIC_CONCEPTS_ENV, '0').strip().casefold() in {
        '1', 'true', 'on', 'yes',
    }


# Backward-compatible module constant (evaluated at import; prefer _heuristic_concepts_flag()).
PARSER_HEURISTIC_CONCEPTS = _heuristic_concepts_flag()

NUMBERED_OUTLINE_PATTERN = re.compile(
    r'^(\d+)\s+(\d+)\s+(.+)$',
    re.I,
)
SINGLE_MAJOR_SECTION_PATTERN = re.compile(
    r'^(\d+)\s+1\s+(.+)$',
    re.I,
)
ART_LECTURE_TITLE_PATTERN = re.compile(
    r'(?:^Title:\s*)?ART\s*102\s*(\d+)\.(\d+)\s*:\s*(.+)$',
    re.I,
)
WEEK_FILENAME_PATTERN = re.compile(
    r'\bweek\s*(\d+)\s+(lectures?|worksheets?|precept(?:\s+.+)?)\b',
    re.I,
)
WEEK_TOPIC_PATTERN = re.compile(
    r'^week\s*(\d+)\s+(.+)$',
    re.I,
)
CHAPTER_HEADING_PATTERN = re.compile(
    r'^(?:chapter|ch\.?)\s*(\d+)\s*[:.\-–]?\s*(.+)$',
    re.I,
)
NUMBERED_SECTION_PATTERN = re.compile(
    r'^(\d+(?:\.\d+)+)\s+([A-Z][^.!?]{4,80})$',
)
DOTTED_SECTION_PATTERN = re.compile(
    r'^(\d+(?:\.\d+)+)\s+([A-Za-z][^.!?]{4,80})$',
)
TECH_PREFIX_SECTION_PATTERN = re.compile(
    r'^([A-Za-z]{2,6}\d{0,3}[A-Za-z]?)\s+([a-z][a-z0-9 ,/&()-]{4,60})$',
)
STEM_SHORT_HEADING_PATTERN = re.compile(
    r'^([A-Za-z][A-Za-z0-9 ,/&()\-]{2,48})$',
)
SLIDE_TITLE_MAX_WORDS = 14
SKIP_SLIDE_PATTERN = re.compile(
    r'\b(?:image|detail|view|exterior|interior|aerial|3d model|title slide)\s*$',
    re.I,
)
SYLLABUS_WEEK_LINE_PATTERN = re.compile(
    r'^week\s*(\d+)\s*[:.\-–]\s*(.+?)\s*$',
    re.I,
)
MAT_PAGE_SECTION_PATTERN = re.compile(
    r'^(\d+(?:\.\d+)?)\s+(.+?)(?:\s*page\s*\d+|page\s*\d+)?$',
    re.I,
)
LECTURE_NUMBER_PATTERN = re.compile(r'^lecture\s*(\d+)\b', re.I)
PURE_DIGIT_PATTERN = re.compile(r'^\d{1,3}$')
SKIP_TITLE_PATTERN = re.compile(
    r'^(?:also posted|reminders|study tips|please contact|enrollment|goals|problem\s+\d+)$',
    re.I,
)


def deterministic_preseed_enabled() -> bool:
    """Block/filename concept seeding — only when running heuristic-only parse, not LLM extraction."""
    if os.getenv('PARSER_HEURISTIC_ONLY', '0').strip().casefold() not in {
        '1', 'true', 'on', 'yes',
    }:
        return False
    return _heuristic_concepts_flag()


def heuristic_concepts_enabled() -> bool:
    return deterministic_preseed_enabled()


def should_seed_heuristic_extraction(*, skip_llm_pass1: bool = False) -> bool:
    """Seed deterministic concepts/type rows during heuristic-only or skip-pass1 paths."""
    if heuristic_concepts_enabled():
        return True
    if skip_llm_pass1 and os.getenv(PARSER_SEED_ON_SKIP_PASS1_ENV, '1').strip().casefold() in {
        '1', 'true', 'on', 'yes',
    }:
        return True
    return False


def _clean_title(text: str, *, max_length: int = 120) -> str:
    cleaned = compact_block_text(str(text or ''), max_length)
    return cleaned.strip(' -:–')


def _add_unique(names: list[str], seen: set[str], raw: str) -> None:
    title = _clean_title(raw)
    key = normalize_name(title)
    if not title or not key or key in seen:
        return
    if PURE_DIGIT_PATTERN.match(title.strip()) or SKIP_TITLE_PATTERN.match(title.strip()):
        return
    seen.add(key)
    names.append(title)


def titles_from_filename(filename: str) -> list[str]:
    """Week shells and obvious stems from Canvas filenames."""
    name = str(filename or '')
    stem = re.sub(r'\.[a-z0-9]{1,5}$', '', name, flags=re.I).strip()
    titles: list[str] = []
    seen: set[str] = set()
    match = WEEK_FILENAME_PATTERN.search(stem)
    if match:
        week = int(match.group(1))
        kind = match.group(2).strip().lower()
        if kind.startswith('lecture'):
            _add_unique(titles, seen, f'week {week} lectures')
        elif kind.startswith('worksheet'):
            _add_unique(titles, seen, f'week {week} worksheets')
        elif kind.startswith('precept'):
            _add_unique(titles, seen, f'week {week} {kind}')
    if stem and len(stem.split()) <= 8 and not seen:
        lowered = stem.casefold()
        if 'lecture' in lowered or 'worksheet' in lowered or 'precept' in lowered:
            _add_unique(titles, seen, stem)
    return titles


def _add_unique_tagged(
    out: list[tuple[str, str]],
    seen: set[str],
    raw: str,
    source: str,
) -> None:
    title = _clean_title(raw)
    key = normalize_name(title)
    if not title or not key or key in seen:
        return
    if PURE_DIGIT_PATTERN.match(title.strip()) or SKIP_TITLE_PATTERN.match(title.strip()):
        return
    seen.add(key)
    out.append((title, source))


def titles_from_block_text(text: str) -> list[tuple[str, str]]:
    raw = _clean_title(text, max_length=200)
    if not raw or len(raw) < 3:
        return []
    titles: list[tuple[str, str]] = []
    seen: set[str] = set()

    match = NUMBERED_OUTLINE_PATTERN.match(raw)
    if match:
        _add_unique_tagged(
            titles, seen,
            f"{match.group(1)} {match.group(2)} {match.group(3).strip().lower()}",
            'numbered_outline',
        )

    match = SINGLE_MAJOR_SECTION_PATTERN.match(raw)
    if match:
        _add_unique_tagged(
            titles, seen,
            f"{match.group(1)} 1 {match.group(2).strip().lower()}",
            'single_major_section',
        )

    match = ART_LECTURE_TITLE_PATTERN.search(raw)
    if match:
        _add_unique_tagged(
            titles,
            seen,
            f"{match.group(1)} {match.group(2)} {match.group(3).strip().lower()}",
            'art_lecture',
        )

    match = CHAPTER_HEADING_PATTERN.match(raw)
    if match:
        chapter = match.group(2).strip()
        if chapter:
            _add_unique_tagged(
                titles, seen,
                f"chapter {match.group(1)} {chapter.lower()}",
                'chapter',
            )

    match = NUMBERED_SECTION_PATTERN.match(raw)
    if match:
        _add_unique_tagged(
            titles, seen,
            f"{match.group(1)} {match.group(2).strip().lower()}",
            'numbered_section',
        )

    match = DOTTED_SECTION_PATTERN.match(raw)
    if match:
        parts = match.group(1).split('.')
        body = match.group(2).strip().lower()
        if len(parts) >= 2:
            _add_unique_tagged(
                titles, seen,
                f"{parts[0]} {parts[1]} {body}",
                'numbered_outline',
            )
        else:
            _add_unique_tagged(titles, seen, f"{match.group(1)} {body}", 'numbered_section')

    match = TECH_PREFIX_SECTION_PATTERN.match(raw)
    if match and raw.lower() == raw:
        _add_unique_tagged(
            titles, seen,
            f"{match.group(1).lower()} {match.group(2).strip().lower()}",
            'numbered_section',
        )

    match = MAT_PAGE_SECTION_PATTERN.match(raw)
    if match:
        topic = match.group(2).strip()
        if topic and re.search(r'[a-zA-Z]{3,}', topic) and len(topic.split()) >= 2:
            _add_unique_tagged(
                titles, seen,
                f"{match.group(1)} {topic.lower()}",
                'mat_section',
            )

    match = LECTURE_NUMBER_PATTERN.match(raw)
    if match:
        _add_unique_tagged(titles, seen, f"lecture {match.group(1)}", 'lecture_number')

    if ':' in raw and 2 <= len(raw.split()) <= 12:
        head, tail = raw.split(':', 1)
        tail = tail.strip()
        if tail and len(head.split()) <= 4 and not SKIP_SLIDE_PATTERN.search(tail):
            _add_unique_tagged(titles, seen, tail.lower(), 'colon_tail')

    if (
        len(raw.split()) <= 8
        and STEM_SHORT_HEADING_PATTERN.match(raw)
        and not raw.endswith(':')
        and not SKIP_SLIDE_PATTERN.search(raw)
    ):
        _add_unique_tagged(titles, seen, raw.lower(), 'stem_short_heading')

    return titles


def extract_lecture_slide_rows_from_pages(pages, *, filename: str = '') -> list[dict]:
    rows: list[dict] = []
    seen_titles: set[str] = set()
    order = 0
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        blocks = page.get('blocks') if isinstance(page.get('blocks'), list) else []
        if not blocks:
            line_iter = [
                {'text': part}
                for part in re.split(r'\n+', compact_block_text(page.get('text', ''), 4000))
                if part.strip()
            ]
        else:
            line_iter = blocks
        for block in line_iter:
            if not isinstance(block, dict):
                continue
            text = str(block.get('text') or '')
            classified = classify_teaching_block(text)
            candidate_texts = [text]
            if classified and classified.get('name'):
                candidate_texts.append(str(classified['name']))
            for candidate in candidate_texts:
                for title, source in titles_from_block_text(candidate):
                    key = normalize_name(title)
                    if key in seen_titles:
                        continue
                    if len(title.split()) > SLIDE_TITLE_MAX_WORDS:
                        continue
                    seen_titles.add(key)
                    order += 1
                    rows.append({
                        'slideOrder': order,
                        'title': title,
                        'summary': compact_block_text(text, 240),
                        'pageid': page.get('pageid', ''),
                        'pageNumber': page.get('pageNumber', ''),
                        'heuristicSource': source,
                    })
    for title in titles_from_filename(filename):
        key = normalize_name(title)
        if key in seen_titles:
            continue
        seen_titles.add(key)
        order += 1
        rows.append({
            'slideOrder': order,
            'title': title,
            'summary': '',
            'pageid': '',
            'pageNumber': '',
            'heuristicSource': 'week_filename',
        })
    return rows


def extract_syllabus_week_rows(pages) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        raw_text = str(page.get('text') or '')
        line_sources = re.split(r'[\r\n]+', raw_text) if raw_text else []
        if not line_sources:
            line_sources = re.split(r'[\r\n]+', compact_block_text(page.get('text', ''), 12000))
        for line in line_sources:
            match = SYLLABUS_WEEK_LINE_PATTERN.match(line.strip())
            if not match:
                continue
            week_number = int(match.group(1))
            topic = _clean_title(match.group(2), max_length=100)
            if not topic:
                continue
            title = f'week {week_number} {topic.lower()}'
            key = normalize_name(title)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                'weekNumber': week_number,
                'topic': topic,
                'title': title,
                'pageid': page.get('pageid', ''),
                'pageNumber': page.get('pageNumber', ''),
            })
    return rows


def extract_reading_section_rows(pages) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for unit in extract_teaching_units_from_pages(pages or []):
        if unit.get('type') not in {'section', 'concept'}:
            continue
        name = _clean_title(unit.get('name', ''))
        key = normalize_name(name)
        if not name or key in seen:
            continue
        seen.add(key)
        rows.append({
            'label': name,
            'pageid': unit.get('pageid', ''),
            'pageNumber': unit.get('pageNumber', ''),
        })
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        for block in page.get('blocks') or []:
            if not isinstance(block, dict):
                continue
            for title in titles_from_block_text(block.get('text', '')):
                key = normalize_name(title[0])
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    'label': title[0],
                    'pageid': page.get('pageid', ''),
                    'pageNumber': page.get('pageNumber', ''),
                    'heuristicSource': title[1],
                })
    return rows


def extract_heuristic_concept_titles(
    *,
    filename: str = '',
    pages=None,
    file_type: str = '',
) -> list[str]:
    """High-confidence concept title candidates without LLM (guardrail-filtered)."""
    candidates: list[tuple[str, str]] = []
    seen: set[str] = set()
    file_type = str(file_type or '').strip()

    for title in titles_from_filename(filename):
        key = normalize_name(title)
        if key and key not in seen:
            seen.add(key)
            candidates.append((title, 'week_filename'))

    slide_rows = extract_lecture_slide_rows_from_pages(pages or [], filename=filename)
    for row in slide_rows:
        title = str(row.get('title') or '')
        source = str(row.get('heuristicSource') or 'slide_classified')
        key = normalize_name(title)
        if title and key and key not in seen:
            seen.add(key)
            candidates.append((title, source))

    if file_type in {'humanities_reading', 'literary_work', 'research_article', 'textbook_chapter'}:
        for row in extract_reading_section_rows(pages):
            label = str(row.get('label') or '')
            source = str(row.get('heuristicSource') or 'teaching_unit')
            key = normalize_name(label)
            if label and key and key not in seen:
                seen.add(key)
                candidates.append((label, source))

    if file_type in {
        'lecture_slides', 'lecture_notes', 'generic_content',
        'discussion_prompt', 'problem_set', 'past_exam', 'exam_solution', 'review_sheet',
    }:
        for unit in extract_teaching_units_from_pages(pages or []):
            if unit.get('type') in {'section', 'concept', 'problem'}:
                name = str(unit.get('name') or unit.get('label') or '')
                key = normalize_name(name)
                if name and key and key not in seen:
                    seen.add(key)
                    candidates.append((name, 'teaching_unit'))

    if file_type in {'syllabus', 'administrative', 'generic_content'}:
        for row in extract_syllabus_week_rows(pages):
            title = str(row.get('title') or '')
            key = normalize_name(title)
            if title and key and key not in seen:
                seen.add(key)
                candidates.append((title, 'week_syllabus'))

    accepted, _stats = filter_heuristic_titles(
        candidates,
        max_count=FILE_TYPE_CAP_OVERRIDES.get(file_type, HEURISTIC_MAX_PER_FILE),
    )
    return accepted


def build_heuristic_type_extractions(
    *,
    filename: str = '',
    pages=None,
    file_type: str = '',
) -> dict:
    store: dict = {}
    file_type = str(file_type or '').strip()
    slides = extract_lecture_slide_rows_from_pages(pages or [], filename=filename)
    if slides:
        store.setdefault('lecture', {})['slides'] = slides
    sections = extract_reading_section_rows(pages)
    if sections and file_type in {'humanities_reading', 'literary_work', 'research_article'}:
        store.setdefault('reading', {})['sections'] = [
            {'label': row['label'], 'pageid': row.get('pageid', ''), 'pageNumber': row.get('pageNumber', '')}
            for row in sections
        ]
    weeks = extract_syllabus_week_rows(pages)
    if weeks and file_type in {'syllabus', 'administrative', 'generic_content'}:
        store.setdefault('syllabus', {})['weeks'] = [
            {
                'weekNumber': row['weekNumber'],
                'topic': row.get('topic', ''),
                'pageid': row.get('pageid', ''),
                'pageNumber': row.get('pageNumber', ''),
            }
            for row in weeks
        ]
    return store


def _concept_id(course_id: str, file_id: str, title: str, index: int) -> str:
    digest = hashlib.sha1(f'{course_id}:{file_id}:{title}'.encode('utf-8')).hexdigest()[:16]
    return f'heuristic-{course_id}-{digest}-{index}'


def concept_dicts_from_titles(
    course_id: str,
    file_id: str,
    titles: list[str],
    *,
    sequence_start: int = 0,
) -> list[dict]:
    concepts: list[dict] = []
    for offset, title in enumerate(titles):
        concepts.append({
            'courseid': str(course_id),
            'conceptid': _concept_id(course_id, file_id, title, offset),
            'name': title,
            'description': '',
            'details': [],
            'examples': [],
            'problems': [],
            'aliases': [],
            'prerequisiteConceptIds': [],
            'moduleOrderHints': [],
            'documentOrder': {
                'fileId': str(file_id),
                'sequenceIndex': sequence_start + offset,
            },
            'embedded': {},
            'sourcePages': [],
            'heuristicSource': True,
        })
    return concepts


def merge_type_extractions(existing: dict | None, seeded: dict) -> dict:
    base = dict(existing or {})
    for category, payload in (seeded or {}).items():
        if not isinstance(payload, dict):
            continue
        current = dict(base.get(category) or {})
        for key, rows in payload.items():
            if not isinstance(rows, list):
                continue
            prior = list(current.get(key) or [])
            seen = {
                normalize_name(
                    str((row or {}).get('title') or (row or {}).get('label') or '')
                )
                for row in prior
                if isinstance(row, dict)
            }
            for row in rows:
                if not isinstance(row, dict):
                    continue
                label = str(row.get('title') or row.get('label') or '')
                key_name = normalize_name(label)
                if not key_name or key_name in seen:
                    continue
                seen.add(key_name)
                prior.append(row)
            current[key] = prior
        base[category] = current
    return base
