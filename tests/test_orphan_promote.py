import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.extract.orphan_resolver import promote_logged_teaching_for_file
from canvas_parser.graph.textbook_promote import promote_textbook_extractions_for_file


class DetailStub:
    def __init__(self, name):
        self.name = name


class ConceptStub:
    def __init__(self, conceptid, name):
        self.conceptid = conceptid
        self.name = name
        self.details = []
        self.examples = []


def test_promote_logged_teaching_for_file_adds_detail():
    concept = ConceptStub('c1', 'Neurons')
    logged_details = {
        '100': [{
            'conceptname': 'Neurons',
            'detailname': 'Action potential',
            'description': 'Voltage-gated channels open.',
            'sourceFileId': 'f1',
        }],
    }
    added = []

    def add_detail_node(courseid, concept_id, detailname, description):
        added.append((detailname, description))
        concept.details.append(DetailStub(detailname))

    stats = promote_logged_teaching_for_file(
        '100',
        'f1',
        [concept],
        logged_details,
        {},
        {},
        add_detail_node=add_detail_node,
        add_example_node=lambda *a, **k: None,
        add_problem_node=lambda *a, **k: None,
    )
    assert stats['details'] == 1
    assert added[0][0] == 'Action potential'


def test_promote_textbook_sections_for_file():
    concepts = {}

    def add_concept_node(courseid, title, summary):
        node = ConceptStub(f'c-{len(concepts) + 1}', title)
        node.description = summary
        concepts[node.conceptid] = node
        return node.conceptid

    def find_concept(courseid, ref):
        for node in concepts.values():
            if node.name == ref or node.conceptid == ref:
                return node
        return None

    file_node = {
        'typeExtractions': {
            'textbook': {
                'sections': [
                    {'sectionNumber': '2.3', 'title': 'Matrix Products', 'summary': 'Multiplying matrices.'},
                ],
            },
        },
    }
    promoted = promote_textbook_extractions_for_file(
        '100',
        'f1',
        file_node,
        add_concept_node=add_concept_node,
        find_concept=find_concept,
    )
    assert promoted >= 1
    assert any('Matrix Products' in node.name for node in concepts.values())
