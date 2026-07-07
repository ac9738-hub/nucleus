"""Chunk ↔ teaching-unit ↔ graph-node edges for grounded retrieval."""
from __future__ import annotations

import re

from canvas_parser.content.teaching_blocks import (
    classify_teaching_block,
    extract_teaching_units_from_pages,
    teaching_labels_match,
)
from canvas_parser.content.chunk_embeddings import cosine_similarity
from canvas_parser.content.text_chunks import (
    assign_cite_labels,
    chunk_from_page_blocks,
    make_file_block_chunk_id,
)
from canvas_parser.content.type_extraction_retrieval import (
    attach_type_extraction_edges,
    chunk_sequential_order,
    type_extraction_chunk_score_boost,
)

NAME_TOKEN_PATTERN = re.compile(r'[a-z0-9]{3,}')
FILENAME_UNIT_PATTERNS = (
    (re.compile(r'lecture\s*(\d+)', re.I), 'lecture', 'Lecture {num}'),
    (re.compile(r'precept\s*(\d+)', re.I), 'precept', 'Precept {num}'),
    (re.compile(r'quiz\s*(\d+)', re.I), 'quiz', 'Quiz {num}'),
    (re.compile(r'week\s*(\d+)', re.I), 'week', 'Week {num}'),
    (re.compile(r'problem\s*set\s*(\d+)', re.I), 'problem_set', 'Problem Set {num}'),
    (re.compile(r'\bps\s*(\d+)\b', re.I), 'problem_set', 'Problem Set {num}'),
    (re.compile(r'C(\d{2})[_\s]', re.I), 'lecture', 'Class {num}'),
)


def filename_suggests_teaching_unit(filename):
    return _teaching_unit_from_filename(filename) is not None


def _normalize_name(value):
    return re.sub(r'[^a-z0-9]+', ' ', str(value or '').casefold()).strip()


def _names_overlap(left, right):
    left_norm = _normalize_name(left)
    right_norm = _normalize_name(right)
    if not left_norm or not right_norm:
        return False
    if left_norm == right_norm or left_norm in right_norm or right_norm in left_norm:
        return True
    left_tokens = set(NAME_TOKEN_PATTERN.findall(left_norm))
    right_tokens = set(NAME_TOKEN_PATTERN.findall(right_norm))
    if not left_tokens or not right_tokens:
        return False
    overlap = len(left_tokens & right_tokens)
    shorter = min(len(left_tokens), len(right_tokens))
    return overlap >= max(2, shorter - 1)


def _weekly_item_edge(week, item_type, name):
    return {
        'type': 'weekly-item',
        'weekLabel': str(week.get('weekLabel') or week.get('name') or ''),
        'weekStart': str(week.get('weekStart') or week.get('start_date') or ''),
        'itemType': str(item_type or ''),
        'name': str(name or ''),
    }


def _week_item_name(item):
    if isinstance(item, dict):
        return str(item.get('name') or item.get('title') or '')
    return str(item or '')


def _filename_match_candidates(filename):
    raw = str(filename or '')
    norms = []
    if raw:
        norms.append(_normalize_name(raw))
        stem = re.sub(r'\.(pdf|docx?|pptx?|xlsx?|html?|txt|jpe?g|png|webp)$', '', raw, flags=re.I)
        norms.append(_normalize_name(stem))
        norms.append(_normalize_name(raw.replace('_', ' ')))
        norms.append(_normalize_name(stem.replace('_', ' ')))
    seen = set()
    ordered = []
    for value in norms:
        if value and value not in seen:
            seen.add(value)
            ordered.append(value)
    return ordered


