"""Parser speed/safety helpers — env-tunable, no side effects."""

from __future__ import annotations

import os
import re

DEFAULT_PASS1_MAX_TOKENS = int(os.getenv('PARSER_PASS1_MAX_PROMPT_TOKENS', '200000'))
CHARS_PER_TOKEN = float(os.getenv('PARSER_CHARS_PER_TOKEN', '4'))


def pass1_max_prompt_tokens():
    return int(os.getenv('PARSER_PASS1_MAX_PROMPT_TOKENS', str(DEFAULT_PASS1_MAX_TOKENS)))


def pass1_max_prompt_chars():
    explicit = os.getenv('PARSER_PASS1_MAX_PROMPT_CHARS', '').strip()
    if explicit:
        return int(explicit)
    return int(pass1_max_prompt_tokens() * CHARS_PER_TOKEN)


PASS1_MAX_PROMPT_CHARS = pass1_max_prompt_chars()
PASS1_MAX_PAGES = int(os.getenv('PARSER_PASS1_MAX_PAGES', '120'))
PASS1_LINKED_MAX_PAGES = int(os.getenv('PARSER_PASS1_LINKED_MAX_PAGES', '40'))
PARSER_LINKED_FILE_MODE = os.getenv('PARSER_LINKED_FILE_MODE', 'light').strip().casefold()

LOG_TOOL_PREFIX = 'log_'
IMAGE_EXTENSIONS = frozenset({'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'})
MALFORMED_EVENT_NAME = re.compile(r'eventid$|eventnodeid$', re.I)

TYPE_SPECIFIC_LOG_PREFIXES = (
    'log_literary_',
    'log_article_',
    'log_reading_',
    'log_discussion_',
    'log_lecture_',
    'log_textbook_',
    'log_syllabus_',
)


def estimate_prompt_chars(*, pages=None, prompt_text='', pages_to_text=None):
    if pages:
        to_text = pages_to_text or (lambda rows: '\n'.join(str(row.get('text', '') or '') for row in rows))
        return len(to_text(pages or []))
    return len(str(prompt_text or ''))


def prompt_over_budget(*, pages=None, prompt_text='', max_pages=None, max_chars=None, pages_to_text=None):
    max_pages = PASS1_MAX_PAGES if max_pages is None else max_pages
    max_chars = pass1_max_prompt_chars() if max_chars is None else max_chars
    page_count = len(pages or [])
    if page_count > max_pages:
        return True
    return estimate_prompt_chars(pages=pages, prompt_text=prompt_text, pages_to_text=pages_to_text) > max_chars


def trim_pages_for_pass1(pages, *, max_pages=None, max_chars=None, pages_to_text=None):
    rows = list(pages or [])
    if not rows:
        return rows, False
    max_pages = PASS1_MAX_PAGES if max_pages is None else max_pages
    max_chars = pass1_max_prompt_chars() if max_chars is None else max_chars
    truncated = False
    if len(rows) > max_pages:
        rows = rows[:max_pages]
        truncated = True
    to_text = pages_to_text or (lambda chunk: '\n'.join(str(row.get('text', '') or '') for row in chunk))
    while rows and len(to_text(rows)) > max_chars:
        rows = rows[:-1]
        truncated = True
    return rows, truncated


def is_type_specific_log_tool_name(name):
    text = str(name or '')
    return any(text.startswith(prefix) for prefix in TYPE_SPECIFIC_LOG_PREFIXES)


def pass1_needs_pass2(tool_names, *, profile_pass2=False, profile=None):
    names = [str(name or '') for name in (tool_names or [])]
    log_tools = [name for name in names if name.startswith(LOG_TOOL_PREFIX)]
    # Problem-only pass1 (log_problem) completes in one pass — no detail promotion pass2.
    if profile is not None and profile.extract_problems and not profile.extract_concepts:
        if log_tools and all(name == 'log_problem' for name in log_tools):
            return False
    if any(
        name.startswith(LOG_TOOL_PREFIX) and not is_type_specific_log_tool_name(name)
        for name in names
    ):
        return True
    # Type-specific pass1 tools write to typeExtractions; deterministic promote replaces pass2 LLM.
    if profile_pass2 and log_tools:
        if all(is_type_specific_log_tool_name(name) for name in log_tools):
            return False
        return True
    return False


def is_malformed_event_link_name(name):
    text = str(name or '').strip()
    if not text:
        return True
    if MALFORMED_EVENT_NAME.search(text):
        return True
    if 'eventid' in text.casefold() and len(text) < 24:
        return True
    return False


def sanitize_event_link_name(name, canonical_fn):
    raw = str(name or '').strip()
    if not raw:
        return ''
    if is_malformed_event_link_name(raw):
        return canonical_fn(raw) or raw
    return raw


def linked_file_mode():
    mode = PARSER_LINKED_FILE_MODE or 'light'
    if mode not in {'light', 'full', 'off'}:
        return 'light'
    return mode


def should_skip_llm_for_image(filename='', content_type=''):
    lowered = str(filename or '').casefold()
    for suffix in IMAGE_EXTENSIONS:
        if lowered.endswith(suffix):
            return True
    ctype = str(content_type or '').casefold()
    return ctype.startswith('image/')


def linked_discovered_pass1_only():
    return linked_file_mode() == 'light'


def linked_discovered_use_pass1_only(
    filename='',
    content_type='',
    file_size=0,
    *,
    is_study_material=False,
):
    """Light mode: pass1-only for small/study linked files; full pass2 for substantive PDFs."""
    if linked_file_mode() != 'light':
        return False
    if linked_discovered_skip_llm(filename, content_type, file_size):
        return False
    if should_skip_llm_for_image(filename, content_type):
        return True
    if is_study_material:
        return True
    if file_size and int(file_size) < 100_000:
        return True
    return False


CANVAS_FILE_ID_PATTERN = re.compile(r'/files/(\d+)', re.I)


def page_is_link_hub(body_html='', body_text='', *, min_links=2, max_text_chars=900):
    """True when a module page is mostly Canvas file links (parse PDFs instead)."""
    html = str(body_html or '')
    text = re.sub(r'\s+', ' ', str(body_text or '')).strip()
    link_count = len(set(CANVAS_FILE_ID_PATTERN.findall(html)))
    if link_count < min_links:
        return False
    if len(text) <= max_text_chars:
        return True
    return link_count >= 4 and len(text) < max_text_chars * 2


def linked_discovered_skip_llm(filename='', content_type='', file_size=0):
    if linked_file_mode() == 'off':
        return True
    if should_skip_llm_for_image(filename, content_type):
        return True
    if file_size and int(file_size) < 50_000:
        return True
    return False


def linked_file_uses_light_llm(
    filename='',
    content_type='',
    study_material_classification=None,
    linked_discovered=False,
    file_size=0,
):
    if linked_file_mode() != 'light':
        return False
    if linked_discovered:
        return linked_discovered_use_pass1_only(
            filename,
            content_type,
            file_size,
            is_study_material=bool(study_material_classification),
        )
    if should_skip_llm_for_image(filename, content_type):
        return True
    return bool(study_material_classification)


def is_non_fatal_llm_error(error):
    message = str(error or '').casefold()
    if 'insufficient balance' in message or 'error code: 402' in message:
        return False
    if 'maximum context length' in message or 'context length is' in message:
        return True
    if 'context length exceeded' in message or 'token limit' in message:
        return True
    if '429' in message or 'rate limit' in message or 'too many requests' in message:
        return True
    if 'invalid_request_error' in message and ('400' in message or 'context' in message):
        return True
    return False
