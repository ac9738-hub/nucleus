"""Positioned page-block helpers for PDF/HTML/text ingestion and viewport context."""
from __future__ import annotations

import re
from html import unescape


PAGE_BLOCK_LINE_HEIGHT = 24.0
DEFAULT_DOCUMENT_PAGE_WIDTH = 800.0


def compact_block_text(text, max_length=1200):
    cleaned = unescape(str(text or ''))
    cleaned = re.sub(r'<[^>]+>', ' ', cleaned)
    cleaned = cleaned.replace('\x00', ' ')
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned[:max_length]


def pages_missing_positioned_blocks(pages):
    if not isinstance(pages, list) or not pages:
        return True
    for page in pages:
        if not isinstance(page, dict):
            continue
        blocks = page.get('blocks') if isinstance(page.get('blocks'), list) else []
        if any(isinstance(block, dict) and block.get('text') for block in blocks):
            return False
    return True


def split_text_paragraphs(text):
    raw = unescape(str(text or ''))
    raw = re.sub(r'<[^>]+>', ' ', raw)
    raw = raw.replace('\x00', ' ')
    parts = [part.strip() for part in re.split(r'\n\s*\n+', raw) if part.strip()]
    if not parts:
        cleaned = re.sub(r'\s+', ' ', raw).strip()
        if not cleaned:
            return []
        parts = [cleaned]
    normalized = [compact_block_text(part, 600) for part in parts if compact_block_text(part, 600)]
    if len(normalized) <= 1 and len(' '.join(normalized)) > 400:
        normalized = [
            compact_block_text(part, 600)
            for part in re.split(r'(?<=[.!?])\s+', ' '.join(normalized))
            if compact_block_text(part, 600)
        ]
    return normalized


def build_positioned_text_blocks(
    paragraphs,
    y_offset=0.0,
    total_height=None,
    line_height=PAGE_BLOCK_LINE_HEIGHT,
    max_blocks=600,
):
    blocks = []
    total = total_height if total_height else max((len(paragraphs) or 1) * line_height, line_height)
    y = float(y_offset or 0)
    for paragraph in paragraphs:
        text = compact_block_text(paragraph, 600)
        if not text:
            continue
        y0 = y
        y1 = y + line_height
        blocks.append({
            'text': text,
            'x0': 0.0,
            'x1': DEFAULT_DOCUMENT_PAGE_WIDTH,
            'y0': y0,
            'y1': y1,
            'yRatio0': y0 / total,
            'yRatio1': y1 / total,
        })
        y += line_height
        if len(blocks) >= max_blocks:
            break
    return blocks


def build_raw_document_pages(fileid, text):
    paragraphs = split_text_paragraphs(text)
    if not paragraphs:
        return []
    total_height = max(len(paragraphs) * PAGE_BLOCK_LINE_HEIGHT, 800.0)
    blocks = build_positioned_text_blocks(paragraphs, 0.0, total_height)
    page_text = compact_block_text(text, 1200)
    return [{
        'pageid': f"{fileid}:page:1",
        'pageNumber': 1,
        'yScroll': 0.0,
        'yScrollRatio': 0.0,
        'height': total_height,
        'width': DEFAULT_DOCUMENT_PAGE_WIDTH,
        'text': page_text,
        'blocks': blocks,
        'nodes': [],
    }]


def merge_page_records(existing_pages, incoming_pages, normalize_blocks):
    existing_by_id = {
        str(page.get('pageid') or ''): page
        for page in existing_pages or []
        if isinstance(page, dict)
    }
    merged = []
    seen = set()
    for page in incoming_pages or []:
        if not isinstance(page, dict):
            continue
        pageid = str(page.get('pageid') or '')
        seen.add(pageid)
        previous = existing_by_id.get(pageid, {})
        incoming_blocks = page.get('blocks') if isinstance(page.get('blocks'), list) else []
        previous_blocks = previous.get('blocks') if isinstance(previous.get('blocks'), list) else []
        incoming_has_blocks = any(
            isinstance(block, dict) and block.get('text')
            for block in incoming_blocks
        )
        previous_has_blocks = any(
            isinstance(block, dict) and block.get('text')
            for block in previous_blocks
        )
        use_blocks = incoming_blocks if incoming_has_blocks else previous_blocks
        if not incoming_has_blocks and not previous_has_blocks:
            use_blocks = incoming_blocks or previous_blocks
        nodes = []
        for node_ref in previous.get('nodes', []) or []:
            if node_ref and node_ref not in nodes:
                nodes.append(node_ref)
        for node_ref in page.get('nodes', []) or []:
            if node_ref and node_ref not in nodes:
                nodes.append(node_ref)
        merged_page = {
            **previous,
            **page,
            'blocks': normalize_blocks(use_blocks),
            'nodes': nodes,
        }
        if not merged_page.get('text'):
            merged_page['text'] = previous.get('text') or page.get('text') or ''
        merged.append(merged_page)
    for pageid, page in existing_by_id.items():
        if pageid not in seen:
            merged.append(page)
    merged.sort(key=lambda item: float(item.get('yScroll') or 0))
    return merged


def summarize_page_blocks(pages, max_chars=2400):
    chunks = []
    chars = 0
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        page_number = page.get('pageNumber') or ''
        blocks = page.get('blocks') if isinstance(page.get('blocks'), list) else []
        block_text_found = False
        for block in blocks:
            if not isinstance(block, dict):
                continue
            text = compact_block_text(block.get('text', ''), 280)
            if not text:
                continue
            block_text_found = True
            line = f"p{page_number}: {text}" if page_number else text
            if chars + len(line) > max_chars:
                return ' '.join(chunks)
            chunks.append(line)
            chars += len(line)
        if not block_text_found:
            text = compact_block_text(page.get('text', ''), 400)
            if text and chars + len(text) <= max_chars:
                chunks.append(text)
                chars += len(text)
    return ' '.join(chunks)
