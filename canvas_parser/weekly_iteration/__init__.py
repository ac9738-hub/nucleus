"""Weekly schedule bucketing and cloud-agent iteration against ground-truth courses."""

from .auth import load_auth_from_env
from .evaluate import compare_to_ground_truth, evaluate_snapshots, score_parsed_course
from .format import format_course_snapshot
from .fetch import fetch_all_courses, fetch_course_snapshot, load_snapshots, save_snapshots
from .paths import default_graph_cache_path, default_report_path, default_snapshot_path
from .run import main as run_iteration

__all__ = [
    'compare_to_ground_truth',
    'default_graph_cache_path',
    'default_report_path',
    'default_snapshot_path',
    'evaluate_snapshots',
    'fetch_all_courses',
    'fetch_course_snapshot',
    'format_course_snapshot',
    'load_auth_from_env',
    'load_snapshots',
    'run_iteration',
    'save_snapshots',
    'score_parsed_course',
]
