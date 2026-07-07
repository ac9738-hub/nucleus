"""Ground Synapse Learn lessons to parsed graph nodes and citeable text chunks."""
from __future__ import annotations

import re
from typing import Any

from canvas_parser.content.chunk_graph import (
    build_file_chunk_graph,
    chunks_from_file_node,
    select_chunks_for_query,
)
from canvas_parser.content.teaching_blocks import teaching_labels_match
from canvas_parser.content.file_retrieval_index import load_weekly_schedule
from canvas_parser.content.text_chunks import (
    assign_cite_labels,
    format_chunks_for_grounding,
    make_file_block_chunk_id,
)

DEFAULT_MAX_GROUNDING_CHUNKS = 8
GRAPH_NODE_CHUNK_PREFIX = 'graph-node'
SYNTHETIC_CHUNK_MAX_CHARS = 420


def _lesson_name(lesson: dict) -> str:
    return str(lesson.get('name') or '').strip()


def _lesson_type(lesson: dict) -> str:
    return str(lesson.get('type') or '').strip()


def _normalize_page_number(value) -> int | None:
    if value in (None, ''):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _chunk_page_number(chunk: dict) -> int | None:
    source = chunk.get('source') if isinstance(chunk.get('source'), dict) else {}
    return _normalize_page_number(source.get('pageNumber'))


def _chunk_pageid(chunk: dict) -> str:
    source = chunk.get('source') if isinstance(chunk.get('source'), dict) else {}
    return str(source.get('pageid') or '')


def _score_chunk_for_lesson(chunk: dict, lesson: dict) -> int:
    lesson_name = _lesson_name(lesson)
    lesson_type = _lesson_type(lesson)
    lesson_pageid = str(lesson.get('pageid') or '')
    lesson_page = _normalize_page_number(lesson.get('pageNumber'))
    score = 0

    for edge in chunk.get('edges') or []:
        if not isinstance(edge, dict):
            continue
        edge_type = str(edge.get('type') or '')
        edge_name = str(edge.get('name') or '')
        if edge_type == 'teaching-unit' and teaching_labels_match(lesson_name, edge_name):
            if not lesson_type or str(edge.get('unitType') or '') == lesson_type:
                score += 12
            else:
                score += 8
        if edge_type == 'graph-node' and teaching_labels_match(lesson_name, edge_name):
            if not lesson_type or str(edge.get('nodeType') or '') == lesson_type:
                score += 10
            else:
                score += 6

    chunk_pageid = _chunk_pageid(chunk)
    if lesson_pageid and chunk_pageid == lesson_pageid:
        score += 4
    chunk_page = _chunk_page_number(chunk)
    if lesson_page is not None and chunk_page == lesson_page:
        score += 3

    text = str(chunk.get('text') or '').casefold()
    name_norm = lesson_name.casefold()
    if name_norm:
        if name_norm in text:
            score += 5
        tokens = [token for token in re.findall(r'[a-z0-9]{3,}', name_norm) if len(token) >= 3]
        score += sum(1 for token in tokens if token in text)

    return score


def _file_node_for_lesson(graph: dict, course_id: str, lesson: dict) -> dict | None:
    file_id = str(lesson.get('fileId') or '').strip()
    if not file_id:
        return None
    course_files = (graph.get('files') or {}).get(str(course_id)) or {}
    if not isinstance(course_files, dict):
        return None
    file_node = course_files.get(file_id)
    return file_node if isinstance(file_node, dict) else None


def _iter_course_concepts(graph: dict, course_id: str):
    for concept in graph.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        if str(concept.get('courseid') or '').strip() != str(course_id).strip():
            continue
        yield concept


def _iter_course_problems(graph: dict, course_id: str):
    for problem in graph.get('problems') or []:
        if not isinstance(problem, dict):
            continue
        if str(problem.get('courseid') or '').strip() != str(course_id).strip():
            continue
        yield problem


