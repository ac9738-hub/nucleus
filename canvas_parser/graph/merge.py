import re


def _normalize_name(value):
    return re.sub(r'\s+', ' ', str(value or '').strip().casefold())


def _cosine_similarity(left, right):
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = sum(a * a for a in left) ** 0.5
    right_norm = sum(b * b for b in right) ** 0.5
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def _concept_embedding(concept):
    embedded = concept.embedded if hasattr(concept, 'embedded') else concept.get('embedded', {})
    if not isinstance(embedded, dict):
        return None
    for key in ('description', 'name'):
        vector = embedded.get(key)
        if isinstance(vector, list) and vector:
            return vector
    return None


def merge_duplicate_concepts(course_concepts, similarity_threshold=0.92):
    if not course_concepts:
        return [], {}

    id_remap = {}
    kept = []
    for concept in course_concepts:
        concept_name = _normalize_name(getattr(concept, 'name', '') or concept.get('name', ''))
        concept_id = getattr(concept, 'conceptid', '') or concept.get('conceptid', '')
        embedding = _concept_embedding(concept)
        merged = False

        for existing in kept:
            existing_name = _normalize_name(existing.name)
            if concept_name and existing_name and concept_name == existing_name:
                _absorb_concept(existing, concept, concept_id, id_remap)
                merged = True
                break
            existing_embedding = _concept_embedding(existing)
            if embedding and existing_embedding and _cosine_similarity(embedding, existing_embedding) >= similarity_threshold:
                _absorb_concept(existing, concept, concept_id, id_remap)
                merged = True
                break

        if not merged:
            kept.append(concept)

    return kept, id_remap


def _absorb_concept(target, source, source_id, id_remap):
    if source_id and source_id != target.conceptid:
        id_remap[source_id] = target.conceptid
        if source_id not in target.aliases:
            target.aliases.append(source_id)
    source_name = getattr(source, 'name', '')
    if source_name and source_name not in target.aliases:
        target.aliases.append(source_name)
    if not target.description and getattr(source, 'description', ''):
        target.description = source.description
    for detail in getattr(source, 'details', []) or []:
        if not any(existing.name == detail.name for existing in target.details):
            target.details.append(detail)
    for example in getattr(source, 'examples', []) or []:
        if not any(existing.name == example.name for existing in target.examples):
            target.examples.append(example)
    for problem_id in getattr(source, 'problems', []) or []:
        if problem_id not in target.problems:
            target.problems.append(problem_id)
    for prereq in getattr(source, 'prerequisiteConceptIds', []) or []:
        if prereq not in target.prerequisiteConceptIds:
            target.prerequisiteConceptIds.append(prereq)
    for hint in getattr(source, 'moduleOrderHints', []) or []:
        if hint not in target.moduleOrderHints:
            target.moduleOrderHints.append(hint)


def remap_identifier(value, id_remap):
    return id_remap.get(value, value)


def apply_concept_id_remap(courseid, concept_nodes, problems_dict, graph_edges, id_remap):
    if not id_remap:
        return

    for concept in concept_nodes.get(courseid, []) or []:
        concept.prerequisiteConceptIds = [
            remap_identifier(item, id_remap) for item in concept.prerequisiteConceptIds
        ]

    for problem in problems_dict.get(courseid, []) or []:
        problem.incomingConceptNodeIds = [
            remap_identifier(item, id_remap) for item in problem.incomingConceptNodeIds
        ]
        problem.outgoingConceptNodeIds = [
            remap_identifier(item, id_remap) for item in problem.outgoingConceptNodeIds
        ]

    for edge in graph_edges.edges:
        if edge.get('fromType') == 'concept':
            edge['fromId'] = remap_identifier(edge.get('fromId'), id_remap)
        if edge.get('toType') == 'concept':
            edge['toId'] = remap_identifier(edge.get('toId'), id_remap)
