"""Student profiles for weekly iteration (primary vs holdout Canvas accounts)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .paths import (
    cache_dir,
    default_graph_cache_path,
    default_report_path,
    default_snapshot_path,
    fixture_snapshot_path,
    harvard_fixture_snapshot_path,
    harvard_ground_truth_dir,
    harvard_report_path,
    harvard_snapshot_path,
    holdout_fixture_snapshot_path,
    holdout_ground_truth_dir,
    holdout_report_path,
    holdout_snapshot_path,
)


@dataclass(frozen=True)
class StudentProfile:
    """Iteration profile: ground-truth directory, cache paths, and auth env suffix."""

    name: str
    auth_env_suffix: str
    ground_truth_dir: Path
    snapshot_path: Path
    fixture_snapshot_path: Path
    report_path: Path
    graph_cache_path: Path
    canvas_course_ids: tuple[int, ...]

    @property
    def auth_cookie_env(self) -> str:
        if not self.auth_env_suffix:
            return 'CANVAS_AUTH_COOKIE'
        return f'CANVAS_AUTH_COOKIE_{self.auth_env_suffix}'

    @property
    def auth_csrf_env(self) -> str:
        if not self.auth_env_suffix:
            return 'CANVAS_AUTH_CSRF'
        return f'CANVAS_AUTH_CSRF_{self.auth_env_suffix}'

    @property
    def base_url_env(self) -> str:
        if not self.auth_env_suffix:
            return 'CANVAS_BASE_URL'
        return f'CANVAS_BASE_URL_{self.auth_env_suffix}'


def primary_profile(root: Path) -> StudentProfile:
    return StudentProfile(
        name='primary',
        auth_env_suffix='',
        ground_truth_dir=root / 'ground-truth',
        snapshot_path=default_snapshot_path(root),
        fixture_snapshot_path=fixture_snapshot_path(root),
        report_path=default_report_path(root),
        graph_cache_path=default_graph_cache_path(root),
        canvas_course_ids=(),
    )


def holdout_profile(root: Path) -> StudentProfile:
    return StudentProfile(
        name='holdout',
        auth_env_suffix='HOLDOUT',
        ground_truth_dir=holdout_ground_truth_dir(root),
        snapshot_path=holdout_snapshot_path(root),
        fixture_snapshot_path=holdout_fixture_snapshot_path(root),
        report_path=holdout_report_path(root),
        graph_cache_path=cache_dir(root) / 'graph_eval_holdout.json',
        canvas_course_ids=(20812, 19097),
    )


def harvard_profile(root: Path) -> StudentProfile:
    return StudentProfile(
        name='harvard',
        auth_env_suffix='HARVARD',
        ground_truth_dir=harvard_ground_truth_dir(root),
        snapshot_path=harvard_snapshot_path(root),
        fixture_snapshot_path=harvard_fixture_snapshot_path(root),
        report_path=harvard_report_path(root),
        graph_cache_path=cache_dir(root) / 'graph_eval_harvard.json',
        canvas_course_ids=(143716, 161543, 161797, 160377),
    )


def get_profile(root: Path, name: str) -> StudentProfile:
    if name == 'holdout':
        return holdout_profile(root)
    if name == 'harvard':
        return harvard_profile(root)
    if name in {'primary', 'default', ''}:
        return primary_profile(root)
    raise ValueError(f'Unknown student profile: {name}')
