"""Dedicated embeddings for indexed file text chunks."""
from __future__ import annotations

import os

try:
    import numpy as np
except ModuleNotFoundError:  # pragma: no cover - optional in tests
    np = None

CHUNK_EMBED_MAX = int(os.getenv('CHUNK_EMBED_MAX', '32'))


def chunk_embedding_input(chunk, filename='') -> str:
    if not isinstance(chunk, dict):
        return ''
    text = str(chunk.get('text') or '').strip()
    if not text:
        return ''
    edge_parts = []
    for edge in (chunk.get('edges') or []):
        if not isinstance(edge, dict):
            continue
        if edge.get('name'):
            edge_parts.append(str(edge['name']))
        if edge.get('type') == 'type-extraction':
            for key in ('label', 'summary', 'category', 'group'):
                value = edge.get(key)
                if value:
                    edge_parts.append(str(value))
    edge_names = ' '.join(edge_parts)
    parts = [str(filename or '').strip(), text, edge_names.strip()]
    return '\n'.join(part for part in parts if part)[:8000]


def chunk_has_embedding(chunk) -> bool:
    if not isinstance(chunk, dict):
        return False
    embedded = chunk.get('embedded')
    return isinstance(embedded, dict) and bool(embedded.get('text'))


def collect_chunks_needing_embedding(file_node, max_chunks=CHUNK_EMBED_MAX):
    rows = []
    if not isinstance(file_node, dict):
        chunks = getattr(file_node, 'textChunks', []) or []
        filename = getattr(file_node, 'name', '') or ''
    else:
        chunks = file_node.get('textChunks') or []
        filename = file_node.get('name', '') or ''
    for chunk in (chunks or [])[:max_chunks]:
        if not isinstance(chunk, dict):
            continue
        text = str(chunk.get('text') or '').strip()
        if not text or text == '[Figure/image region]':
            continue
        if chunk_has_embedding(chunk):
            continue
        payload = chunk_embedding_input(chunk, filename=filename)
        if payload:
            rows.append((chunk, payload))
    return rows


def apply_chunk_embeddings(rows, vectors):
    for (chunk, _payload), vector in zip(rows, vectors):
        chunk['embedded'] = {'text': list(vector)}


def cosine_similarity(left, right) -> float:
    if np is None or left is None or right is None:
        return 0.0
    a = np.asarray(left, dtype=np.float32)
    b = np.asarray(right, dtype=np.float32)
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 0:
        return 0.0
    return float(np.dot(a, b) / denom)
