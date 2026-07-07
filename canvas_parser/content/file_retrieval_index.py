"""Build retrieval-ready file node indexes inside canvas_graph.json."""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from canvas_parser.content.chunk_graph import (
    build_file_chunk_graph,
    filename_suggests_teaching_unit,
    persist_text_chunks_on_file_node,
    summarize_chunk_graph,
)
from canvas_parser.content.type_extraction_retrieval import type_extraction_search_text


def compact_search_text(text: str, max_chars: int = 50000) -> str:
    cleaned = ' '.join(str(text or '').split())
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars]


def merge_searchtext_with_type_extractions(file_node: dict, *, max_chars: int = 50000) -> bool:
    store = file_node.get('typeExtractions') if isinstance(file_node.get('typeExtractions'), dict) else {}
    extraction_text = type_extraction_search_text(store, max_chars=min(max_chars, 12000))
    if not extraction_text:
        return False
    base = str(file_node.get('searchtext') or '').strip()
    academic = str(file_node.get('academicFileType') or '').strip()
    parts = [base, academic, extraction_text]
    merged = compact_search_text('\n'.join(part for part in parts if part), max_chars=max_chars)
    if merged == base:
        return False
    file_node['searchtext'] = merged
    return True


def _file_chunks_fresh(file_node: dict) -> bool:
    """True when textChunks already carry weekly + graph-node edge metadata."""
    chunks = file_node.get('textChunks') if isinstance(file_node.get('textChunks'), list) else []
    if not chunks:
        return False
    has_weekly = False
    has_graph = False
    has_teaching = False
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        for edge in chunk.get('edges') or []:
            if not isinstance(edge, dict):
                continue
            if edge.get('type') == 'weekly-item':
                has_weekly = True
            if edge.get('type') == 'graph-node':
                has_graph = True
            if edge.get('type') == 'teaching-unit':
                has_teaching = True
        if has_weekly and has_graph and has_teaching:
            return True
    if has_weekly and has_graph:
        if filename_suggests_teaching_unit(str(file_node.get('name') or '')) and not has_teaching:
            return False
        if has_weekly and not has_teaching:
            for chunk in chunks:
                if not isinstance(chunk, dict):
                    continue
                for edge in chunk.get('edges') or []:
                    if isinstance(edge, dict) and edge.get('type') == 'weekly-item':
                        if filename_suggests_teaching_unit(str(edge.get('name') or '')):
                            return False
        return True
    return False


def index_file_node_for_retrieval(
    file_node: dict,
    *,
    courseid: str,
    fileid: str,
    graph: dict,
    weekly_schedule=None,
    max_chunks: int = 48,
) -> dict:
    """Rebuild textChunks with teaching, weekly, graph-node, and type-extraction edges."""
    pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
    if not pages:
        return {'indexed': False, 'reason': 'no_pages'}

    merge_searchtext_with_type_extractions(file_node)

    chunks = build_file_chunk_graph(
        pages,
        courseid=str(courseid),
        fileid=str(fileid),
        filename=str(file_node.get('name') or ''),
        graph=graph,
        weekly_schedule=weekly_schedule,
        type_extractions=file_node.get('typeExtractions') if isinstance(file_node.get('typeExtractions'), dict) else {},
        max_chunks=max_chunks,
    )
    if not chunks:
        return {'indexed': False, 'reason': 'no_chunks'}

    persist_text_chunks_on_file_node(file_node, chunks)
    summary = summarize_chunk_graph(chunks)
    return {'indexed': True, **summary}


def load_weekly_schedule(canvas_data_path: Path | None) -> dict:
    path = Path(canvas_data_path) if canvas_data_path else None
    if not path or not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    weekly = data.get('weekly_schedule')
    return weekly if isinstance(weekly, dict) else {}