def attach_weekly_edges(chunks, weekly_schedule, courseid, filename=''):
    """Link chunks to weekly schedule rows by filename or text overlap."""
    if not weekly_schedule or not chunks:
        return chunks

    weeks = weekly_schedule
    if isinstance(weekly_schedule, dict):
        weeks = weekly_schedule.get(str(courseid)) or weekly_schedule.get(courseid) or []
    if not isinstance(weeks, list):
        return chunks

    file_norm = _normalize_name(filename)
    file_candidates = _filename_match_candidates(filename)
    file_level_edges = []
    for week in weeks:
        if not isinstance(week, dict):
            continue
        for item_type, bucket_key in (
            ('file', 'files'),
            ('assignment', 'assignments'),
            ('event', 'events'),
        ):
            for item in week.get(bucket_key) or []:
                item_name = _week_item_name(item)
                if not item_name:
                    continue
                if any(_names_overlap(item_name, candidate) for candidate in file_candidates):
                    edge = _weekly_item_edge(week, item_type, item_name)
                    if edge not in file_level_edges:
                        file_level_edges.append(edge)

    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        edges = list(chunk.get('edges') or []) if isinstance(chunk.get('edges'), list) else []
        for edge in file_level_edges:
            if edge not in edges:
                edges.append(edge)
        text_norm = _normalize_name(chunk.get('text', ''))
        edge_names = [
            str(edge.get('name') or '')
            for edge in edges
            if isinstance(edge, dict) and edge.get('name')
        ]
        candidates = [text_norm, *map(_normalize_name, edge_names)]
        candidates = [value for value in candidates if value]

        for week in weeks:
            if not isinstance(week, dict):
                continue
            for item_type, bucket_key in (
                ('file', 'files'),
                ('assignment', 'assignments'),
                ('event', 'events'),
            ):
                for item in week.get(bucket_key) or []:
                    item_name = _week_item_name(item)
                    if not item_name:
                        continue
                    if not any(_names_overlap(item_name, candidate) for candidate in candidates):
                        continue
                    edge = _weekly_item_edge(week, item_type, item_name)
                    if edge not in edges:
                        edges.append(edge)
        chunk['edges'] = edges
    return chunks


def attach_teaching_from_weekly_edges(chunks, graph_nodes=None):
    """Infer teaching-unit edges from weekly-item labels (assignments/events/files)."""
    graph_nodes = list(graph_nodes or [])
    for chunk in chunks or []:
        if not isinstance(chunk, dict):
            continue
        edges = list(chunk.get('edges') or []) if isinstance(chunk.get('edges'), list) else []
        if any(isinstance(edge, dict) and edge.get('type') == 'teaching-unit' for edge in edges):
            continue
        unit = None
        for edge in edges:
            if not isinstance(edge, dict) or edge.get('type') != 'weekly-item':
                continue
            unit = _teaching_unit_from_filename(str(edge.get('name') or ''))
            if unit:
                break
        if not unit:
            continue
        edges.append(_teaching_unit_edge(unit, block_index=0))
        if graph_nodes:
            for node_edge in match_graph_nodes_to_unit(unit, graph_nodes):
                if node_edge not in edges:
                    edges.append(node_edge)
        chunk['edges'] = edges
    return chunks


def _unit_key(unit):
    return (
        str(unit.get('type') or ''),
        str(unit.get('name') or '').casefold(),
        str(unit.get('pageid') or ''),
    )


def _chunk_key(chunk):
    source = chunk.get('source') if isinstance(chunk.get('source'), dict) else {}
    return (
        str(source.get('type') or ''),
        str(source.get('pageid') or ''),
        str(source.get('blockIndex') if source.get('blockIndex') is not None else ''),
    )


def _teaching_unit_edge(unit, block_index=None):
    return {
        'type': 'teaching-unit',
        'unitType': str(unit.get('type') or ''),
        'name': str(unit.get('name') or ''),
        'pageid': str(unit.get('pageid') or ''),
        'pageNumber': unit.get('pageNumber'),
        'blockIndex': block_index,
    }


def _teaching_unit_from_filename(filename):
    text = str(filename or '')
    for pattern, unit_type, label in FILENAME_UNIT_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        num = match.group(1).lstrip('0') or match.group(1)
        return {
            'type': unit_type,
            'name': label.format(num=num),
            'pageid': '',
            'pageNumber': None,
        }
    return None


