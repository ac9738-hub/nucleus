"""Stable text chunks with cite labels for grounded answers (NotebookLM-style).

Chunks tie verbatim source text to deterministic IDs so the sidekick can cite
[C1], [C2], … and answers can be traced back to file blocks or on-screen text.
"""
from __future__ import annotations

import re
from html import unescape

from canvas_parser.content.page_blocks import compact_block_text

CITE_PATTERN = re.compile(r'\[C(\d+)\]', re.IGNORECASE)
RETRIEVAL_CITE_PATTERN = re.compile(r'\[R(\d+)\]', re.IGNORECASE)
DEFAULT_MAX_CHUNKS = 48
DEFAULT_MAX_CHUNK_CHARS = 420
DEFAULT_MAX_PROMPT_CHARS = 8000


def make_file_block_chunk_id(courseid, fileid, page_number, block_index):
    page = page_number if page_number not in (None, '') else 0
    return f"file:{courseid}/{fileid}/p{page}/b{block_index}"


def make_screen_block_chunk_id(surface_kind, block_index, url=''):
    kind = re.sub(r'[^a-z0-9_-]+', '-', str(surface_kind or 'screen').casefold()).strip('-') or 'screen'
    return f"screen:{kind}/b{block_index}"


def _normalize_block_text(text, max_chars=DEFAULT_MAX_CHUNK_CHARS):
    return compact_block_text(text, max_chars)


def chunk_from_page_blocks(
    pages,
    *,
    courseid='',
    fileid='',
    max_chunks=DEFAULT_MAX_CHUNKS,
    max_chunk_chars=DEFAULT_MAX_CHUNK_CHARS,
):
    """Build citeable chunks from positioned PDF/HTML page blocks."""
    chunks = []
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        page_number = page.get('pageNumber')
        pageid = str(page.get('pageid') or '')
        blocks = page.get('blocks') if isinstance(page.get('blocks'), list) else []
        if not blocks:
            page_text = _normalize_block_text(page.get('text', ''), max_chunk_chars)
            if page_text:
                block_index = 0
                chunks.append({
                    'chunkId': make_file_block_chunk_id(courseid, fileid, page_number, block_index),
                    'text': page_text,
                    'source': {
                        'type': 'file-page',
                        'courseid': str(courseid or ''),
                        'fileid': str(fileid or ''),
                        'pageNumber': page_number,
                        'pageid': pageid,
                        'blockIndex': block_index,
                    },
                })
            continue
        for block_index, block in enumerate(blocks):
            if not isinstance(block, dict):
                continue
            text = _normalize_block_text(block.get('text', ''), max_chunk_chars)
            if not text:
                continue
            chunks.append({
                'chunkId': make_file_block_chunk_id(courseid, fileid, page_number, block_index),
                'text': text,
                'source': {
                    'type': 'file-block',
                    'courseid': str(courseid or ''),
                    'fileid': str(fileid or ''),
                    'pageNumber': page_number,
                    'pageid': pageid,
                    'blockIndex': block_index,
                    'yRatio0': block.get('yRatio0'),
                    'yRatio1': block.get('yRatio1'),
                },
            })
            if len(chunks) >= max_chunks:
                return assign_cite_labels(chunks)
    return assign_cite_labels(chunks)


def chunk_from_screen_blocks(
    blocks,
    *,
    surface_kind='screen',
    url='',
    courseid='',
    fileid='',
    max_chunks=DEFAULT_MAX_CHUNKS,
    max_chunk_chars=DEFAULT_MAX_CHUNK_CHARS,
):
    """Build citeable chunks from live on-screen text blocks."""
    chunks = []
    for block_index, block in enumerate(blocks or []):
        if not isinstance(block, dict):
            continue
        text = _normalize_block_text(block.get('text', ''), max_chunk_chars)
        if not text:
            continue
        chunks.append({
            'chunkId': make_screen_block_chunk_id(surface_kind, block_index, url),
            'text': text,
            'source': {
                'type': 'screen-block',
                'surfaceKind': str(surface_kind or ''),
                'url': str(url or ''),
                'courseid': str(courseid or ''),
                'fileid': str(fileid or ''),
                'blockIndex': block_index,
                'tag': str(block.get('tag') or ''),
                'pageNumber': block.get('pageNumber'),
                'y': block.get('y'),
            },
        })
        if len(chunks) >= max_chunks:
            break
    return assign_cite_labels(chunks)


def assign_cite_labels(chunks):
    labeled = []
    for index, chunk in enumerate(chunks or []):
        if not isinstance(chunk, dict):
            continue
        labeled.append({
            **chunk,
            'citeLabel': f"C{index + 1}",
        })
    return labeled


