"""Tests for parse trial placement env presets."""
from __future__ import annotations

import os

import pytest

from canvas_parser.parse.parse_trial import (
    apply_placement,
    apply_production_placement,
    clear_all_parse_trial_env,
    normalize_placement,
    placement_needs_lambda,
)


@pytest.fixture(autouse=True)
def _clean_env():
    clear_all_parse_trial_env()
    yield
    clear_all_parse_trial_env()


def test_normalize_placement_aliases():
    assert normalize_placement('local_all') == 'local_download_parse'
    assert normalize_placement('all_server') == 'lambda_download_parse'


def test_local_download_parse_env():
    apply_placement('local_download_parse')
    assert os.environ.get('PARSER_HEURISTIC_ONLY') is None
    assert os.environ['PARSER_TRIAL_SIMPLE_FINALIZE'] == '1'
    assert os.environ['PARSER_PARSE_MODE'] == 'llm-fast'


def test_lambda_placements_use_full_llm():
    apply_placement('lambda_download_parse')
    assert os.environ['PARSER_PARSE_MODE'] == 'llm-fast'
    apply_placement('local_download_lambda_parse')
    assert os.environ['PARSER_PARSE_MODE'] == 'llm-fast'
    assert placement_needs_lambda('local_download_lambda_parse')


def test_production_placement_uses_app_llm_fast():
    apply_production_placement('lambda_download_parse')
    assert os.environ['PARSER_PARSE_MODE'] == 'llm-fast'
    assert os.environ.get('PARSER_TRIAL_SIMPLE_FINALIZE') is None
    assert os.environ['PARSER_PRODUCTION_PARSE'] == '1'
    assert os.environ['PARSER_PASS_PLAN'] == '1'
    assert os.environ['PARSER_SKIP_DOWNLOAD_IF_CACHED'] == '0'
