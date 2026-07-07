from canvas_parser.parse.parse_item_log import log_parse_route, pass_plan_skip_reasons


def test_pass_plan_skip_reasons():
    plan = {
        'steps': [
            {'pass': 'llm_classify', 'needed': False, 'reason': 'Heuristic confidence 0.90 sufficient'},
            {'pass': 'llm_pass1', 'needed': False, 'reason': 'Type past_exam: no concept/problem extraction profile'},
        ],
    }
    text = pass_plan_skip_reasons(plan)
    assert 'llm_classify' in text
    assert 'llm_pass1' in text


def test_log_parse_route_heuristic_only(capsys):
    log_parse_route(
        course_id='1',
        file_id='2',
        filename='key.pdf',
        resolved_type='exam_solution',
        skip_classify=True,
        skip_pass1=True,
        skip_pass2=True,
    )
    out = capsys.readouterr().out
    assert 'parser: route' in out
    assert 'path=heuristic-only' in out
