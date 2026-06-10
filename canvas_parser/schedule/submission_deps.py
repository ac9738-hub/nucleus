def apply_external_submission_mapping(assignment, mapping):
    dependency = {
        'type': 'external_platform',
        'platform': 'gradescope',
        'externalAssignmentId': str(mapping.get('gradescopeAssignmentId', '')),
        'url': mapping.get('gradescopeUrl', ''),
        'label': mapping.get('gradescopeAssignmentTitle', ''),
        'submissionStatus': mapping.get('submissionStatus', 'unknown'),
        'dueText': mapping.get('dueText', ''),
    }
    existing = assignment.submissionDependencies or []
    if not any(
        item.get('platform') == 'gradescope' and item.get('externalAssignmentId') == dependency['externalAssignmentId']
        for item in existing
    ):
        existing.append(dependency)
    assignment.submissionDependencies = existing
    assignment.submissionLinks = assignment.submissionLinks or []
    if dependency.get('url') and not any(link.get('url') == dependency['url'] for link in assignment.submissionLinks):
        assignment.submissionLinks.append({
            'url': dependency['url'],
            'label': dependency.get('label', ''),
            'platform': 'gradescope',
        })
    if 'external_tool' not in assignment.submissionTypes:
        assignment.submissionTypes.append('external_tool')
    return dependency


def build_external_platform_state(gradescope_state):
    if not gradescope_state:
        return {}
    return {
        'gradescope': {
            'synced_at': gradescope_state.get('synced_at', ''),
            'courses': gradescope_state.get('courses', []),
            'mappings': gradescope_state.get('mappings', []),
        }
    }