def _apply_filename_teaching_fallback(chunks, filename, graph_nodes):
    """Tag chunks with a lecture/precept unit inferred from the file name."""
    unit = _teaching_unit_from_filename(filename)
    if not unit:
        return chunks
    node_edges = match_graph_nodes_to_unit(unit, graph_nodes)
    for chunk in chunks or []:
        if not isinstance(chunk, dict):
            continue
        edges = list(chunk.get('edges') or []) if isinstance(chunk.get('edges'), list) else []
        if any(isinstance(edge, dict) and edge.get('type') == 'teaching-unit' for edge in edges):
            continue
        edges.append(_teaching_unit_edge(unit, block_index=0))
        for node_edge in node_edges:
            if node_edge not in edges:
                edges.append(node_edge)
        chunk['edges'] = edges
    return chunks


def _graph_node_edge(node_type, node_id, name):
    return {
        'type': 'graph-node',
        'nodeType': str(node_type or ''),
        'nodeId': str(node_id or ''),
        'name': str(name or ''),
    }


def link_block_to_teaching_unit(block, block_index, page, units_by_key):
    classified = classify_teaching_block(block.get('text', ''))
    if not classified:
        return None
    pageid = str(page.get('pageid') or '')
    key = (classified['type'], classified['name'].casefold(), pageid)
    unit = units_by_key.get(key)
    if not unit:
        for candidate in units_by_key.values():
            if str(candidate.get('pageid') or '') != pageid:
                continue
            if candidate.get('type') != classified['type']:
                continue
            if teaching_labels_match(candidate.get('name', ''), classified['name']):
                unit = candidate
                break
    if not unit:
        return None
    return _teaching_unit_edge(unit, block_index)


def infer_teaching_edges_from_graph_nodes(block, block_index, page, graph_nodes, *, max_nodes=3):
    """Infer teaching-unit + graph-node edges when block text matches parsed concepts."""
    text = str(block.get('text') or '').strip()
    if len(text) < 4 or not graph_nodes:
        return None, []

    pageid = str(page.get('pageid') or '')
    page_number = page.get('pageNumber')
    matches = []
    for node_type, node_id, name in graph_nodes:
        if len(name) < 4:
            continue
        if (
            teaching_labels_match(text, name)
            or teaching_labels_match(name, text)
            or _names_overlap(text, name)
        ):
            matches.append((node_type, node_id, name))

    if not matches:
        return None, []

    matches.sort(key=lambda row: len(row[2]))
    node_type, node_id, name = matches[0]
    unit_edge = _teaching_unit_edge(
        {
            'type': 'concept' if node_type == 'detail' else node_type,
            'name': name,
            'pageid': pageid,
            'pageNumber': page_number,
        },
        block_index,
    )
    node_edges = [
        _graph_node_edge(match_type, match_id, match_name)
        for match_type, match_id, match_name in matches[:max_nodes]
    ]
    return unit_edge, node_edges


