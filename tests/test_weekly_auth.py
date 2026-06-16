"""Tests for multi-student Canvas auth profiles."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from canvas_parser.weekly_iteration.auth import load_auth_for_profile, load_auth_from_env
from canvas_parser.weekly_iteration.course_match import iter_ground_truth_files
from canvas_parser.weekly_iteration.students import get_profile, holdout_profile, primary_profile


@pytest.fixture
def root(tmp_path: Path) -> Path:
    (tmp_path / 'ground-truth' / 'holdout').mkdir(parents=True)
    (tmp_path / 'ground-truth' / 'holdout' / 'MAT201_S2026.json').write_text('{}', encoding='utf-8')
    (tmp_path / 'ground-truth' / 'holdout' / 'profile.json').write_text('{}', encoding='utf-8')
    return tmp_path


def test_holdout_profile_paths(root: Path):
    profile = holdout_profile(root)
    assert profile.name == 'holdout'
    assert profile.auth_cookie_env == 'CANVAS_AUTH_COOKIE_HOLDOUT'
    assert profile.canvas_course_ids == (20812, 19097)
    assert profile.ground_truth_dir == root / 'ground-truth' / 'holdout'


def test_load_holdout_auth_uses_suffixed_env(root: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv('CANVAS_AUTH_COOKIE', 'primary-cookie')
    monkeypatch.setenv('CANVAS_AUTH_COOKIE_HOLDOUT', 'holdout-cookie')
    monkeypatch.setenv('CANVAS_BASE_URL', 'https://canvas.example.edu')
    auth = load_auth_from_env(root, profile='holdout')
    assert auth.cookie == 'holdout-cookie'
    assert auth.base_url == 'https://canvas.example.edu'
    assert auth.profile == 'holdout'


def test_load_holdout_auth_reads_env_file(root: Path):
    profile = holdout_profile(root)
    (root / '.env').write_text(
        '\n'.join([
            'CANVAS_BASE_URL=https://primary.example.edu',
            'CANVAS_AUTH_COOKIE_HOLDOUT=holdout-from-file',
            'CANVAS_BASE_URL_HOLDOUT=https://holdout.example.edu',
        ]),
        encoding='utf-8',
    )
    for key in (
        'CANVAS_AUTH_COOKIE',
        'CANVAS_AUTH_COOKIE_HOLDOUT',
        'CANVAS_BASE_URL',
        'CANVAS_BASE_URL_HOLDOUT',
    ):
        os.environ.pop(key, None)
    auth = load_auth_for_profile(root, profile)
    assert auth.cookie == 'holdout-from-file'
    assert auth.base_url == 'https://holdout.example.edu'


def test_iter_ground_truth_files_skips_profile_json(root: Path):
    gt_files = iter_ground_truth_files(root / 'ground-truth' / 'holdout')
    assert [path.name for path in gt_files] == ['MAT201_S2026.json']


def test_get_profile_names(root: Path):
    assert get_profile(root, 'primary').name == 'primary'
    assert get_profile(root, 'holdout').name == 'holdout'
    with pytest.raises(ValueError):
        get_profile(root, 'unknown')
