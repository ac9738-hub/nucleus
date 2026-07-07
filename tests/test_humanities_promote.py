import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.humanities_promote import promote_reading_extractions_dict
from canvas_parser.graph.merge import cap_course_detail_budget


class ConceptStub:
    def __init__(self, name, conceptid, description='', documentOrder=None):
        self.name = name
        self.conceptid = conceptid
        self.description = description
        self.documentOrder = documentOrder or {}
        self.details = []
        self.examples = []
        self.problems = []
        self.embedded = {}


def test_cap_course_detail_budget_uses_sparse_ratio_for_stem_courses():
    concepts = [ConceptStub(f'Topic {index}', f'c{index}') for index in range(80)]
    for concept in concepts[:12]:
        concept.details = [
            type('Detail', (), {'name': f'{concept.name} detail', 'description': 'x' * 50})(),
        ]
    removed = cap_course_detail_budget(concepts, sparse_threshold=0.20)
    after = sum(len(concept.details) for concept in concepts)
    assert removed == 9
    assert after == 3


def test_promote_chapter_segment_titles():
    from canvas_parser.graph.humanities_promote import _chapter_segment_titles

    segments = _chapter_segment_titles(
        'Ch.4 - Working the Edge: Supply Chains and Salvage Accumulation'
    )
    assert 'Supply Chains' in segments
    assert 'Salvage Accumulation' in segments


def test_promote_research_key_terms_for_humanities_file():
    from canvas_parser.graph.humanities_promote import promote_humanities_extractions_dict
    from canvas_parser.graph.merge import build_file_type_resolver

    state = {
        'concepts': [],
        'files': {
            '19971': {
                'f1': {
                    'name': 'Nguyen - Nothing Ever Dies.pdf',
                    'typeExtractions': {
                        'humanities': {
                            'key_terms': [
                                {'term': 'Freedom Assemblage', 'definition': 'War memory theme.'},
                            ],
                        },
                    },
                },
            },
        },
    }
    promoted = promote_humanities_extractions_dict(
        state,
        file_type_resolver=build_file_type_resolver(state['files']['19971']),
    )
    assert promoted == 1
    assert state['concepts'][0]['name'] == 'Freedom Assemblage'


def test_promote_reading_extractions_dict_adds_missing_sections():
    state = {
        'concepts': [],
        'files': {
            '19971': {
                'f1': {
                    'name': 'Reading.pdf',
                    'typeExtractions': {
                        'humanities': {
                            'sections': [
                                {
                                    'title': 'Freedom Assemblage',
                                    'summary': 'War and freedom theme.',
                                    'sectionOrder': 1,
                                },
                            ],
                        },
                    },
                },
            },
        },
    }
    promoted = promote_reading_extractions_dict(state)
    assert promoted == 1
    assert state['concepts'][0]['name'] == 'Freedom Assemblage'
    assert state['concepts'][0]['courseid'] == '19971'
