import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.lecture_slide_promote import promote_lecture_slides_for_file


class ConceptStub:
    def __init__(self, conceptid, name, description=''):
        self.conceptid = conceptid
        self.name = name
        self.description = description
        self.documentOrder = {}
        self.details = []


def test_promote_lecture_slides_for_file_adds_concepts():
    concepts = {}

    def add_concept_node(courseid, title, summary):
        node = ConceptStub(f'c-{len(concepts) + 1}', title, summary)
        concepts[node.conceptid] = node
        return node.conceptid

    def find_concept(courseid, ref):
        if ref in concepts:
            return concepts[ref]
        for node in concepts.values():
            if node.name == ref:
                return node
        return None

    file_node = {
        'typeExtractions': {
            'lecture': {
                'slides': [
                    {'slideOrder': 1, 'title': 'Balanced Equation - Fructose', 'summary': 'Combustion recap.'},
                ],
            },
        },
    }
    promoted = promote_lecture_slides_for_file(
        '100',
        'f1',
        file_node,
        add_concept_node=add_concept_node,
        find_concept=find_concept,
    )
    assert promoted >= 1
    assert any('Balanced Equation' in node.name for node in concepts.values())
