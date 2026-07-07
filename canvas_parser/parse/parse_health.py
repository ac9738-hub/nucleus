"""Lightweight health checks after parse / reparse checkpoints."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def graph_health_snapshot(state: dict) -> dict[str, Any]:
    concepts = list(state.get('concepts') or [])
    files_root = state.get('files') or {}
    file_count = 0
    parsed_files = 0
    heuristic_concepts = 0
    for course_files in files_root.values():
        if not isinstance(course_files, dict):
            continue
        for node in course_files.values():
            if not isinstance(node, dict):
                continue
            file_count += 1
            if node.get('pages') or node.get('textChunks'):
                parsed_files += 1
    for concept in concepts:
        if isinstance(concept, dict) and concept.get('heuristicSource'):
            heuristic_concepts += 1
    return {
        'conceptCount': len(concepts),
        'heuristicConceptCount': heuristic_concepts,
        'fileCount': file_count,
        'parsedFiles': parsed_files,
        'courseCount': len(files_root),
    }


def validate_graph_checkpoint(path: Path, *, min_concepts: int = 0) -> dict[str, Any]:
    """Load graph JSON and return health snapshot; raise on corrupt JSON or empty graph."""
    if not path.is_file():
        raise FileNotFoundError(f'Graph missing: {path}')
    try:
        state = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as error:
        raise ValueError(f'Graph JSON corrupt: {path}') from error
    snapshot = graph_health_snapshot(state)
    if min_concepts and snapshot['conceptCount'] < min_concepts:
        raise ValueError(
            f'Graph concept count {snapshot["conceptCount"]} below minimum {min_concepts}'
        )
    return snapshot
