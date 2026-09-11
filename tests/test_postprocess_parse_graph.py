from scripts.postprocess_parse_graph import postprocess_graph


def test_postprocess_remaps_learning_blocks_when_concepts_merge():
    state = {
        'concepts': [
            {
                'courseid': '1',
                'conceptid': 'a',
                'name': 'Limits',
                'description': 'Limits',
                'details': [],
                'examples': [],
                'problems': [],
                'prerequisiteConceptIds': [],
                'aliases': [],
                'moduleOrderHints': [],
            },
            {
                'courseid': '1',
                'conceptid': 'b',
                'name': 'Limits',
                'description': 'Duplicate limits concept',
                'details': [{'name': 'Epsilon delta', 'description': 'Formal definition'}],
                'examples': [{'name': 'Worked limit', 'description': 'Worked example'}],
                'problems': [],
                'prerequisiteConceptIds': [],
                'aliases': [],
                'moduleOrderHints': [],
            },
        ],
        'learningBlocks': {
            '1': [{
                'blockId': '1-b-block-1',
                'courseid': '1',
                'order': 1,
                'conceptId': 'b',
                'explanation': 'Learn duplicate concept',
                'detailRefs': ['detail:b:Epsilon delta'],
                'examples': ['example:b:Worked limit'],
                'practiceProblems': [],
                'sourceRefs': [],
            }],
        },
        'edges': [{
            'fromType': 'concept',
            'fromId': 'b',
            'toType': 'file',
            'toId': 'file-1',
            'relation': 'source',
        }],
    }

    processed = postprocess_graph(state, skip_volume_caps=True)

    concept_ids = {concept['conceptid'] for concept in processed['concepts']}
    assert concept_ids == {'a'}
    block = processed['learningBlocks']['1'][0]
    assert block['conceptId'] == 'a'
    assert block['detailRefs'] == ['detail:a:Epsilon delta']
    assert block['examples'] == ['example:a:Worked limit']
    assert processed['edges'][0]['fromId'] == 'a'
