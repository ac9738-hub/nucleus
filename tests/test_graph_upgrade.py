import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.graph.upgrade import GRAPH_VERSION, upgrade_graph_state


def test_upgrade_graph_state_adds_v2_fields():
    state = upgrade_graph_state({
        'concepts': [{'name': 'Limits', 'conceptid': 'Limitsid'}],
        'syllabi': {
            '1': {
                'assignments': [{'name': 'PS1', 'assignmentid': 'PS1id'}]
            }
        }
    })

    assert state['graph_version'] == GRAPH_VERSION
    assert state['concepts'][0]['prerequisiteConceptIds'] == []
    assert state['syllabi']['1']['assignments'][0]['submissionDependencies'] == []
    assert state['edges'] == []
