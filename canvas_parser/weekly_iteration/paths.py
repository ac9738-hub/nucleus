"""Default paths for weekly iteration cache and reports."""

from __future__ import annotations

from pathlib import Path

CACHE_DIR_NAME = '.cache/weekly_iteration'


def cache_dir(root: Path) -> Path:
    return root / CACHE_DIR_NAME


def default_snapshot_path(root: Path) -> Path:
    return cache_dir(root) / 'snapshots_enriched.json'


def fixture_snapshot_path(root: Path) -> Path:
    return root / 'fixtures' / 'weekly_iteration' / 'snapshots_gt.json'


def default_graph_cache_path(root: Path) -> Path:
    return cache_dir(root) / 'graph_eval.json'


def default_report_path(root: Path) -> Path:
    return cache_dir(root) / 'report.json'


def holdout_ground_truth_dir(root: Path) -> Path:
    return root / 'ground-truth' / 'holdout'


def holdout_snapshot_path(root: Path) -> Path:
    return cache_dir(root) / 'snapshots_holdout.json'


def holdout_fixture_snapshot_path(root: Path) -> Path:
    return root / 'fixtures' / 'weekly_iteration' / 'snapshots_holdout.json'


def holdout_report_path(root: Path) -> Path:
    return cache_dir(root) / 'report_holdout.json'


def harvard_ground_truth_dir(root: Path) -> Path:
    return root / 'ground-truth' / 'harvard'


def harvard_snapshot_path(root: Path) -> Path:
    return cache_dir(root) / 'snapshots_harvard.json'


def harvard_fixture_snapshot_path(root: Path) -> Path:
    return root / 'fixtures' / 'weekly_iteration' / 'snapshots_harvard.json'


def harvard_report_path(root: Path) -> Path:
    return cache_dir(root) / 'report_harvard.json'
