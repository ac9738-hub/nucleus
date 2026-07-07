import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidekick import _parse_tool_input  # noqa: E402


def test_parse_tool_input_valid_json():
    assert _parse_tool_input('{"query": "syllabus"}') == {"query": "syllabus"}


def test_parse_tool_input_empty():
    assert _parse_tool_input("") == {}
    assert _parse_tool_input(None) == {}


def test_parse_tool_input_malformed():
    parsed = _parse_tool_input('{"query": "syllabus"')
    assert parsed.get("_parse_error") is True
    assert "_raw" in parsed


def test_parse_tool_input_non_object_json():
    assert _parse_tool_input("[1, 2]") == {}
