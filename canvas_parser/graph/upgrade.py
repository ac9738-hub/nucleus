GRAPH_VERSION = 2


def upgrade_graph_state(state):
    if not isinstance(state, dict):
        return {'graph_version': GRAPH_VERSION}

    version = int(state.get('graph_version', 1) or 1)
    if version >= GRAPH_VERSION:
        state.setdefault('edges', state.get('edges', []) or [])
        state.setdefault('learningBlocks', state.get('learningBlocks', {}) or {})
        state.setdefault('moduleOrderHints', state.get('moduleOrderHints', {}) or {})
        state.setdefault('external_platforms', state.get('external_platforms', {}) or {})
        return state

    state['graph_version'] = GRAPH_VERSION
    state.setdefault('edges', [])
    state.setdefault('learningBlocks', {})
    state.setdefault('moduleOrderHints', {})
    state.setdefault('external_platforms', {})

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
