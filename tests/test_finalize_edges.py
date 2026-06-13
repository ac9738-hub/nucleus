import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.edges import (
    GraphEdgeStore,
    sync_concept_prerequisite_edges,
    sync_learning_block_next_edges,
)


def test_sync_learning_block_next_edges_creates_chain():
    store = GraphEdgeStore()
    blocks = [
        {'blockId': '17581-aaa-block', 'order': 1},
        {'blockId': '17581-bbb-block', 'order': 2},
        {'blockId': '17581-ccc-block', 'order': 3},
    ]

    added = sync_learning_block_next_edges(store, blocks)

    assert added == 2
    assert len(store.edges) == 2
    assert store.edges[0]['relation'] == 'next'
    assert store.edges[0]['fromId'] == '17581-aaa-block'
    assert store.edges[0]['toId'] == '17581-bbb-block'
    assert store.edges[1]['fromId'] == '17581-bbb-block'
    assert store.edges[1]['toId'] == '17581-ccc-block'


def test_sync_learning_block_next_edges_is_idempotent():
    store = GraphEdgeStore()
    blocks = [
        {'blockId': 'course-a-block'},
        {'blockId': 'course-b-block'},
    ]

    assert sync_learning_block_next_edges(store, blocks) == 1
    assert sync_learning_block_next_edges(store, blocks) == 0
    assert len(store.edges) == 1


def test_sync_concept_prerequisite_edges_from_concept_nodes():
    store = GraphEdgeStore()
    concepts = [
        {
            'conceptid': 'concept-b',
            'prerequisiteConceptIds': ['concept-a'],
        },
        {
            'conceptid': 'concept-c',
            'prerequisiteConceptIds': ['concept-a', 'concept-b'],
        },
    ]

    added = sync_concept_prerequisite_edges(store, concepts)

    assert added == 3
    relations = {(edge['fromId'], edge['toId']) for edge in store.edges}
    assert ('concept-a', 'concept-b') in relations
    assert ('concept-a', 'concept-c') in relations
    assert ('concept-b', 'concept-c') in relations
