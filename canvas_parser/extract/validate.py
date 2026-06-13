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


def normalize_event_type_for_validation(eventtype='', name=''):
    from canvas_parser.graph.events import normalize_event_type

    return normalize_event_type(eventtype, name)