def collect_graph_nodes_for_file(graph, course_id, file_id, filename=''):
    """Yield (node_type, node_id, name) tuples sourced from this file."""
    file_id = str(file_id)
    course_id = str(course_id)
    seen: set[tuple[str, str]] = set()

    def emit(node_type, node_id, name):
        key = (node_type, str(node_id or ''))
        if not name or key in seen:
            return
        seen.add(key)
        yield node_type, str(node_id or ''), str(name)

    for concept in graph.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        if str(concept.get('courseid') or '') != course_id:
            continue
        concept_id = str(concept.get('conceptid') or concept.get('name') or '')
        source_pages = concept.get('sourcePages') if isinstance(concept.get('sourcePages'), list) else []
        if not any(str(page.get('fileid') or '') == file_id for page in source_pages if isinstance(page, dict)):
            continue
        concept_name = str(concept.get('name') or '')
        if concept_name:
            yield from emit('concept', concept_id, concept_name)
        for detail in concept.get('details') or []:
            if isinstance(detail, dict) and detail.get('name'):
                yield from emit('detail', f"{concept_id}:{detail['name']}", detail['name'])
        for example in concept.get('examples') or []:
            if isinstance(example, dict) and example.get('name'):
                yield from emit('example', f"{concept_id}:{example['name']}", example['name'])

    for problem in graph.get('problems') or []:
        if not isinstance(problem, dict):
            continue
        if str(problem.get('courseid') or '') != course_id:
            continue
        source_pages = problem.get('sourcePages') if isinstance(problem.get('sourcePages'), list) else []
        if not any(str(page.get('fileid') or '') == file_id for page in source_pages if isinstance(page, dict)):
            continue
        if problem.get('name'):
            yield from emit('problem', str(problem.get('problemid') or problem['name']), problem['name'])

    ps_match = re.search(r'problem\s*set\s*(\d+)|\bps\s*(\d+)\b', str(filename or ''), re.I)
    if ps_match:
        ps_num = ps_match.group(1) or ps_match.group(2)
        for problem in graph.get('problems') or []:
            if not isinstance(problem, dict):
                continue
            if str(problem.get('courseid') or '') != course_id:
                continue
            pname = str(problem.get('name') or '')
            if re.search(rf'\b(?:problem\s*set|ps)\s*0*{re.escape(ps_num)}\b', pname, re.I):
                yield from emit('problem', str(problem.get('problemid') or pname), pname)

    for store_key, node_type, name_key in (
        ('logged_details', 'detail', 'detailname'),
        ('logged_examples', 'example', 'examplename'),
        ('logged_problems', 'problem', 'problemname'),
    ):
        for logged_course, entries in (graph.get(store_key) or {}).items():
            if str(logged_course) != course_id:
                continue
            for entry in entries or []:
                if str(entry.get('sourceFileId') or '') != file_id:
                    continue
                name = entry.get(name_key) or entry.get('conceptname') or ''
                if name:
                    yield from emit(node_type, str(name), str(name))


def match_graph_nodes_to_unit(unit, graph_nodes):
    matches = []
    unit_name = str(unit.get('name') or '')
    for node_type, node_id, name in graph_nodes:
        if teaching_labels_match(unit_name, name):
            matches.append(_graph_node_edge(node_type, node_id, name))
    return matches


def attach_graph_nodes_by_chunk_text(chunks, graph_nodes, *, min_name_len=4):
    """Link citeable chunks to file-scoped graph nodes by label overlap."""
    if not chunks or not graph_nodes:
        return chunks
    node_list = list(graph_nodes)
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        edges = list(chunk.get('edges') or []) if isinstance(chunk.get('edges'), list) else []
        if any(isinstance(edge, dict) and edge.get('type') == 'graph-node' for edge in edges):
            continue
        text = str(chunk.get('text') or '')
        if len(text.strip()) < min_name_len:
            continue
        for node_type, node_id, name in node_list:
            if len(name) < min_name_len:
                continue
            if (
                teaching_labels_match(text, name)
                or teaching_labels_match(name, text)
                or _names_overlap(text, name)
            ):
                edge = _graph_node_edge(node_type, node_id, name)
                if edge not in edges:
                    edges.append(edge)
        chunk['edges'] = edges
    return chunks


def attach_teaching_from_weekly_edges(chunks, graph_nodes=None):
    """Infer teaching-unit edges from weekly-item labels (assignments/events/files)."""
    graph_nodes = list(graph_nodes or [])
    for chunk in chunks or []:
        if not isinstance(chunk, dict):
            continue
        edges = list(chunk.get('edges') or []) if isinstance(chunk.get('edges'), list) else []
        if any(isinstance(edge, dict) and edge.get('type') == 'teaching-unit' for edge in edges):
            continue
        unit = None
        for edge in edges:
            if not isinstance(edge, dict) or edge.get('type') != 'weekly-item':
                continue
            unit = _teaching_unit_from_filename(str(edge.get('name') or ''))
            if unit:
                break
        if not unit:
            continue
        edges.append(_teaching_unit_edge(unit, block_index=0))
        if graph_nodes:
            for node_edge in match_graph_nodes_to_unit(unit, graph_nodes):
                if node_edge not in edges:
                    edges.append(node_edge)
        chunk['edges'] = edges
    return chunks


