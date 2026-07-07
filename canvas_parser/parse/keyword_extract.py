"""Extract salient excerpts from long documents before pass-1 LLM calls."""

from __future__ import annotations

import math
import os
import re
from collections import Counter

PAGE_MARKER_PATTERN = re.compile(r'(\[\[PAGE[^\]]+\]\])', re.MULTILINE)
DATE_PATTERN = re.compile(
    r'\b(?:'
    r'(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}'
    r'|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?'
    r'|\d{4}-\d{2}-\d{2}'
    r')\b',
    re.I,
)
HEADING_PATTERN = re.compile(
    r'^(?:chapter|week|section|lecture|module|unit|part|assignment|homework|problem set|ps\s*\d|quiz|exam|midterm|final)\b',
    re.I,
)
SENTENCE_SPLIT_PATTERN = re.compile(r'(?<=[.!?])\s+|\n{2,}')

STOPWORDS = frozenset({
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
    'he', 'her', 'his', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the',
    'their', 'there', 'they', 'this', 'to', 'was', 'we', 'were', 'will', 'with',
    'you', 'your', 'our', 'not', 'but', 'can', 'may', 'also', 'into', 'than', 'then',
    'when', 'where', 'which', 'who', 'whom', 'what', 'how', 'all', 'any', 'each',
    'such', 'only', 'other', 'some', 'more', 'most', 'very', 'just', 'about', 'after',
    'before', 'between', 'during', 'through', 'under', 'over', 'both', 'been', 'being',
    'do', 'does', 'did', 'done', 'should', 'would', 'could', 'shall', 'must', 'if',
    'because', 'while', 'these', 'those', 'them', 'she', 'him', 'us', 'up', 'out',
})

ACADEMIC_BOOST_TERMS = frozenset({
    'assignment', 'assignments', 'exam', 'exams', 'midterm', 'final', 'quiz', 'quizzes',
    'syllabus', 'deadline', 'due', 'grade', 'grading', 'rubric', 'lecture', 'reading',
    'homework', 'problem', 'problems', 'office hours', 'participation', 'attendance',
    'review', 'study guide', 'worksheet', 'lab', 'precept', 'section', 'discussion',
    'presentation', 'project', 'paper', 'essay', 'percent', 'weight', 'points', 'credit',
    'calendar', 'schedule', 'objective', 'learning outcome', 'concept', 'theorem',
    'definition', 'example', 'practice', 'solution', 'formula', 'equation',
})

TOKEN_PATTERN = re.compile(r"[a-z0-9']+")


def keyword_max_chars():
    return int(os.getenv('PARSER_KEYWORD_MAX_CHARS', '120000'))


def keyword_min_input():
    return int(os.getenv('PARSER_KEYWORD_MIN_INPUT', '30000'))


def keyword_keep_first_page():
    return os.getenv('PARSER_KEYWORD_KEEP_FIRST_PAGE', '1').strip().casefold() not in {
        '0', 'false', 'off', 'no',
    }


def keyword_extract_mode():
    return os.getenv('PARSER_KEYWORD_EXTRACT', '0').strip().casefold()


def should_apply_keyword_extract(input_chars, *, min_input=None):
    mode = keyword_extract_mode()
    if mode in {'0', 'false', 'off', ''}:
        return False
    if mode in {'1', 'true', 'on', 'always'}:
        return input_chars > 0
    if mode == 'auto':
        threshold = keyword_min_input() if min_input is None else min_input
        return input_chars >= threshold
    return False


def tokenize(text):
    return [token for token in TOKEN_PATTERN.findall(str(text or '').lower()) if token not in STOPWORDS]


def split_sentences(text):
    raw = str(text or '').strip()
    if not raw:
        return []
    parts = SENTENCE_SPLIT_PATTERN.split(raw)
    sentences = []
    for part in parts:
        cleaned = ' '.join(part.split())
        if len(cleaned) >= 12:
            sentences.append(cleaned)
    if not sentences and raw:
        sentences = [raw]
    return sentences


def build_idf_map(sentences):
    doc_freq = Counter()
    for sentence in sentences:
        for token in set(tokenize(sentence)):
            doc_freq[token] += 1
    total = max(len(sentences), 1)
    return {
        token: math.log((total + 1) / (freq + 1)) + 1.0
        for token, freq in doc_freq.items()
    }


def academic_boost(sentence):
    lower = sentence.casefold()
    boost = 0.0
    if DATE_PATTERN.search(sentence):
        boost += 4.0
    if '%' in sentence or re.search(r'\b\d+\s*(?:points|pts|percent)\b', lower):
        boost += 3.0
    if HEADING_PATTERN.match(sentence.strip()):
        boost += 2.5
    for term in ACADEMIC_BOOST_TERMS:
        if term in lower:
            boost += 1.25
    return boost