def _graph_nodes_for_lesson(lesson: dict, graph: dict, course_id: str) -> list[dict]:
    lesson_name = _lesson_name(lesson)
    matches: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def append(node_type: str, node_id: str, name: str, description: str = '', source_pages=None) -> None:
        key = (node_type, str(node_id or name).casefold())
        if key in seen:
            return
        if not teaching_labels_match(lesson_name, name):
            return
        seen.add(key)
        matches.append({
            'type': 'graph-node',
            'nodeType': node_type,
            'nodeId': str(node_id or name),
            'name': str(name or ''),
            'description': str(description or '').strip(),
            'sourcePages': source_pages if isinstance(source_pages, list) else [],
        })

    for concept in _iter_course_concepts(graph, course_id):
        concept_id = str(concept.get('conceptid') or concept.get('name') or '')
        append(
            'concept',
            concept_id,
            str(concept.get('name') or ''),
            str(concept.get('description') or ''),
            concept.get('sourcePages') or [],
        )
        for detail in concept.get('details') or []:
            if not isinstance(detail, dict):
                continue
            append(
                'detail',
                f"{concept_id}:{detail.get('name', '')}",
                str(detail.get('name') or ''),
                str(detail.get('description') or ''),
                detail.get('sourcePages') or [],
            )
        for example in concept.get('examples') or []:
            if not isinstance(example, dict):
                continue
            append(
                'example',
                f"{concept_id}:{example.get('name', '')}",
                str(example.get('name') or ''),
                str(example.get('description') or ''),
                example.get('sourcePages') or [],
            )

    for problem in _iter_course_problems(graph, course_id):
        steps = problem.get('steps') if isinstance(problem.get('steps'), list) else []
        description = ' '.join(str(step).strip() for step in steps if str(step).strip())
        append(
            'problem',
            str(problem.get('problemid') or problem.get('name') or ''),
            str(problem.get('name') or ''),
            description,
            problem.get('sourcePages') or [],
        )

    return matches


def _synthetic_chunks_from_graph_nodes(
    graph_nodes: list[dict],
    *,
    course_id: str,
    lesson: dict,
    max_chunks: int,
) -> list[dict]:
    chunks: list[dict] = []
    lesson_name = _lesson_name(lesson)
    for index, node in enumerate(graph_nodes[:max_chunks]):
        description = str(node.get('description') or '').strip()
        if not description:
            continue
        node_type = str(node.get('nodeType') or 'concept')
        node_id = str(node.get('nodeId') or node.get('name') or index)
        chunks.append({
            'chunkId': f"{GRAPH_NODE_CHUNK_PREFIX}:{course_id}/{node_type}/{node_id}",
            'text': description[:SYNTHETIC_CHUNK_MAX_CHARS],
            'source': {
                'type': 'graph-node',
                'courseid': str(course_id),
                'nodeType': node_type,
                'nodeId': node_id,
                'name': str(node.get('name') or lesson_name),
            },
            'edges': [{
                'type': 'graph-node',
                'nodeType': node_type,
                'nodeId': node_id,
                'name': str(node.get('name') or ''),
            }],
        })
    return chunks


def _synthetic_chunk_from_lesson_text(lesson: dict, *, course_id: str) -> list[dict]:
    text = str(
        lesson.get('contextText')
        or lesson.get('teachingContext')
        or lesson.get('problemStatement')
        or lesson.get('snippet')
        or ''
    ).strip()
    if len(text) < 40:
        return []
    file_id = str(lesson.get('fileId') or 'lesson')
    page_number = _normalize_page_number(lesson.get('pageNumber'))
    return [{
        'chunkId': make_file_block_chunk_id(course_id, file_id, page_number or 0, 0),
        'text': text[:SYNTHETIC_CHUNK_MAX_CHARS],
        'source': {
            'type': 'lesson-context',
            'courseid': str(course_id),
            'fileid': file_id,
            'pageNumber': page_number,
            'pageid': str(lesson.get('pageid') or ''),
            'lessonId': str(lesson.get('id') or ''),
            'lessonName': _lesson_name(lesson),
        },
        'edges': [],
    }]