def build_file_chunk_graph(
    pages,
    *,
    courseid='',
    fileid='',
    filename='',
    graph=None,
    weekly_schedule=None,
    type_extractions=None,
    max_chunks=48,
):
    """Build chunks with teaching-unit, graph-node, weekly, and type-extraction edges."""
    chunks = chunk_from_page_blocks(
        pages,
        courseid=courseid,
        fileid=fileid,
        max_chunks=max_chunks,
    )
    units = extract_teaching_units_from_pages(pages)
    units_by_key = {_unit_key(unit): unit for unit in units}
    graph_nodes = list(collect_graph_nodes_for_file(graph or {}, courseid, fileid, filename))

    enriched = []
    for chunk in chunks:
        source = chunk.get('source') if isinstance(chunk.get('source'), dict) else {}
        pageid = str(source.get('pageid') or '')
        block_index = source.get('blockIndex')
        edges = []

        for page in pages or []:
            if not isinstance(page, dict) or str(page.get('pageid') or '') != pageid:
                continue
            blocks = page.get('blocks') if isinstance(page.get('blocks'), list) else []
            if block_index is not None and 0 <= int(block_index) < len(blocks):
                unit_edge = link_block_to_teaching_unit(blocks[int(block_index)], block_index, page, units_by_key)
                if unit_edge:
                    edges.append(unit_edge)
                    for node_edge in match_graph_nodes_to_unit(
                        {'name': unit_edge['name'], 'type': unit_edge['unitType']},
                        graph_nodes,
                    ):
                        if node_edge not in edges:
                            edges.append(node_edge)
                elif graph_nodes:
                    inferred_unit, inferred_nodes = infer_teaching_edges_from_graph_nodes(
                        blocks[int(block_index)],
                        block_index,
                        page,
                        graph_nodes,
                    )
                    if inferred_unit:
                        edges.append(inferred_unit)
                    for node_edge in inferred_nodes:
                        if node_edge not in edges:
                            edges.append(node_edge)
            break

        enriched.append({**chunk, 'edges': edges})

    enriched = attach_graph_nodes_by_chunk_text(enriched, graph_nodes)
    enriched = _apply_filename_teaching_fallback(enriched, filename, graph_nodes)
    enriched = attach_weekly_edges(
        enriched,
        weekly_schedule,
        courseid,
        filename=filename,
    )
    enriched = attach_teaching_from_weekly_edges(enriched, graph_nodes)
    if type_extractions:
        enriched = attach_type_extraction_edges(enriched, type_extractions)
    return assign_cite_labels(enriched)


def persist_text_chunks_on_file_node(file_node, text_chunks):
    if not isinstance(file_node, dict):
        return file_node
    slim = []
    for chunk in text_chunks or []:
        if not isinstance(chunk, dict) or not chunk.get('chunkId'):
            continue
        slim.append({
            'chunkId': chunk['chunkId'],
            'text': chunk.get('text', ''),
            'citeLabel': chunk.get('citeLabel', ''),
            'source': chunk.get('source') if isinstance(chunk.get('source'), dict) else {},
            'edges': chunk.get('edges') if isinstance(chunk.get('edges'), list) else [],
            'embedded': chunk.get('embedded') if isinstance(chunk.get('embedded'), dict) else {},
        })
    file_node['textChunks'] = slim
    return file_node


def _merge_cached_embeddings(fresh_chunks, cached_chunks):
    if not cached_chunks:
        return fresh_chunks
    by_id = {
        str(chunk.get('chunkId') or ''): chunk
        for chunk in cached_chunks
        if isinstance(chunk, dict) and chunk.get('chunkId')
    }
    for chunk in fresh_chunks:
        if not isinstance(chunk, dict):
            continue
        cached = by_id.get(str(chunk.get('chunkId') or ''))
        if not cached:
            continue
        embedded = cached.get('embedded')
        if isinstance(embedded, dict) and embedded:
            chunk['embedded'] = embedded
    return fresh_chunks