def score_sentence(sentence, idf_map):
    tokens = tokenize(sentence)
    if not tokens:
        return 0.0
    tfidf = sum(idf_map.get(token, 0.0) * tokens.count(token) for token in set(tokens))
    tfidf /= max(len(tokens), 1)
    return tfidf + academic_boost(sentence)


def must_keep_sentence(sentence):
    if DATE_PATTERN.search(sentence):
        return True
    if '%' in sentence:
        return True
    lower = sentence.casefold()
    if any(term in lower for term in ('exam', 'midterm', 'final exam', 'due date', 'syllabus', 'assignment')):
        return True
    if HEADING_PATTERN.match(sentence.strip()):
        return True
    return False


def select_sentences(sentences, *, max_chars, always_keep_indices=None):
    if not sentences:
        return []
    if sum(len(s) for s in sentences) <= max_chars:
        return list(sentences)

    idf_map = build_idf_map(sentences)
    scored = [
        (index, sentence, score_sentence(sentence, idf_map))
        for index, sentence in enumerate(sentences)
    ]
    always_keep = set(always_keep_indices or [])
    for index, sentence, _score in scored:
        if must_keep_sentence(sentence):
            always_keep.add(index)

    selected_indices = set(always_keep)
    selected_chars = sum(len(sentences[i]) for i in selected_indices)

    ranked = sorted(
        ((index, sentence, score) for index, sentence, score in scored if index not in selected_indices),
        key=lambda row: row[2],
        reverse=True,
    )
    for index, sentence, _score in ranked:
        extra = len(sentence) + (2 if selected_indices else 0)
        if selected_chars + extra > max_chars:
            continue
        selected_indices.add(index)
        selected_chars += extra

    return [sentences[i] for i in sorted(selected_indices)]


def parse_page_segments(prompt_text):
    text = str(prompt_text or '')
    if not text.strip():
        return []
    parts = PAGE_MARKER_PATTERN.split(text)
    segments = []
    index = 0
    while index < len(parts):
        chunk = parts[index]
        if chunk.startswith('[[PAGE'):
            marker = chunk.strip()
            body = parts[index + 1] if index + 1 < len(parts) else ''
            segments.append({'marker': marker, 'body': body})
            index += 2
            continue
        if chunk.strip():
            segments.append({'marker': '', 'body': chunk})
        index += 1
    return segments


def compress_page_body(body, *, max_chars):
    sentences = split_sentences(body)
    if not sentences:
        return str(body or '').strip()
    if len(body) <= max_chars:
        return body.strip()
    keep_leading = min(2, len(sentences))
    always_keep = list(range(keep_leading))
    selected = select_sentences(sentences, max_chars=max_chars, always_keep_indices=always_keep)
    return '\n\n'.join(selected)


def compress_prompt_text(
    prompt_text,
    *,
    max_chars=None,
    min_input_chars=None,
    keep_first_page=None,
):
    text = str(prompt_text or '')
    max_chars = keyword_max_chars() if max_chars is None else max_chars
    min_input_chars = keyword_min_input() if min_input_chars is None else min_input_chars
    keep_first_page = keyword_keep_first_page() if keep_first_page is None else keep_first_page

    if len(text) <= min_input_chars:
        return text, {'compressed': False, 'input_chars': len(text), 'output_chars': len(text)}

    segments = parse_page_segments(text)
    if not segments:
        sentences = split_sentences(text)
        selected = select_sentences(sentences, max_chars=max_chars, always_keep_indices=[0, 1][:len(sentences)])
        output = '\n\n'.join(selected)
        return output, {
            'compressed': len(output) < len(text),
            'input_chars': len(text),
            'output_chars': len(output),
            'segments': 1,
        }

    page_count = max(len(segments), 1)
    per_page_budget = max(max_chars // page_count, 4000)
    output_parts = []
    for page_index, segment in enumerate(segments):
        marker = segment.get('marker') or ''
        body = str(segment.get('body') or '')
        if marker:
            output_parts.append(marker)
        if keep_first_page and page_index == 0:
            output_parts.append(body.strip())
            continue
        compressed_body = compress_page_body(body, max_chars=per_page_budget)
        if compressed_body:
            output_parts.append(compressed_body)

    output = '\n\n'.join(part for part in output_parts if part)
    if len(output) > max_chars:
        output = output[:max_chars]

    return output, {
        'compressed': len(output) < len(text),
        'input_chars': len(text),
        'output_chars': len(output),
        'segments': len(segments),
        'per_page_budget': per_page_budget,
    }


def maybe_compress_prompt_for_pass1(prompt_text, *, final_pass=False):
    if final_pass:
        return prompt_text, {'compressed': False, 'skipped': 'final_pass'}
    text = str(prompt_text or '')
    if not should_apply_keyword_extract(len(text)):
        return text, {'compressed': False, 'skipped': 'disabled'}
    compressed, stats = compress_prompt_text(text)
    stats['skipped'] = None
    return compressed, stats