def select_grounding_chunks_for_lesson(
    lesson: dict,
    graph: dict,
    course_id: str,
    *,
    max_chunks: int = DEFAULT_MAX_GROUNDING_CHUNKS,
    weekly_schedule=None,
) -> list[dict]:
    """Pick citeable chunks that best match one curriculum lesson."""
    if weekly_schedule is None:
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        weekly_schedule = load_weekly_schedule(root / 'canvas_data.json')
    file_node = _file_node_for_lesson(graph, course_id, lesson)
    file_id = str(lesson.get('fileId') or '')
    all_chunks: list[dict] = []

    if file_node:
        all_chunks = chunks_from_file_node(
            file_node,
            courseid=str(course_id),
            fileid=file_id,
            max_chunks=48,
            graph=graph,
            weekly_schedule=weekly_schedule,
        )
        if not all_chunks:
            pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
            if pages:
                all_chunks = build_file_chunk_graph(
                    pages,
                    courseid=str(course_id),
                    fileid=file_id,
                    filename=str(file_node.get('name') or ''),
                    graph=graph,
                )

    scored = [
        (_score_chunk_for_lesson(chunk, lesson), chunk)
        for chunk in all_chunks
        if _score_chunk_for_lesson(chunk, lesson) > 0
    ]
    scored.sort(key=lambda item: (-item[0], str(item[1].get('chunkId') or '')))
    selected = [chunk for _, chunk in scored[:max_chunks]]

    if not selected and all_chunks:
        selected = select_chunks_for_query(
            all_chunks,
            query=_lesson_name(lesson),
            max_chunks=max_chunks,
        )

    graph_nodes = _graph_nodes_for_lesson(lesson, graph, course_id)
    if not selected:
        selected = _synthetic_chunks_from_graph_nodes(
            graph_nodes,
            course_id=course_id,
            lesson=lesson,
            max_chunks=max_chunks,
        )

    if not selected:
        selected = _synthetic_chunk_from_lesson_text(lesson, course_id=course_id)

    return assign_cite_labels(selected[:max_chunks])


def build_lesson_source_refs(
    lesson: dict,
    graph: dict,
    course_id: str,
    grounding_chunks: list[dict],
    graph_nodes: list[dict] | None = None,
) -> list[dict]:
    refs: list[dict] = []
    seen: set[str] = set()

    def append(ref: dict) -> None:
        if not isinstance(ref, dict):
            return
        key = '|'.join(
            str(ref.get(field) or '')
            for field in ('type', 'nodeId', 'chunkId', 'fileid', 'pageid', 'citeLabel')
        )
        if not key or key in seen:
            return
        seen.add(key)
        refs.append(ref)

    file_id = str(lesson.get('fileId') or '').strip()
    if file_id:
        append({
            'type': 'file-page',
            'fileid': file_id,
            'filename': str(lesson.get('filename') or ''),
            'pageid': str(lesson.get('pageid') or ''),
            'pageNumber': lesson.get('pageNumber'),
            'y0': lesson.get('y0'),
            'yRatio0': lesson.get('yRatio0'),
        })

    for node in graph_nodes or _graph_nodes_for_lesson(lesson, graph, course_id):
        append({
            'type': 'graph-node',
            'nodeType': node.get('nodeType'),
            'nodeId': node.get('nodeId'),
            'name': node.get('name'),
        })
        for page in node.get('sourcePages') or []:
            if not isinstance(page, dict):
                continue
            append({
                'type': 'graph-source-page',
                'nodeType': node.get('nodeType'),
                'nodeId': node.get('nodeId'),
                'name': node.get('name'),
                'fileid': page.get('fileid'),
                'filename': page.get('filename'),
                'pageid': page.get('pageid'),
                'pageNumber': page.get('pageNumber'),
            })

    for chunk in grounding_chunks or []:
        if not isinstance(chunk, dict):
            continue
        source = chunk.get('source') if isinstance(chunk.get('source'), dict) else {}
        append({
            'type': 'text-chunk',
            'chunkId': chunk.get('chunkId'),
            'citeLabel': chunk.get('citeLabel'),
            'fileid': source.get('fileid'),
            'pageNumber': source.get('pageNumber'),
            'nodeType': source.get('nodeType'),
            'nodeId': source.get('nodeId'),
        })

    return refs


def build_lesson_grounding_prompt(
    lesson: dict,
    grounding_chunks: list[dict],
    *,
    include_answer_key: bool = False,
) -> str:
    prompt = format_chunks_for_grounding(
        grounding_chunks,
        title='Lesson source chunks (cite inline as [C#] when used):',
    )
    if not prompt:
        context = str(
            lesson.get('teachingContext')
            or lesson.get('problemStatement')
            or lesson.get('snippet')
            or ''
        ).strip()
        if context:
            prompt = (
                'Lesson source material (no chunk labels available; stay within this text):\n'
                f"{context}"
            )
    if include_answer_key and lesson.get('answerKey'):
        prompt += (
            '\n\nReference answer (grading only — do not reveal unless checking student work):\n'
            f"{lesson.get('answerKey')}"
        )
    return prompt


