def validate_graph_state(state, edge_store=None):
    warnings = []
    concepts = {item.get('conceptid') for item in state.get('concepts', []) if item.get('conceptid')}
    problems = {item.get('problemid') for item in state.get('problems', []) if item.get('problemid')}
    assignments = set()
    for syllabus in (state.get('syllabi', {}) or {}).values():
        for assignment in syllabus.get('assignments', []) or []:
            if assignment.get('assignmentid'):
                assignments.add(assignment.get('assignmentid'))

    events = {
        item.get('eventid')
        for item in state.get('events', []) or []
        if item.get('eventid')
    }
    files = set()
    for course_files in (state.get('files', {}) or {}).values():
        for file_id, file_node in (course_files or {}).items():
            if isinstance(file_node, dict):
                files.add(file_node.get('fileid') or file_id)
            elif file_id:
                files.add(file_id)

    for event in state.get('events', []) or []:
        if normalize_event_type_for_validation(event.get('type', ''), event.get('name', '')) == 'test':
            if not event.get('startdate') and not event.get('enddate'):
                warnings.append(
                    f"test event missing date eventid={event.get('eventid')} name={event.get('name')}"
                )

    learning_blocks = state.get('learningBlocks', {}) or {}
    learning_block_ids = set()
    for courseid, blocks in learning_blocks.items():
        for block in blocks or []:
            block_id = block.get('blockId')
            if block_id:
                learning_block_ids.add(block_id)
            if not block.get('conceptId'):
                warnings.append(f"learning block missing concept course={courseid} block={block.get('blockId')}")
            if not block.get('explanation') and not block.get('detailRefs'):
                warnings.append(f"learning block missing content course={courseid} block={block.get('blockId')}")

    edges = state.get('edges', []) or []
    if edge_store is not None:
        warnings.extend(edge_store.validate({
            'concept': concepts,
            'problem': problems,
            'assignment': assignments,
            'learningBlock': learning_block_ids,
            'event': events,
            'file': files,
        }))
    else:
        for edge in edges:
            if edge.get('fromType') == 'concept' and edge.get('fromId') not in concepts:
                warnings.append(f"missing concept edge source {edge.get('fromId')}")
            if edge.get('toType') == 'concept' and edge.get('toId') not in concepts:
                warnings.append(f"missing concept edge target {edge.get('toId')}")
            if edge.get('fromType') == 'event' and edge.get('fromId') not in events:
                warnings.append(f"missing event edge source {edge.get('fromId')}")
            if edge.get('toType') == 'file' and edge.get('toId') not in files:
                warnings.append(f"missing file edge target {edge.get('toId')}")

    return warnings


def assess_graph_retrieval_completeness(state) -> dict:
    """Summarize sequencing, learning-block, and chunk-edge coverage for post-parse QA."""
    metrics = {
        'coursesWithConcepts': 0,
        'coursesWithLearningBlocks': 0,
        'coursesWithModuleOrderHints': 0,
        'conceptsWithDocumentOrder': 0,
        'conceptsWithPrerequisites': 0,
        'learningBlocksWithNext': 0,
        'filesWithPages': 0,
        'filesWithTextChunks': 0,
        'filesMissingChunks': 0,
        'textChunks': 0,
        'chunksWithTeachingUnit': 0,
        'chunksWithGraphNode': 0,
        'chunksWithWeeklyItem': 0,
        'chunksWithTypeExtraction': 0,
        'sequenceEdges': 0,
        'learningBlockNextEdges': 0,
    }

    concept_courses = set()
    for concept in state.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        cid = str(concept.get('courseid') or '')
        if cid:
            concept_courses.add(cid)
        if concept.get('documentOrder') is not None:
            metrics['conceptsWithDocumentOrder'] += 1
        if concept.get('prerequisites'):
            metrics['conceptsWithPrerequisites'] += 1

    metrics['coursesWithConcepts'] = len(concept_courses)

    module_hints = state.get('moduleOrderHints') or {}
    if isinstance(module_hints, dict):
        metrics['coursesWithModuleOrderHints'] = sum(
            1 for entries in module_hints.values() if entries
        )

    learning_blocks = state.get('learningBlocks') or {}
    if isinstance(learning_blocks, dict):
        metrics['coursesWithLearningBlocks'] = sum(
            1 for blocks in learning_blocks.values() if blocks
        )
        for blocks in learning_blocks.values():
            for block in blocks or []:
                if isinstance(block, dict) and block.get('nextBlockId'):
                    metrics['learningBlocksWithNext'] += 1

    for edge in state.get('edges') or []:
        if not isinstance(edge, dict):
            continue
        relation = str(edge.get('relation') or edge.get('type') or '')
        if relation in {'follows', 'document_order', 'precedes', 'prerequisite'}:
            metrics['sequenceEdges'] += 1
        if edge.get('fromType') == 'learningBlock' and relation == 'next':
            metrics['learningBlockNextEdges'] += 1

    chunks_with_teaching = 0
    chunks_with_graph = 0
    chunks_with_weekly = 0
    chunks_with_type = 0
    for course_files in (state.get('files') or {}).values():
        for file_node in (course_files or {}).values():
            if not isinstance(file_node, dict):
                continue
            pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
            if pages:
                metrics['filesWithPages'] += 1
            chunks = file_node.get('textChunks') if isinstance(file_node.get('textChunks'), list) else []
            if chunks:
                metrics['filesWithTextChunks'] += 1
            elif pages:
                metrics['filesMissingChunks'] += 1
            for chunk in chunks:
                if not isinstance(chunk, dict):
                    continue
                metrics['textChunks'] += 1
                edge_types = {
                    str(edge.get('type') or '')
                    for edge in (chunk.get('edges') or [])
                    if isinstance(edge, dict)
                }
                if 'teaching-unit' in edge_types:
                    chunks_with_teaching += 1
                if 'graph-node' in edge_types:
                    chunks_with_graph += 1
                if 'weekly-item' in edge_types:
                    chunks_with_weekly += 1
                if 'type-extraction' in edge_types:
                    chunks_with_type += 1

    metrics['chunksWithTeachingUnit'] = chunks_with_teaching
    metrics['chunksWithGraphNode'] = chunks_with_graph
    metrics['chunksWithWeeklyItem'] = chunks_with_weekly
    metrics['chunksWithTypeExtraction'] = chunks_with_type

    if metrics['textChunks']:
        total = metrics['textChunks']
        metrics['teachingUnitRate'] = round(chunks_with_teaching / total, 4)
        metrics['graphNodeRate'] = round(chunks_with_graph / total, 4)
        metrics['weeklyItemRate'] = round(chunks_with_weekly / total, 4)
        metrics['typeExtractionRate'] = round(chunks_with_type / total, 4)
    else:
        metrics['teachingUnitRate'] = 0.0
        metrics['graphNodeRate'] = 0.0
        metrics['weeklyItemRate'] = 0.0
        metrics['typeExtractionRate'] = 0.0

    if metrics['filesWithPages']:
        metrics['chunkIndexRate'] = round(
            metrics['filesWithTextChunks'] / metrics['filesWithPages'],
            4,
        )
    else:
        metrics['chunkIndexRate'] = 0.0

    return metrics


def normalize_event_type_for_validation(eventtype='', name=''):
    from canvas_parser.graph.events import normalize_event_type

    return normalize_event_type(eventtype, name)
