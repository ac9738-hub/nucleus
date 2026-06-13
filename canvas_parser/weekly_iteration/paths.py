"""Default paths for weekly iteration cache and reports."""

from __future__ import annotations

from pathlib import Path

CACHE_DIR_NAME = '.cache/weekly_iteration'


def cache_dir(root: Path) -> Path:
    return root / CACHE_DIR_NAME


def default_snapshot_path(root: Path) -> Path:
    return cache_dir(root) / 'snapshots_enriched.json'


def default_graph_cache_path(root: Path) -> Path:
    return cache_dir(root) / 'graph_eval.json'


def default_report_path(root: Path) -> Path:
    return cache_dir(root) / 'report.json'