def attach_lesson_grounding(
    lesson: dict,
    graph: dict,
    course_id: str,
    *,
    max_chunks: int = DEFAULT_MAX_GROUNDING_CHUNKS,
) -> dict:
    """Attach groundingChunks, sourceRefs, and groundingPrompt to one lesson."""
    graph_nodes = _graph_nodes_for_lesson(lesson, graph, course_id)
    grounding_chunks = select_grounding_chunks_for_lesson(
        lesson,
        graph,
        course_id,
        max_chunks=max_chunks,
    )
    source_refs = build_lesson_source_refs(
        lesson,
        graph,
        course_id,
        grounding_chunks,
        graph_nodes=graph_nodes,
    )
    lesson['groundingChunks'] = [
        {
            'chunkId': chunk.get('chunkId'),
            'citeLabel': chunk.get('citeLabel'),
            'text': chunk.get('text'),
            'source': chunk.get('source') if isinstance(chunk.get('source'), dict) else {},
            'edges': chunk.get('edges') if isinstance(chunk.get('edges'), list) else [],
        }
        for chunk in grounding_chunks
        if isinstance(chunk, dict) and chunk.get('chunkId')
    ]
    lesson['sourceRefs'] = source_refs
    lesson['groundingPrompt'] = build_lesson_grounding_prompt(lesson, grounding_chunks)
    lesson['groundingLabels'] = [
        str(chunk.get('citeLabel') or '')
        for chunk in lesson['groundingChunks']
        if chunk.get('citeLabel')
    ]
    return lesson


def attach_curriculum_grounding(
    lessons: list[dict],
    graph: dict,
    course_id: str,
    *,
    max_chunks: int = DEFAULT_MAX_GROUNDING_CHUNKS,
) -> list[dict]:
    for lesson in lessons:
        if isinstance(lesson, dict):
            attach_lesson_grounding(lesson, graph, course_id, max_chunks=max_chunks)
    return lessons


def lesson_grounding_metrics(lessons: list[dict]) -> dict[str, Any]:
    if not lessons:
        return {
            'lessonCount': 0,
            'groundedLessons': 0,
            'groundedFraction': 0.0,
            'withGraphRefs': 0,
            'withFileRefs': 0,
            'withTextChunks': 0,
            'avgChunksPerLesson': 0.0,
            'problemGrounded': 0,
            'problemCount': 0,
        }

    grounded = 0
    with_graph = 0
    with_file = 0
    with_chunks = 0
    chunk_total = 0
    problem_count = 0
    problem_grounded = 0

    for lesson in lessons:
        if not isinstance(lesson, dict):
            continue
        chunks = lesson.get('groundingChunks') if isinstance(lesson.get('groundingChunks'), list) else []
        refs = lesson.get('sourceRefs') if isinstance(lesson.get('sourceRefs'), list) else []
        if chunks or refs:
            grounded += 1
        if chunks:
            with_chunks += 1
            chunk_total += len(chunks)
        if any(isinstance(ref, dict) and ref.get('type') == 'graph-node' for ref in refs):
            with_graph += 1
        if any(
            isinstance(ref, dict) and ref.get('type') in {'file-page', 'graph-source-page', 'text-chunk'}
            for ref in refs
        ):
            with_file += 1
        if str(lesson.get('type') or '') == 'problem':
            problem_count += 1
            if chunks or any(ref.get('type') == 'graph-node' for ref in refs if isinstance(ref, dict)):
                problem_grounded += 1

    count = len(lessons)
    return {
        'lessonCount': count,
        'groundedLessons': grounded,
        'groundedFraction': round(grounded / count, 4) if count else 0.0,
        'withGraphRefs': with_graph,
        'withFileRefs': with_file,
        'withTextChunks': with_chunks,
        'avgChunksPerLesson': round(chunk_total / count, 2) if count else 0.0,
        'problemGrounded': problem_grounded,
        'problemCount': problem_count,
    }
