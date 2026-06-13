GRAPH_VERSION = 3


def upgrade_graph_state(state):
    if not isinstance(state, dict):
        return {'graph_version': GRAPH_VERSION}

    version = int(state.get('graph_version', 1) or 1)
    if version >= GRAPH_VERSION:
        state.setdefault('edges', state.get('edges', []) or [])
        state.setdefault('learningBlocks', state.get('learningBlocks', {}) or {})
        state.setdefault('moduleOrderHints', state.get('moduleOrderHints', {}) or {})
        state.setdefault('courseModules', state.get('courseModules', {}) or {})
        state.setdefault('external_platforms', state.get('external_platforms', {}) or {})
        state.setdefault('looking_for_in_canvas', state.get('looking_for_in_canvas', {}) or {})
        state.setdefault('url_to_node', state.get('url_to_node', {}) or {})
        state.setdefault('assignment_resource_nodes', state.get('assignment_resource_nodes', {}) or {})
        return state

    state['graph_version'] = GRAPH_VERSION
    state.setdefault('edges', [])
    state.setdefault('learningBlocks', {})
    state.setdefault('moduleOrderHints', {})
    state.setdefault('courseModules', {})
    state.setdefault('external_platforms', {})
    state.setdefault('looking_for_in_canvas', {})
    state.setdefault('url_to_node', {})
    state.setdefault('assignment_resource_nodes', {})

    for concept in state.get('concepts', []) or []:
        concept.setdefault('prerequisiteConceptIds', [])
        concept.setdefault('aliases', [])
        concept.setdefault('moduleOrderHints', [])

    for syllabus in (state.get('syllabi', {}) or {}).values():
        for assignment in syllabus.get('assignments', []) or []:
            assignment.setdefault('submissionTypes', [])
            assignment.setdefault('submissionLinks', [])
            assignment.setdefault('submissionDependencies', [])
            assignment.setdefault('conceptRequirements', [])

    return state
