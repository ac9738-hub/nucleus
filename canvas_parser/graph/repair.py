"""Repair dangling graph edges and rebuild learning-block sequencing chains."""
from __future__ import annotations


def _collect_known_ids(state: dict) -> dict[str, set[str]]:
    concepts = {
        str(item.get('conceptid') or '')
        for item in state.get('concepts') or []
        if isinstance(item, dict) and item.get('conceptid')
    }
    problems = {
        str(item.get('problemid') or '')
        for item in state.get('problems') or []
        if isinstance(item, dict) and item.get('problemid')
    }
    events = {
        str(item.get('eventid') or '')
        for item in state.get('events') or []
        if isinstance(item, dict) and item.get('eventid')
    }
    assignments = set()
    for syllabus in (state.get('syllabi') or {}).values():
        for assignment in (syllabus or {}).get('assignments') or []:
            if assignment.get('assignmentid'):
                assignments.add(str(assignment.get('assignmentid')))

    files = set()
    for course_files in (state.get('files') or {}).values():
        for file_id, file_node in (course_files or {}).items():
            if isinstance(file_node, dict):
                files.add(str(file_node.get('fileid') or file_id))
            elif file_id:
                files.add(str(file_id))

    learning_blocks = set()
    for blocks in (state.get('learningBlocks') or {}).values():
        for block in blocks or []:
            if isinstance(block, dict) and block.get('blockId'):
                learning_blocks.add(str(block.get('blockId')))

    return {
        'concept': concepts,
        'problem': problems,
        'assignment': assignments,
        'learningBlock': learning_blocks,
        'event': events,
        'file': files,
    }


def prune_dangling_edges(state: dict) -> dict:
    """Drop edges whose endpoints are absent from the serialized graph."""
    known = _collect_known_ids(state)
    kept = []
    removed = 0
    for edge in state.get('edges') or []:
        if not isinstance(edge, dict):
            continue
        valid = True
        for node_type, node_id in (
            (edge.get('fromType'), edge.get('fromId')),
            (edge.get('toType'), edge.get('toId')),
        ):
            bucket = known.get(str(node_type or ''), set())
            if node_id and str(node_id) not in bucket:
                valid = False
                break
        if valid:
            kept.append(edge)
        else:
            removed += 1
    state['edges'] = kept
    return {'removed': removed, 'kept': len(kept)}


def rebuild_learning_block_next_edges(state: dict, *, source: str = 'repair') -> dict:
    """Replace learningBlock `next` edges with a chain following block order."""
    from canvas_parser.graph.edges import sync_learning_block_next_edges, GraphEdgeStore

    learning_blocks = state.get('learningBlocks') or {}
    block_ids = {
        str(block.get('blockId') or '')
        for blocks in learning_blocks.values()
        for block in blocks or []
        if isinstance(block, dict) and block.get('blockId')
    }

    filtered = []
    removed = 0
    for edge in state.get('edges') or []:
        if not isinstance(edge, dict):
            continue
        touches_block = (
            edge.get('fromType') == 'learningBlock' or edge.get('toType') == 'learningBlock'
        )
        if touches_block and edge.get('relation') == 'next':
            removed += 1
            continue
        if touches_block and (
            str(edge.get('fromId') or '') not in block_ids
            or str(edge.get('toId') or '') not in block_ids
        ):
            removed += 1
            continue
        filtered.append(edge)

    store = GraphEdgeStore(filtered)
    added = 0
    for course_id, blocks in learning_blocks.items():
        if not isinstance(blocks, list) or not blocks:
            continue
        ordered = sorted(
            [block for block in blocks if isinstance(block, dict) and block.get('blockId')],
            key=lambda block: int(block.get('order') or 0),
        )
        added += sync_learning_block_next_edges(store, ordered, source=source)

    state['edges'] = store.to_list()
    return {'removedStaleNext': removed, 'addedNext': added, 'blockCount': len(block_ids)}


