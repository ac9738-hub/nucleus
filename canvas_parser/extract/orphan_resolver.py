def _group_logged_items(items, concept_name_key):
    grouped = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        concept_name = item.get(concept_name_key, '')
        grouped.setdefault(concept_name, []).append(item)
    return grouped


def resolve_logged_orphans(courseid, logged_details, logged_examples, logged_problems, concept_nodes, add_detail_node, add_example_node, add_problem_node):
    """Create nodes for pass-1 logged items that never received pass-2 links."""
    resolved = {'details': 0, 'examples': 0, 'problems': 0}
    details_by_concept = _group_logged_items(logged_details.get(courseid, []), 'conceptname')
    examples_by_concept = _group_logged_items(logged_examples.get(courseid, []), 'conceptname')
    problems_logged = logged_problems.get(courseid, []) or []

    for concept in concept_nodes:
        concept_id = concept.conceptid
        concept_name = concept.name

        for detail in details_by_concept.get(concept_name, []):
            detail_name = detail.get('detailname')
            if not detail_name:
                continue
            if any(existing.name == detail_name for existing in concept.details):
                continue
            add_detail_node(courseid, concept_id, detail_name, detail.get('description', ''))
            resolved['details'] += 1

        for example in examples_by_concept.get(concept_name, []):
            example_name = example.get('examplename')
            if not example_name:
                continue
            if any(existing.name == example_name for existing in concept.examples):
                continue
            add_example_node(courseid, concept_id, example_name, example.get('description', ''))
            resolved['examples'] += 1

    for problem in problems_logged:
        if not isinstance(problem, dict):
            continue
        problem_name = problem.get('problemname')
        if not problem_name:
            continue
        incoming_names = problem.get('incomingConceptNames', []) or []
        outgoing_names = problem.get('outgoingConceptNames', []) or []
        incoming_ids = []
        outgoing_ids = []
        for concept in concept_nodes:
            names = {concept.name.casefold(), concept.conceptid}
            if any(str(name).casefold() in names or str(name) in names for name in incoming_names):
                incoming_ids.append(concept.conceptid)
            if any(str(name).casefold() in names or str(name) in names for name in outgoing_names):
                outgoing_ids.append(concept.conceptid)
        if not incoming_ids and not outgoing_ids and concept_nodes:
            incoming_ids = [concept_nodes[0].conceptid]
        add_problem_node(
            courseid,
            problem_name,
            incoming_ids,
            outgoing_ids,
            problem.get('steps', []) or [],
            problem.get('answer', 'None'),
            [],
        )
        resolved['problems'] += 1

    return resolved
