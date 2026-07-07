"""Structural teaching-unit detection from positioned PDF/HTML page blocks."""
from __future__ import annotations

import re
from html import unescape

from canvas_parser.content.page_blocks import compact_block_text

SECTION_PATTERNS = (
    re.compile(r'^(?:section|sec\.?)\s*[\d.]+(?:\s*[-:–]\s*|\s+)(.+)$', re.I),
    re.compile(r'^(?:chapter|ch\.?)\s*(\d+)\s*(.+)?$', re.I),
    re.compile(r'^(\d+)\s+(\d+)\s+(.+)$', re.I),
    re.compile(r'^(\d+)\s+1\s+(.+)$', re.I),
    re.compile(r'^(\d+\.\d+)\s+([A-Z][^.!?]{4,80})$'),
    re.compile(r'^(?:exercises?|ex\.?)\s*([\d.]+)\s*$', re.I),
    re.compile(r'^week\s*(\d+)\s*[:.\-–]\s*(.+)$', re.I),
    re.compile(r'^week\s*(\d+)\b', re.I),
    re.compile(r'^lecture\s*(\d+)\b', re.I),
    re.compile(r'^lecture\s*\d+[_:\s-]+(.+)$', re.I),
    re.compile(r'^(?:precept|reading|homework|quiz|lab)\s*\d+\b', re.I),
    re.compile(r'^part\s*(\d+)\b', re.I),
    re.compile(r'^unit\s*(\d+)\b', re.I),
    re.compile(r'^(\d+)\.\s+([A-Z][A-Za-z0-9 ,/&-]{4,80})$'),
)

EXAMPLE_PATTERNS = (
    re.compile(r'^(?:example|worked example)\s*[-:–]?\s*(.+)$', re.I),
    re.compile(r'^(\d+\.\d+)\s+example[\s:-]+(.+)$', re.I),
)

PROBLEM_PATTERNS = (
    re.compile(r'^(?:problem|exercise|question|ex\.?|q\.?)\s*[#.]?\s*(\d+[\w.]*)', re.I),
    re.compile(r'^(\d{1,2})\.\s+(?=[A-Za-z(\\[{<])'),
)

CONCEPT_PATTERNS = (
    re.compile(r'^goal\s+(.+)$', re.I),
    re.compile(r'^([A-Z][A-Za-z0-9 ,/&-]{3,60}):\s*$'),
)

SKIP_PATTERNS = (
    re.compile(r'^(?:enrollment|please contact|slides and lecture|hw\d+|first\b)', re.I),
    re.compile(r'^(?:the|second edition|at&t|murray hill)', re.I),
    re.compile(r'^(?:adrian|alex)\b', re.I),
    re.compile(r'^(?:outline of today|lecture recording)\b', re.I),
    re.compile(r'^[A-Z]{1,3}$'),
    re.compile(r'^[!\\/{}\[\]().,+\-=*]+$'),
)


def _clean_label(text, max_length=120):
    cleaned = compact_block_text(text, max_length)
    cleaned = re.sub(r'(?<=[A-Za-z])\d{1,3}$', '', cleaned).strip(' -:–')
    return cleaned


def _match_named(patterns, text):
    for pattern in patterns:
        match = pattern.match(text)
        if not match:
            continue
        groups = [group.strip() for group in match.groups() if group and str(group).strip()]
        if groups:
            return _clean_label(' '.join(groups))
        return _clean_label(text)
    return ''


def classify_teaching_block(text):
    raw = compact_block_text(text, 600)
    if not raw or len(raw) < 3:
        return None
    if any(pattern.match(raw) for pattern in SKIP_PATTERNS):
        return None
    if len(raw) > 220 and not PROBLEM_PATTERNS[0].match(raw):
        return None

    example_name = _match_named(EXAMPLE_PATTERNS, raw)
    if example_name:
        return {'type': 'example', 'name': example_name, 'snippet': raw[:240], 'contextText': raw[:1200]}

    problem_name = _match_named(PROBLEM_PATTERNS, raw)
    if problem_name:
        return {
            'type': 'problem',
            'name': f"Problem {problem_name}",
            'snippet': raw[:240],
            'contextText': raw[:1200],
        }

    section_name = _match_named(SECTION_PATTERNS, raw)
    if section_name:
        return {'type': 'section', 'name': section_name, 'snippet': raw[:240], 'contextText': raw[:1200]}

    concept_name = _match_named(CONCEPT_PATTERNS, raw)
    if concept_name:
        return {'type': 'concept', 'name': concept_name, 'snippet': raw[:240], 'contextText': raw[:1200]}

    if raw.endswith(':') and 4 <= len(raw) <= 80:
        name = raw.rstrip(':').strip()
        return {'type': 'concept', 'name': name, 'snippet': raw[:240], 'contextText': raw[:1200]}

    return None


