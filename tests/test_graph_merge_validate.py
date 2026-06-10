import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.merge import merge_duplicate_concepts
from canvas_parser.extract.validate import validate_graph_state
from canvas_parser.graph.edges import GraphEdgeStore


class ConceptStub:
    def __init__(self, name, conceptid, description='', embedded=None):
        self.name = name
        self.conceptid = conceptid
        self.description = description
        self.embedded = embedded or {}
        self.details = []
        self.examples = []
        self.problems = []
        self.prerequisiteConceptIds = []
        self.aliases = []
        self.moduleOrderHints = []


def test_merge_duplicate_concepts_by_name():
    kept, remap = merge_duplicate_concepts([
        ConceptStub('Limits', 'a'),
        ConceptStub('limits', 'b'),
    ])
    assert len(kept) == 1
    assert remap.get('b') == 'a'


def test_validate_graph_state_flags_missing_learning_block_concept():
    warnings = validate_graph_state({
        'concepts': [],
        'learningBlocks': {
            '1': [{'blockId': 'block-1', 'explanation': ''}]
        }
    })
    assert any('learning block missing concept' in warning for warning in warnings)


def test_edge_store_validate_missing_node():
    store = GraphEdgeStore([{
        'fromType': 'concept',
        'fromId': 'missing',
        'toType': 'concept',
        'toId': 'also-missing',
        'relation': 'prerequisite',
    }])
    warnings = store.validate({'concept': {'known'}})
    assert len(warnings) == 2
