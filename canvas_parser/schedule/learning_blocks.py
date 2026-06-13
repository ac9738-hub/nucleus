def topological_sort_concepts(concepts, prerequisite_map):
    concept_ids = [concept.get('conceptid') for concept in concepts if concept.get('conceptid')]
    indegree = {concept_id: 0 for concept_id in concept_ids}
    adjacency = {concept_id: [] for concept_id in concept_ids}

    for concept_id, prereqs in prerequisite_map.items():
        if concept_id not in indegree:
            continue
        for prereq in prereqs:
            if prereq not in indegree:
                continue
            adjacency[prereq].append(concept_id)
            indegree[concept_id] += 1

    queue = [concept_id for concept_id, degree in indegree.items() if degree == 0]
    ordered = []
    while queue:
        current = queue.pop(0)
        ordered.append(current)
        for neighbor in adjacency.get(current, []):
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)

    if len(ordered) != len(concept_ids):
        remaining = [concept_id for concept_id in concept_ids if concept_id not in ordered]
        ordered.extend(remaining)
    return ordered


def build_hybrid_learning_blocks(
    courseid,
    concepts,
    module_order_hints,
    prerequisite_map,
    problems_by_concept,
):
    concepts_by_id = {concept.get('conceptid'): concept for concept in concepts if concept.get('conceptid')}
    module_buckets = {}
    for concept_id, concept in concepts_by_id.items():
        hints = concept.get('moduleOrderHints') or module_order_hints.get(concept_id) or []
        if not hints:
            module_buckets.setdefault('unscheduled', []).append(concept_id)
            continue
        for hint in hints:
            module_id = str(hint.get('moduleId', 'unscheduled'))
            module_buckets.setdefault(module_id, []).append({
                'conceptId': concept_id,
                'position': int(hint.get('position', 0) or 0),
            })

    def module_sort_key(module_id):
        if module_id == 'unscheduled':
            return (1, 0, module_id)
        entries = module_buckets.get(module_id) or []
        if entries and isinstance(entries[0], dict):
            min_position = min(item.get('position', 0) for item in entries)
        else:
            min_position = 0
        return (0, min_position, module_id)

    sorted_module_ids = sorted(module_buckets.keys(), key=module_sort_key)

    ordered_concept_ids = []
    for module_id in sorted_module_ids:
        entries = module_buckets[module_id]
        if not entries:
            continue
        if isinstance(entries[0], str):
            module_concepts = entries
        else:
            module_concepts = [entry['conceptId'] for entry in sorted(entries, key=lambda item: item.get('position', 0))]
        module_subset = [concepts_by_id[concept_id] for concept_id in module_concepts if concept_id in concepts_by_id]
        topo = topological_sort_concepts(module_subset, prerequisite_map)
        ordered_concept_ids.extend(topo)

    seen = set()
    final_order = []
    for concept_id in ordered_concept_ids:
        if concept_id in seen:
            continue
        seen.add(concept_id)
        final_order.append(concept_id)

    blocks = []
    for order, concept_id in enumerate(final_order, start=1):
        concept = concepts_by_id.get(concept_id)
        if not concept:
            continue
        detail_refs = [f"detail:{concept_id}:{detail.get('name')}" for detail in concept.get('details', []) if detail.get('name')]
        example_refs = [f"example:{concept_id}:{example.get('name')}" for example in concept.get('examples', []) if example.get('name')]
        blocks.append({
            'blockId': f"{courseid}-{concept_id}-block",
            'courseid': courseid,
            'order': order,
            'conceptId': concept_id,
            'explanation': concept.get('description', ''),
            'detailRefs': detail_refs,
            'examples': example_refs,
            'practiceProblems': list(problems_by_concept.get(concept_id, [])),
            'sourceRefs': concept.get('sourcePages', []) or [],
            'orderSource': 'merged',
        })
    return blocks
