from canvas_parser.parse.parse_modes import (
    active_parse_mode,
    apply_parse_mode,
    clear_parse_mode_env,
    normalize_parse_mode,
)


def test_normalize_parse_mode_aliases():
    assert normalize_parse_mode('quality') == 'llm'
    assert normalize_parse_mode('fast') == 'llm-fast'
    assert normalize_parse_mode('heuristic') == 'heuristic'


def test_apply_heuristic_mode_sets_flags(monkeypatch):
    clear_parse_mode_env()
    apply_parse_mode('heuristic')
    assert active_parse_mode() == 'heuristic'
    import os

    assert os.environ.get('PARSER_HEURISTIC_ONLY') == '1'
    assert os.environ.get('PARSER_SKIP_PAGE_LLM') == '1'
    assert os.environ.get('PARSER_SKIP_LLM_CLASSIFY') == '1'


def test_apply_llm_mode_clears_heuristic_only():
    clear_parse_mode_env()
    apply_parse_mode('heuristic')
    apply_parse_mode('llm')
    import os

    assert active_parse_mode() == 'llm'
    assert os.environ.get('PARSER_HEURISTIC_ONLY') is None


def test_apply_production_placement_enables_pass_plan():
    from canvas_parser.parse.parse_trial import apply_production_placement
    import os

    clear_parse_mode_env()
    apply_production_placement('lambda_download_parse')
    assert os.environ.get('PARSER_PASS_PLAN') == '1'
    assert os.environ.get('PARSER_PRODUCTION_PARSE') == '1'


def test_apply_llm_cost_mode_enables_pass_plan():
    clear_parse_mode_env()
    apply_parse_mode('llm-cost')
    import os

    assert active_parse_mode() == 'llm-cost'
    assert os.environ.get('PARSER_PASS_PLAN') == '1'
    assert os.environ.get('PARSER_SKIP_LLM_CLASSIFY') == '1'