def chunks_from_file_node(
    file_node,
    *,
    courseid='',
    fileid='',
    max_chunks=48,
    graph=None,
    weekly_schedule=None,
):
    if not isinstance(file_node, dict):
        return []
    type_extractions = file_node.get('typeExtractions') if isinstance(file_node.get('typeExtractions'), dict) else {}
    cached = file_node.get('textChunks')
    pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
    cid = str(courseid or file_node.get('courseid') or '')
    fid = str(fileid or file_node.get('fileid') or '')

    if graph is not None or weekly_schedule is not None:
        if pages:
            fresh = build_file_chunk_graph(
                pages,
                courseid=cid,
                fileid=fid,
                filename=str(file_node.get('name') or ''),
                graph=graph,
                weekly_schedule=weekly_schedule,
                type_extractions=type_extractions,
                max_chunks=max_chunks,
            )
            if isinstance(cached, list) and cached:
                fresh = _merge_cached_embeddings(fresh, cached)
            return assign_cite_labels(fresh[:max_chunks])

    if isinstance(cached, list) and cached:
        chunks = assign_cite_labels(cached[:max_chunks])
        if type_extractions:
            chunks = attach_type_extraction_edges(chunks, type_extractions)
        return chunks
    if not pages:
        return []
    chunks = build_file_chunk_graph(
        pages,
        courseid=cid,
        fileid=fid,
        filename=str(file_node.get('name') or ''),
        type_extractions=type_extractions,
        max_chunks=max_chunks,
    )
    return assign_cite_labels(chunks)


def select_chunks_for_query(chunks, query='', max_chunks=6, query_embedding=None):
    """Rank file chunks by semantic + lexical overlap with the query."""
    terms = [
        token
        for token in __import__('re').findall(r'[a-z0-9]{3,}', str(query or '').casefold())
    ]
    if not terms and query_embedding is None:
        return assign_cite_labels((chunks or [])[:max_chunks])

    scored = []
    for chunk in chunks or []:
        text = str(chunk.get('text') or '').casefold()
        edge_text = ' '.join(
            str(edge.get('name') or '')
            for edge in (chunk.get('edges') or [])
            if isinstance(edge, dict)
        ).casefold()
        haystack = f"{text} {edge_text}"
        lexical = sum(1 for term in terms if term in haystack) if terms else 0
        semantic = 0.0
        if query_embedding is not None:
            embedded = chunk.get('embedded') if isinstance(chunk.get('embedded'), dict) else {}
            chunk_vector = embedded.get('text')
            if chunk_vector is not None:
                semantic = cosine_similarity(query_embedding, chunk_vector)
        type_boost = type_extraction_chunk_score_boost(query, chunk)
        score = lexical + (semantic * 3.0) + type_boost
        order = chunk_sequential_order(chunk)
        scored.append((score, semantic, lexical, order, chunk))

    scored.sort(
        key=lambda item: (-item[0], -item[1], -item[2], item[3], str(item[4].get('chunkId') or '')),
    )
    if terms:
        selected = [chunk for score, _, lexical, _, chunk in scored if lexical > 0 or score > 0.15][:max_chunks]
    else:
        selected = [chunk for score, _, _, _, chunk in scored if score > 0.15][:max_chunks]
    if not selected:
        selected = [chunk for _, _, _, _, chunk in scored[:max_chunks]]
    return assign_cite_labels(selected)


def summarize_chunk_graph(text_chunks):
    chunks = text_chunks if isinstance(text_chunks, list) else []
    with_units = sum(
        1 for chunk in chunks
        if any(
            isinstance(edge, dict) and edge.get('type') == 'teaching-unit'
            for edge in (chunk.get('edges') or [])
        )
    )
    with_nodes = sum(
        1 for chunk in chunks
        if any(
            isinstance(edge, dict) and edge.get('type') == 'graph-node'
            for edge in (chunk.get('edges') or [])
        )
    )
    with_weekly = sum(
        1 for chunk in chunks
        if any(
            isinstance(edge, dict) and edge.get('type') == 'weekly-item'
            for edge in (chunk.get('edges') or [])
        )
    )
    with_type = sum(
        1 for chunk in chunks
        if any(
            isinstance(edge, dict) and edge.get('type') == 'type-extraction'
            for edge in (chunk.get('edges') or [])
        )
    )
    return {
        'chunkCount': len(chunks),
        'withTeachingUnit': with_units,
        'withGraphNode': with_nodes,
        'withWeeklyItem': with_weekly,
        'withTypeExtraction': with_type,
        'edgeRate': round(with_units / len(chunks), 4) if chunks else 0.0,
    }