def regenerate_learning_blocks(state: dict) -> dict:
    """Rebuild learningBlocks for every course with parsed concepts."""
    from canvas_parser.schedule.learning_blocks import build_hybrid_learning_blocks

    concepts_by_course: dict[str, list] = {}
    for concept in state.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        cid = str(concept.get('courseid') or '')
        if cid:
            concepts_by_course.setdefault(cid, []).append(concept)

    module_hints = state.get('moduleOrderHints') or {}
    problems_by_course: dict[str, dict[str, list]] = {}
    for problem in state.get('problems') or []:
        if not isinstance(problem, dict):
            continue
        cid = str(problem.get('courseid') or '')
        pid = str(problem.get('problemid') or '')
        if not cid or not pid:
            continue
        for concept_id in (problem.get('incomingConceptNodeIds') or []) + (problem.get('outgoingConceptNodeIds') or []):
            problems_by_course.setdefault(cid, {}).setdefault(str(concept_id), [])
            if pid not in problems_by_course[cid][str(concept_id)]:
                problems_by_course[cid][str(concept_id)].append(pid)

    rebuilt = {}
    block_count = 0
    for course_id, concepts in concepts_by_course.items():
        if not concepts:
            continue
        prerequisite_map = {
            str(concept.get('conceptid') or ''): concept.get('prerequisiteConceptIds') or []
            for concept in concepts
            if concept.get('conceptid')
        }
        course_hints = module_hints.get(course_id) if isinstance(module_hints.get(course_id), dict) else {}
        blocks = build_hybrid_learning_blocks(
            course_id,
            concepts,
            course_hints,
            prerequisite_map,
            problems_by_course.get(course_id, {}),
        )
        if blocks:
            rebuilt[course_id] = blocks
            block_count += len(blocks)

    state['learningBlocks'] = rebuilt
    block_stats = rebuild_learning_block_next_edges(state)
    return {'courses': len(rebuilt), 'blocks': block_count, **block_stats}


def backfill_document_order_from_source_pages(state: dict) -> dict:
    """Populate concept documentOrder from sourcePages when parser omitted it."""
    from canvas_parser.graph.sequence_hints import build_document_order, merge_document_order

    updated = 0
    for concept in state.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        existing = concept.get('documentOrder') if isinstance(concept.get('documentOrder'), dict) else {}
        if existing.get('fileId') and existing.get('pageNumber') not in (None, '', 0):
            continue
        pages = [
            page for page in (concept.get('sourcePages') or [])
            if isinstance(page, dict) and page.get('fileid')
        ]
        if not pages:
            continue
        page = pages[0]
        incoming = build_document_order(
            {
                'name': str(concept.get('name') or ''),
                'pageNumber': page.get('pageNumber'),
                'yRatio0': page.get('yScrollRatio', page.get('yScroll')),
            },
            file_id=str(page.get('fileid')),
        )
        concept['documentOrder'] = merge_document_order(existing, incoming)
        updated += 1
    return {'updatedDocumentOrder': updated}


def _page_order_follows(left: dict | None, right: dict | None) -> bool:
    from canvas_parser.graph.sequence_hints import _confident_follows

    left = left if isinstance(left, dict) else {}
    right = right if isinstance(right, dict) else {}
    if str(left.get('fileId') or '') != str(right.get('fileId') or '') or not left.get('fileId'):
        return False
    if _confident_follows(left, right):
        return True
    left_page = float(left.get('pageNumber') or 0)
    right_page = float(right.get('pageNumber') or 0)
    if left_page and right_page and right_page > left_page:
        return True
    if left_page and right_page and left_page == right_page:
        left_y = float(left.get('yRatio0') or 0)
        right_y = float(right.get('yRatio0') or 0)
        if right_y > left_y:
            return True
    return False


def _sync_prerequisite_ids_from_edges(state: dict) -> dict:
    concepts = {
        str(concept.get('conceptid') or ''): concept
        for concept in state.get('concepts') or []
        if isinstance(concept, dict) and concept.get('conceptid')
    }
    synced = 0
    for edge in state.get('edges') or []:
        if not isinstance(edge, dict):
            continue
        if edge.get('relation') != 'prerequisite':
            continue
        if edge.get('fromType') != 'concept' or edge.get('toType') != 'concept':
            continue
        target = concepts.get(str(edge.get('toId') or ''))
        prereq = str(edge.get('fromId') or '')
        if not target or not prereq:
            continue
        ids = list(target.get('prerequisiteConceptIds') or [])
        if prereq not in ids:
            ids.append(prereq)
            target['prerequisiteConceptIds'] = ids
            synced += 1
    return {'syncedPrerequisiteIds': synced}