def assign_retrieval_cite_labels(chunks):
    labeled = []
    for index, chunk in enumerate(chunks or []):
        if not isinstance(chunk, dict):
            continue
        labeled.append({
            **chunk,
            'citeLabel': f"R{index + 1}",
        })
    return labeled


def format_retrieval_chunks_for_grounding(
    chunks,
    *,
    title='Retrieved source chunks (cite inline as [R#] when used):',
    max_chars=DEFAULT_MAX_PROMPT_CHARS,
):
    labeled = assign_retrieval_cite_labels(chunks)
    if not labeled:
        return ''
    lines = [title]
    chars = len(title)
    for chunk in labeled:
        cite = chunk.get('citeLabel') or ''
        text = str(chunk.get('text') or '').strip()
        if not cite or not text:
            continue
        source = chunk.get('source') if isinstance(chunk.get('source'), dict) else {}
        edge_names = [
            str(edge.get('name') or '')
            for edge in (chunk.get('edges') or [])
            if isinstance(edge, dict) and edge.get('name')
        ]
        meta_bits = []
        if source.get('fileid'):
            meta_bits.append(f"file={source.get('fileid')}")
        if source.get('pageNumber') not in (None, ''):
            meta_bits.append(f"p.{source.get('pageNumber')}")
        if edge_names:
            meta_bits.append('; '.join(edge_names[:2]))
        meta = f" ({', '.join(meta_bits)})" if meta_bits else ''
        line = f"[{cite}]{meta} {text}"
        if chars + len(line) + 1 > max_chars:
            lines.append('… (additional retrieved chunks omitted)')
            break
        lines.append(line)
        chars += len(line) + 1
    return '\n'.join(lines)


def format_chunks_for_grounding(
    chunks,
    *,
    title='Source chunks (cite inline as [C#] when used):',
    max_chars=DEFAULT_MAX_PROMPT_CHARS,
):
    """Render chunks for LLM context with short cite labels."""
    labeled = assign_cite_labels(chunks)
    if not labeled:
        return ''
    lines = [title]
    chars = len(title)
    for chunk in labeled:
        cite = chunk.get('citeLabel') or ''
        text = str(chunk.get('text') or '').strip()
        if not cite or not text:
            continue
        source = chunk.get('source') if isinstance(chunk.get('source'), dict) else {}
        meta_bits = []
        if source.get('fileid'):
            meta_bits.append(f"file={source.get('fileid')}")
        if source.get('pageNumber') not in (None, ''):
            meta_bits.append(f"p.{source.get('pageNumber')}")
        if source.get('tag'):
            meta_bits.append(str(source.get('tag')))
        meta = f" ({', '.join(meta_bits)})" if meta_bits else ''
        line = f"[{cite}]{meta} {text}"
        if chars + len(line) + 1 > max_chars:
            lines.append('… (additional chunks omitted)')
            break
        lines.append(line)
        chars += len(line) + 1
    return '\n'.join(lines)


def parse_cite_labels(text):
    """Extract [C1]-style cite labels from model output."""
    if not text:
        return []
    seen = []
    for match in CITE_PATTERN.finditer(str(text)):
        label = f"C{match.group(1)}"
        if label not in seen:
            seen.append(label)
    return seen


def parse_retrieval_cite_labels(text):
    if not text:
        return []
    seen = []
    for match in RETRIEVAL_CITE_PATTERN.finditer(str(text)):
        label = f"R{match.group(1)}"
        if label not in seen:
            seen.append(label)
    return seen


def resolve_citations(answer_text, chunks):
    """Map cite labels in an answer back to chunk records."""
    labels = parse_cite_labels(answer_text)
    if not labels:
        return []
    by_label = {
        str(chunk.get('citeLabel') or ''): chunk
        for chunk in (chunks or [])
        if isinstance(chunk, dict) and chunk.get('citeLabel')
    }
    return [by_label[label] for label in labels if label in by_label]


def chunk_ids_unique(chunks):
    ids = [str(chunk.get('chunkId') or '') for chunk in chunks or [] if isinstance(chunk, dict)]
    return len(ids) == len(set(ids))


def summarize_chunks(chunks):
    labeled = assign_cite_labels(chunks)
    return {
        'count': len(labeled),
        'uniqueIds': chunk_ids_unique(labeled),
        'totalChars': sum(len(str(chunk.get('text') or '')) for chunk in labeled),
        'labels': [chunk.get('citeLabel') for chunk in labeled],
    }
