import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.merge import (
    cap_course_concept_budget,
    cap_concepts_per_source_file,
    cap_course_detail_budget,
    dedupe_echo_concept_details,
    merge_duplicate_concepts,
    merge_heading_shadow_concepts,
    prune_excessive_concept_details,
)
from canvas_parser.extract.validate import validate_graph_state
from canvas_parser.graph.edges import GraphEdgeStore


class ConceptStub:
    def __init__(self, name, conceptid, description='', embedded=None, documentOrder=None):
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
        self.documentOrder = documentOrder or {}


def test_merge_heading_shadow_concepts_absorbs_llm_paraphrase():
    anchor = ConceptStub('6 1 the dome', 'a', documentOrder={'heading': [6, 1]})
    shadow = ConceptStub('Brunelleschi dome Florence Cathedral', 'b')
    kept, remap = merge_heading_shadow_concepts([anchor, shadow])
    assert len(kept) == 1
    assert remap.get('b') == 'a'
    assert 'Brunelleschi dome Florence Cathedral' in kept[0].aliases


def test_merge_duplicate_concepts_by_fuzzy_name():
    kept, remap = merge_duplicate_concepts([
        ConceptStub('6 1 the dome', 'a'),
        ConceptStub('Dome of Florence Cathedral', 'b'),
    ])
    assert len(kept) == 1
    assert remap.get('b') == 'a'


def test_dedupe_echo_concept_details():
    concept = ConceptStub('Limits', 'a', description='Formal definition of limits')
    concept.details = [
        type('Detail', (), {'name': 'Limits', 'description': 'Formal definition of limits'})(),
        type('Detail', (), {'name': 'epsilon-delta', 'description': 'Formal proof technique'})(),
    ]
    removed = dedupe_echo_concept_details([concept])
    assert removed == 1
    assert len(concept.details) == 1
    assert concept.details[0].name == 'epsilon-delta'


def test_merge_duplicate_concepts_empty_name_concept_node():
    kept, remap = merge_duplicate_concepts([
        ConceptStub('', 'a'),
        ConceptStub('Named concept', 'b'),
    ])
    assert len(kept) == 2
    assert remap == {}


    concepts = [
        ConceptStub(f'Concept {index}', f'c{index}')
        for index in range(40)
    ]
    for concept in concepts:
        concept.details = [
            type('Detail', (), {'name': f'{concept.name} detail {slot}', 'description': 'x' * 40})()
            for slot in range(5)
        ]
    before = sum(len(concept.details) for concept in concepts)
    pruned = cap_course_detail_budget(concepts)
    after = sum(len(concept.details) for concept in concepts)
    assert before == 200
    assert pruned == before - after
    assert after <= max(2, int(len(concepts) * 0.17))


def test_cap_concepts_per_source_file_limits_per_file():
    concepts = []
    for index in range(15):
        concepts.append(ConceptStub(
            f'Slide {index}',
            f'c{index}',
            documentOrder={'fileId': 'file-a', 'sequenceIndex': index},
        ))
    concepts.append(ConceptStub('Orphan', 'orphan'))
    removed = cap_concepts_per_source_file(concepts, max_per_file=10)
    assert removed == 5
    assert len(concepts) == 11
    assert sum(1 for concept in concepts if concept.conceptid == 'orphan') == 1


def test_cap_course_concept_budget_uses_file_slots():
    concepts = []
    for file_index in range(4):
        for slot in range(6):
            concepts.append(ConceptStub(
                f'File {file_index} topic {slot}',
                f'f{file_index}-{slot}',
                documentOrder={'fileId': f'file-{file_index}'},
            ))
    removed = cap_course_concept_budget(concepts, slots_per_file=5, floor=10)
    assert removed == 4
    assert len(concepts) == 20


def test_cap_concepts_per_source_file_limits_humanities_files():
    concepts = []
    for index in range(8):
        concepts.append(ConceptStub(
            f'Section {index}',
            f'c{index}',
            documentOrder={'fileId': 'reading-a'},
        ))
    removed = cap_concepts_per_source_file(
        concepts,
        max_per_file=10,
        humanities_max_per_file=4,
        file_type_resolver=lambda _file_id: 'humanities_reading',
    )
    assert removed == 4
    assert len(concepts) == 4


def test_cap_course_concept_budget_uses_sparse_slots_for_detail_sparse_courses():
    concepts = []
    for file_index in range(16):
        for slot in range(6):
            concept = ConceptStub(
                f'Week {file_index} topic {slot}',
                f'f{file_index}-{slot}',
                documentOrder={'fileId': f'file-{file_index}'},
            )
            if file_index < 2 and slot == 0:
                concept.details = [
                    type('Detail', (), {'name': 'detail', 'description': 'x' * 40})(),
                ]
            concepts.append(concept)
    removed = cap_course_concept_budget(concepts, slots_per_file=6, sparse_slots_per_file=4, floor=30)
    assert removed == 64
    assert len(concepts) == 32


def test_cap_course_concept_budget_tightens_many_file_sparse_courses():
    concepts = [
        ConceptStub(f'topic {index}', f'file-{index % 64}', documentOrder={'fileId': f'file-{index % 64}'})
        for index in range(320)
    ]
    removed = cap_course_concept_budget(
        concepts,
        slots_per_file=6,
        sparse_slots_per_file=4,
        floor=30,
        force_detail_sparse=True,
    )
    assert removed == 256
    assert len(concepts) == 64

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


def test_validate_graph_state_accepts_learning_block_next_edges():
    store = GraphEdgeStore([{
        'fromType': 'learningBlock',
        'fromId': '20812-abc-block',
        'toType': 'learningBlock',
        'toId': '20812-def-block',
        'relation': 'next',
    }])
    warnings = validate_graph_state({
        'concepts': [{'conceptid': 'abc'}, {'conceptid': 'def'}],
        'learningBlocks': {
            '20812': [
                {'blockId': '20812-abc-block', 'conceptId': 'abc', 'explanation': 'a'},
                {'blockId': '20812-def-block', 'conceptId': 'def', 'explanation': 'b'},
            ]
        },
    }, store)
    assert not any('missing learningBlock' in warning for warning in warnings)