def backfill_concept_sequence_edges(state: dict, *, source: str = 'document_order_repair') -> dict:
    """Add confident prerequisite edges from stored concept documentOrder metadata."""
    from canvas_parser.graph.edges import GraphEdgeStore
    from canvas_parser.graph.sequence_hints import document_order_sort_key

    store = GraphEdgeStore(state.get('edges') or [])
    concepts_by_course: dict[str, list] = {}
    for concept in state.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        cid = str(concept.get('courseid') or '')
        if cid:
            concepts_by_course.setdefault(cid, []).append(concept)

    added = 0
    for concepts in concepts_by_course.values():
        by_file: dict[str, list] = {}
        for concept in concepts:
            concept_id = str(concept.get('conceptid') or '')
            if not concept_id:
                continue
            order = concept.get('documentOrder') if isinstance(concept.get('documentOrder'), dict) else {}
            file_id = str(order.get('fileId') or '')
            if not file_id:
                for page in concept.get('sourcePages') or []:
                    if isinstance(page, dict) and page.get('fileid'):
                        file_id = str(page.get('fileid'))
                        if not order:
                            order = {}
                        break
            if not file_id:
                continue
            if not order.get('fileId'):
                order = {**order, 'fileId': file_id}
            by_file.setdefault(file_id, []).append({
                'conceptId': concept_id,
                'documentOrder': order,
            })

        for rows in by_file.values():
            if len(rows) < 2:
                continue
            rows.sort(key=lambda row: document_order_sort_key(row.get('documentOrder')))
            prior_row = None
            for row in rows:
                if prior_row and _page_order_follows(
                    prior_row.get('documentOrder'),
                    row.get('documentOrder'),
                ):
                    if store.add_edge(
                        'concept',
                        prior_row['conceptId'],
                        'concept',
                        row['conceptId'],
                        'prerequisite',
                        source=source,
                    ):
                        added += 1
                prior_row = row

    state['edges'] = store.to_list()
    return {'addedPrerequisite': added}


def backfill_learning_block_content(state: dict) -> dict:
    """Fill empty learning-block explanations from concept names or examples."""
    concepts = {
        str(concept.get('conceptid') or ''): concept
        for concept in state.get('concepts') or []
        if isinstance(concept, dict) and concept.get('conceptid')
    }
    updated = 0
    for blocks in (state.get('learningBlocks') or {}).values():
        for block in blocks or []:
            if not isinstance(block, dict):
                continue
            if str(block.get('explanation') or '').strip():
                continue
            concept = concepts.get(str(block.get('conceptId') or ''))
            if not concept:
                continue
            text = str(concept.get('description') or '').strip()
            if not text:
                text = str(concept.get('name') or '').strip()
            if not text:
                for example in concept.get('examples') or []:
                    if isinstance(example, dict):
                        text = str(example.get('description') or example.get('name') or '').strip()
                        if text:
                            break
            if text:
                block['explanation'] = text
                updated += 1
    return {'updatedBlockContent': updated}


def backfill_undated_test_events(state: dict) -> dict:
    """Date parser test events from syllabus assignments, prose hints, and dated siblings."""
    from canvas_parser.graph.events import (
        build_graph_exam_text,
        canonical_test_event_name,
        extract_prose_exam_hints,
        extract_syllabus_exam_hints,
        is_schedulable_date,
        normalize_event_type,
    )

    assignments_by_course: dict[str, list] = {}
    exam_text_by_course: dict[str, str] = {}
    for course_id, syllabus in (state.get('syllabi') or {}).items():
        if not isinstance(syllabus, dict):
            continue
        rows = [
            row for row in (syllabus.get('assignments') or [])
            if isinstance(row, dict)
        ]
        if rows:
            assignments_by_course[str(course_id)] = rows
        exam_text_by_course[str(course_id)] = build_graph_exam_text(state, course_id)

    dated_by_course: dict[str, dict[str, str]] = {}
    for event in state.get('events') or []:
        if not isinstance(event, dict):
            continue
        due = event.get('startdate') or event.get('enddate') or ''
        if not is_schedulable_date(due):
            continue
        if normalize_event_type(event.get('type') or '', event.get('name') or '') != 'test':
            continue
        course_id = str(event.get('courseid') or '')
        canonical = canonical_test_event_name(event.get('name') or '').casefold()
        if course_id and canonical:
            dated_by_course.setdefault(course_id, {})[canonical] = str(due)

    hint_dates_by_course: dict[str, dict[str, str]] = {}
    for course_id, text in exam_text_by_course.items():
        hints = extract_prose_exam_hints(text) + extract_syllabus_exam_hints(text)
        for hint in hints:
            canonical = canonical_test_event_name(hint.get('name') or '').casefold()
            date_text = str(hint.get('date_text') or '')
            if canonical and date_text:
                hint_dates_by_course.setdefault(course_id, {})[canonical] = date_text

    updated = 0
    for event in state.get('events') or []:
        if not isinstance(event, dict):
            continue
        if is_schedulable_date(event.get('startdate') or event.get('enddate') or ''):
            continue
        name = str(event.get('name') or '')
        if normalize_event_type(event.get('type') or '', name) != 'test':
            continue
        canonical = canonical_test_event_name(name).casefold()
        course_id = str(event.get('courseid') or '')

        due = dated_by_course.get(course_id, {}).get(canonical)
        if due:
            event['startdate'] = due
            updated += 1
            continue

        hint_date = hint_dates_by_course.get(course_id, {}).get(canonical)
        if hint_date:
            event['startdate'] = hint_date
            updated += 1
            continue

        for assignment in assignments_by_course.get(course_id, []):
            assign_name = str(assignment.get('name') or '')
            if not assign_name:
                continue
            assign_canonical = canonical_test_event_name(assign_name).casefold()
            if assign_canonical != canonical and canonical not in assign_name.casefold():
                continue
            assign_due = assignment.get('duedate') or assignment.get('due_at') or ''
            if not is_schedulable_date(assign_due):
                continue
            event['startdate'] = assign_due
            updated += 1
            break
    return {'updatedEventDates': updated}


