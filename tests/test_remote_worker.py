"""Tests for SSH worker spec parsing."""
from __future__ import annotations

import pytest

from canvas_parser.parse.remote_worker import parse_worker_spec


def test_worker_spec_requires_absolute_path():
    with pytest.raises(ValueError):
        parse_worker_spec('user@host:relative/path')


def test_worker_spec_minimal():
    spec = parse_worker_spec('myvm:/opt/nucleus')
    assert spec.user is None
    assert spec.host == 'myvm'
    assert spec.ssh_target == 'myvm'