def merge_missing_courses_from_backup(graph: dict, backup: dict) -> list[str]:
    """Restore courses present in backup but absent from graph (retrieval coverage)."""
    merged = []
    for key in ('syllabi', 'files', 'learningBlocks', 'moduleOrderHints'):
        graph.setdefault(key, {})
        backup_section = backup.get(key) if isinstance(backup.get(key), dict) else {}
        for course_id, payload in backup_section.items():
            if course_id in graph[key]:
                continue
            graph[key][course_id] = payload
            if course_id not in merged:
                merged.append(str(course_id))

    backup_concepts = backup.get('concepts') or []
    graph_concepts = graph.setdefault('concepts', [])
    present_courses = {
        str(item.get('courseid') or '')
        for item in graph_concepts
        if isinstance(item, dict)
    }
    for concept in backup_concepts:
        if not isinstance(concept, dict):
            continue
        cid = str(concept.get('courseid') or '')
        if cid and cid not in present_courses:
            graph_concepts.append(concept)
            if cid not in merged:
                merged.append(cid)

    for key in ('problems',):
        graph_list = graph.setdefault(key, [])
        present = set()
        for item in graph_list:
            if isinstance(item, dict):
                present.add(str(item.get('courseid') or ''))
        for item in backup.get(key) or []:
            if not isinstance(item, dict):
                continue
            cid = str(item.get('courseid') or '')
            if cid and cid not in present:
                graph_list.append(item)
                if cid not in merged:
                    merged.append(cid)

    merged_set = set(merged)
    graph_events = graph.setdefault('events', [])
    present_event_keys = {
        (str(item.get('courseid') or ''), str(item.get('eventid') or item.get('name') or ''))
        for item in graph_events
        if isinstance(item, dict)
    }
    for item in backup.get('events') or []:
        if not isinstance(item, dict):
            continue
        cid = str(item.get('courseid') or '')
        if cid not in merged_set:
            continue
        key = (cid, str(item.get('eventid') or item.get('name') or ''))
        if key in present_event_keys:
            continue
        graph_events.append(item)
        present_event_keys.add(key)

    for key in ('logged_details', 'logged_examples', 'logged_problems', 'logged_assignments', 'logged_events'):
        graph.setdefault(key, {})
        backup_section = backup.get(key) if isinstance(backup.get(key), dict) else {}
        for course_id, payload in backup_section.items():
            if course_id not in graph[key]:
                graph[key][course_id] = payload

    return sorted(set(merged))


def enrich_graph_retrieval(
    graph: dict,
    *,
    weekly_schedule=None,
    course_filter: str = '',
    file_filter: str = '',
    max_files: int = 0,
    skip_fresh: bool = False,
    workers: int = 1,
) -> dict:
    stats = {
        'filesSeen': 0,
        'filesIndexed': 0,
        'filesSkippedFresh': 0,
        'searchtextEnriched': 0,
        'chunksWritten': 0,
        'typeExtractionEdges': 0,
        'weeklyEdges': 0,
        'teachingEdges': 0,
        'perFile': [],
    }

    work: list[tuple] = []
    for course_id, course_files in (graph.get('files') or {}).items():
        if course_filter and str(course_id) != str(course_filter):
            continue
        if not isinstance(course_files, dict):
            continue
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            if file_filter and str(file_id) != str(file_filter):
                continue
            stats['filesSeen'] += 1
            if skip_fresh and _file_chunks_fresh(file_node):
                stats['filesSkippedFresh'] += 1
                continue
            work.append((str(course_id), str(file_id), file_node))

    def _index_one(item):
        course_id, file_id, file_node = item
        enriched = merge_searchtext_with_type_extractions(file_node)
        result = index_file_node_for_retrieval(
            file_node,
            courseid=course_id,
            fileid=file_id,
            graph=graph,
            weekly_schedule=weekly_schedule,
        )
        return course_id, file_id, file_node, enriched, result

    worker_count = max(1, int(workers or 1))
    if worker_count == 1:
        results = [_index_one(item) for item in work]
    else:
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            results = list(pool.map(_index_one, work))

    for course_id, file_id, file_node, enriched, result in results:
        if enriched:
            stats['searchtextEnriched'] += 1
        if not result.get('indexed'):
            continue
        stats['filesIndexed'] += 1
        stats['chunksWritten'] += int(result.get('chunkCount') or 0)
        stats['typeExtractionEdges'] += int(result.get('withTypeExtraction') or 0)
        stats['weeklyEdges'] += int(result.get('withWeeklyItem') or 0)
        stats['teachingEdges'] += int(result.get('withTeachingUnit') or 0)
        stats['perFile'].append({
            'courseId': course_id,
            'fileId': file_id,
            'name': file_node.get('name', ''),
            **result,
        })
        if max_files and stats['filesIndexed'] >= max_files:
            break
    return stats