def extract_teaching_units_from_pages(pages, max_units=400):
    units = []
    seen = set()
    sequence_index = 0
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        pageid = str(page.get('pageid') or '')
        page_number = page.get('pageNumber') or ''
        blocks = page.get('blocks') if isinstance(page.get('blocks'), list) else []
        if blocks:
            iterable = blocks
        else:
            page_text = compact_block_text(page.get('text', ''), 4000)
            iterable = [{'text': part} for part in re.split(r'\n+', unescape(page_text)) if part.strip()]
        for block in iterable:
            if not isinstance(block, dict):
                continue
            classified = classify_teaching_block(block.get('text', ''))
            if not classified:
                continue
            key = (classified['type'], classified['name'].casefold())
            if key in seen:
                continue
            seen.add(key)
            units.append({
                **classified,
                'pageid': pageid,
                'pageNumber': page_number,
                'sequenceIndex': sequence_index,
                'y0': block.get('y0'),
                'yRatio0': block.get('yRatio0'),
            })
            sequence_index += 1
            if len(units) >= max_units:
                return units
    return units


def summarize_teaching_units(units, max_chars=6000):
    if not units:
        return ''
    lines = [
        'Structured teaching outline detected in this file (use as a checklist; extract every unit):',
    ]
    chars = len(lines[0])
    for unit in units:
        line = (
            f"- [{unit['type']}] {unit['name']}"
            f" (pageid={unit.get('pageid', '')}, page={unit.get('pageNumber', '')})"
        )
        if chars + len(line) > max_chars:
            break
        lines.append(line)
        chars += len(line)
    return '\n'.join(lines)


def infer_parent_concept_name(units, index, fallback='Course Content'):
    for cursor in range(index - 1, -1, -1):
        unit = units[cursor]
        if unit.get('type') in {'section', 'concept'}:
            return unit.get('name') or fallback
    return fallback


def normalize_teaching_label(text):
    cleaned = _clean_label(text, 160)
    cleaned = re.sub(r'^(?:section|sec\.?|chapter|ch\.?|example|problem|exercise|question)\s*', '', cleaned, flags=re.I)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned.casefold()


PROBLEM_KIND_TOKENS = {'problem', 'exercise', 'question', 'ex', 'q'}


def _problem_kind(text):
    tokens = set(re.findall(r'[a-z]+', normalize_teaching_label(text)))
    return bool(tokens & PROBLEM_KIND_TOKENS)


def teaching_labels_match(expected_name, extracted_name):
    left = normalize_teaching_label(expected_name)
    right = normalize_teaching_label(extracted_name)
    if not left or not right:
        return False
    if left == right:
        return True
    if left in right or right in left:
        return True

    left_num = re.search(r'\b(\d+)\b', left)
    right_num = re.search(r'\b(\d+)\b', right)
    if left_num and right_num and left_num.group(1) == right_num.group(1):
        if _problem_kind(left) and _problem_kind(right):
            return True
        left_kind = re.sub(r'\d+', '', left).strip()
        right_kind = re.sub(r'\d+', '', right).strip()
        if left_kind and right_kind and (left_kind in right_kind or right_kind in left_kind):
            return True

    left_tokens = set(re.findall(r'[a-z0-9]{3,}', left))
    right_tokens = set(re.findall(r'[a-z0-9]{3,}', right))
    if not left_tokens or not right_tokens:
        return False
    overlap = len(left_tokens & right_tokens)
    shorter = min(len(left_tokens), len(right_tokens))
    return overlap >= max(2, shorter - 1) or (shorter <= 2 and overlap >= 1)