def backfill_learning_block_sequence_edges(state: dict, *, source: str = 'learning_block_repair') -> dict:
    """Chain prerequisite edges between consecutive learning blocks in each course."""
    from canvas_parser.graph.edges import GraphEdgeStore

    store = GraphEdgeStore(state.get('edges') or [])
    added = 0
    for blocks in (state.get('learningBlocks') or {}).values():
        if not isinstance(blocks, list) or len(blocks) < 2:
            continue
        ordered = sorted(
            [block for block in blocks if isinstance(block, dict) and block.get('conceptId')],
            key=lambda block: int(block.get('order') or 0),
        )
        prior_id = None
        for block in ordered:
            concept_id = str(block.get('conceptId') or '')
            if prior_id and concept_id and store.add_edge(
                'concept',
                prior_id,
                'concept',
                concept_id,
                'prerequisite',
                source=source,
            ):
                added += 1
            prior_id = concept_id
    state['edges'] = store.to_list()
    return {'addedLearningBlockPrerequisite': added}


def prune_duplicate_stub_test_events(state: dict) -> dict:
    """Drop undated test stubs when the same course already has a dated canonical exam."""
    from canvas_parser.graph.events import (
        canonical_test_event_name,
        is_schedulable_date,
        normalize_event_type,
    )

    dated_keys: set[tuple[str, str]] = set()
    for event in state.get('events') or []:
        if not isinstance(event, dict):
            continue
        due = event.get('startdate') or event.get('enddate') or ''
        if not is_schedulable_date(due):
            continue
        if normalize_event_type(event.get('type') or '', event.get('name') or '') != 'test':
            continue
        course_id = str(event.get('courseid') or '')
        canonical = canonical_test_event_name(event.get('name') or '').casefold()
        if course_id and canonical:
            dated_keys.add((course_id, canonical))

    kept = []
    removed = 0
    for event in state.get('events') or []:
        if not isinstance(event, dict):
            kept.append(event)
            continue
        if is_schedulable_date(event.get('startdate') or event.get('enddate') or ''):
            kept.append(event)
            continue
        name = str(event.get('name') or '')
        if normalize_event_type(event.get('type') or '', name) != 'test':
            kept.append(event)
            continue
        key = (str(event.get('courseid') or ''), canonical_test_event_name(name).casefold())
        if key in dated_keys:
            removed += 1
            continue
        kept.append(event)
    state['events'] = kept
    return {'removedDuplicateStubs': removed}


def repair_graph_state(state: dict) -> dict:
    """Prune dangling edges, rebuild learning blocks, and refresh sequencing chains."""
    prune_stats = prune_dangling_edges(state)
    document_order_stats = backfill_document_order_from_source_pages(state)
    sequence_stats = backfill_concept_sequence_edges(state)
    sync_stats = _sync_prerequisite_ids_from_edges(state)
    block_regen = regenerate_learning_blocks(state)
    block_sequence_stats = backfill_learning_block_sequence_edges(state)
    content_stats = backfill_learning_block_content(state)
    event_stats = backfill_undated_test_events(state)
    stub_stats = prune_duplicate_stub_test_events(state)
    return {
        'prune': prune_stats,
        'documentOrder': document_order_stats,
        'sequence': sequence_stats,
        'prerequisiteSync': sync_stats,
        'learningBlocks': block_regen,
        'learningBlockSequence': block_sequence_stats,
        'blockContent': content_stats,
        'undatedEvents': event_stats,
        'duplicateEventStubs': stub_stats,
    }
