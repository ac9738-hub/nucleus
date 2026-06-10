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
