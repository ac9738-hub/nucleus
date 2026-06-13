class GraphEdgeStore:
    RELATIONS = {
        'prerequisite',
        'related',
        'practices',
        'requires_understanding',
        'requires',
        'assesses',
        'submission_prerequisite',
        'requires_reading',
        'requires_submission',
        'next',
    }

    def __init__(self, edges=None):
        self.edges = list(edges or [])

    def add_edge(self, from_type, from_id, to_type, to_id, relation, confidence=0.8, source='heuristic', metadata=None):
        from_id = str(from_id or '').strip()
        to_id = str(to_id or '').strip()
        relation = str(relation or '').strip()
        if not from_id or not to_id or relation not in self.RELATIONS:
            return False
        for edge in self.edges:
            if (
                edge.get('fromType') == from_type
                and edge.get('fromId') == from_id
                and edge.get('toType') == to_type
                and edge.get('toId') == to_id
                and edge.get('relation') == relation
            ):
                return False
        self.edges.append({
            'fromType': from_type,
            'fromId': from_id,
            'toType': to_type,
            'toId': to_id,
            'relation': relation,
            'confidence': confidence,
            'source': source,
            'metadata': metadata or {},
        })
        return True

    def to_list(self):
        return list(self.edges)

    def validate(self, known_ids):
        warnings = []
        for edge in self.edges:
            for node_type, node_id in (
                (edge.get('fromType'), edge.get('fromId')),
                (edge.get('toType'), edge.get('toId')),
            ):
                bucket = known_ids.get(node_type, set())
                if node_id and node_id not in bucket:
                    warnings.append(f"missing {node_type} id={node_id} for relation={edge.get('relation')}")
        return warnings


def _block_id(block):
    if isinstance(block, dict):
        return str(block.get('blockId') or '').strip()
    return str(getattr(block, 'blockId', '') or '').strip()


def sync_learning_block_next_edges(graph_edges, blocks, source='heuristic'):
    prior_id = ''
    added = 0
    for block in blocks or []:
        block_id = _block_id(block)
        if prior_id and block_id:
            if graph_edges.add_edge('learningBlock', prior_id, 'learningBlock', block_id, 'next', source=source):
                added += 1
        if block_id:
            prior_id = block_id
    return added


def sync_concept_prerequisite_edges(graph_edges, concepts, source='heuristic'):
    added = 0
    for concept in concepts or []:
        if isinstance(concept, dict):
            concept_id = str(concept.get('conceptid') or '').strip()
            prereq_ids = concept.get('prerequisiteConceptIds', []) or []
        else:
            concept_id = str(getattr(concept, 'conceptid', '') or '').strip()
            prereq_ids = getattr(concept, 'prerequisiteConceptIds', []) or []
        if not concept_id:
            continue
        for prereq_id in prereq_ids:
            prereq_id = str(prereq_id or '').strip()
            if prereq_id and graph_edges.add_edge(
                'concept', prereq_id, 'concept', concept_id, 'prerequisite', source=source
            ):
                added += 1
    return added
