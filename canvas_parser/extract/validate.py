def validate_graph_state(state, edge_store=None):
    warnings = []
    concepts = {item.get('conceptid') for item in state.get('concepts', []) if item.get('conceptid')}
    problems = {item.get('problemid') for item in state.get('problems', []) if item.get('problemid')}
    assignments = set()
    for syllabus in (state.get('syllabi', {}) or {}).values():
        for assignment in syllabus.get('assignments', []) or []:
            if assignment.get('assignmentid'):
                assignments.add(assignment.get('assignmentid'))

    learning_blocks = state.get('learningBlocks', {}) or {}
    for courseid, blocks in learning_blocks.items():
        for block in blocks or []:
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
        }))
    else:
        for edge in edges:
            if edge.get('fromType') == 'concept' and edge.get('fromId') not in concepts:
                warnings.append(f"missing concept edge source {edge.get('fromId')}")
            if edge.get('toType') == 'concept' and edge.get('toId') not in concepts:
                warnings.append(f"missing concept edge target {edge.get('toId')}")

    return warnings
