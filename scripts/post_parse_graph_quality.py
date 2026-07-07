#!/usr/bin/env python3
"""Post-parse graph QA: rebuild retrieval edges, validate completeness, run evals."""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.content.file_retrieval_index import (  # noqa: E402
    enrich_graph_retrieval,
    load_weekly_schedule,
    merge_missing_courses_from_backup,
)
from canvas_parser.extract.validate import (  # noqa: E402
    assess_graph_retrieval_completeness,
    validate_graph_state,
)
from canvas_parser.graph.repair import repair_graph_state  # noqa: E402
from parser import atomic_write_json  # noqa: E402
from scripts.postprocess_parse_graph import postprocess_graph, prune_detail_volume_only  # noqa: E402


def load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def run_weekly_eval(root: Path, *, use_llm: bool) -> dict | None:
    try:
        from canvas_parser.weekly_iteration.run import main as weekly_main
    except ImportError:
        return None

    argv = ['--llm'] if use_llm else []
    started = time.perf_counter()
    try:
        weekly_main(argv)
    except SystemExit:
        pass
    report = load_json(root / '.cache' / 'weekly_iteration' / 'report.json')
    if not report:
        return None
    report = dict(report)
    report['_elapsed_sec'] = round(time.perf_counter() - started, 1)
    report_path = root / '.cache' / 'weekly_iteration' / 'report_post_parse.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=ROOT / 'canvas_graph.json')
    parser.add_argument('--canvas-data', type=Path, default=ROOT / 'canvas_data.json')
    parser.add_argument('--backup', type=Path, default=None, help='Backup graph to merge/restore from')
    parser.add_argument('--restore-if-empty', action='store_true', help='Restore backup when graph has no concepts')
    parser.add_argument('--skip-enrich', action='store_true')
    parser.add_argument('--skip-eval', action='store_true')
    parser.add_argument('--weekly-llm', action='store_true', help='Score weekly eval with cached parser graph')
    parser.add_argument('--skip-fresh', action='store_true', help='Skip files with fresh chunk edges')
    parser.add_argument('--workers', type=int, default=4, help='Parallel workers for retrieval enrich')
    parser.add_argument('--write-graph', action='store_true', help='Persist enriched graph after indexing')
    args = parser.parse_args()

    graph_path = Path(args.graph)
    if not graph_path.is_file():
        print(f'Missing graph: {graph_path}', file=sys.stderr)
        return 1

    graph = load_json(graph_path)
    backup_path = Path(args.backup) if args.backup else None
    if backup_path is None:
        for candidate in (
            ROOT / 'canvas_graph.json.pre_full_reparse_20260620.bak',
            ROOT / 'canvas_graph.json.pre_full_reparse.bak',
            ROOT / 'canvas_graph.json.pre_dedupe.bak',
        ):
            if candidate.is_file():
                backup_path = candidate
                break
    backup = load_json(backup_path) if backup_path and backup_path.is_file() else {}

    if args.restore_if_empty and not (graph.get('concepts') or []) and backup_path and backup_path.is_file():
        import shutil
        print(f'Graph has no concepts — restoring from {backup_path.name}')
        shutil.copy2(backup_path, graph_path)
        graph = load_json(graph_path)
        backup = load_json(backup_path)

    merged_courses = merge_missing_courses_from_backup(graph, backup) if backup else []
    detail_prune = (graph.get('meta') or {}).get('detailVolumePrune') or {}
    if not detail_prune:
        graph = postprocess_graph(graph)
        detail_prune = (graph.get('meta') or {}).get('postprocess') or (graph.get('meta') or {}).get('detailVolumePrune') or {}
    repair_stats = repair_graph_state(graph)
    weekly = load_weekly_schedule(Path(args.canvas_data))

    enrich_stats = {}
    if not args.skip_enrich:
        started = time.perf_counter()
        enrich_stats = enrich_graph_retrieval(
            graph,
            weekly_schedule=weekly,
            skip_fresh=args.skip_fresh,
            workers=args.workers,
        )
        enrich_stats['elapsed_sec'] = round(time.perf_counter() - started, 1)
        if args.write_graph:
            atomic_write_json(graph_path, graph)

    completeness = assess_graph_retrieval_completeness(graph)
    warnings = validate_graph_state(graph)

    weekly_report = None
    if not args.skip_eval:
        weekly_report = run_weekly_eval(ROOT, use_llm=args.weekly_llm)

    report = {
        'mergedCoursesFromBackup': merged_courses,
        'detailVolumePrune': detail_prune,
        'repair': repair_stats,
        'enrichRetrieval': enrich_stats,
        'completeness': completeness,
        'validationWarnings': warnings[:50],
        'validationWarningCount': len(warnings),
        'weeklyEval': {
            'aggregate': (weekly_report or {}).get('aggregate_weekly_accuracy'),
            'courses': (weekly_report or {}).get('courses'),
            'elapsed_sec': (weekly_report or {}).get('_elapsed_sec'),
        } if weekly_report else None,
    }

    out_path = ROOT / '.cache' / 'post_parse_graph_quality.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')

    print('=== Post-parse graph quality ===')
    if merged_courses:
        print(f'  restored courses from backup: {merged_courses}')
    if enrich_stats:
        print(
            f"  retrieval enrich: {enrich_stats.get('filesIndexed', 0)}/"
            f"{enrich_stats.get('filesSeen', 0)} files "
            f"({enrich_stats.get('elapsed_sec', 0)}s)"
        )
        print(
            f"    weekly edges: {enrich_stats.get('weeklyEdges', 0)} "
            f"teaching edges: {enrich_stats.get('teachingEdges', 0)}"
        )
    print(f"  chunk index rate: {completeness.get('chunkIndexRate', 0):.1%}")
    print(f"  teaching-unit rate: {completeness.get('teachingUnitRate', 0):.1%}")
    print(f"  graph-node rate: {completeness.get('graphNodeRate', 0):.1%}")
    print(f"  weekly-item rate: {completeness.get('weeklyItemRate', 0):.1%}")
    print(f"  learning-block courses: {completeness.get('coursesWithLearningBlocks', 0)}")
    print(f"  sequence edges: {completeness.get('sequenceEdges', 0)}")
    seq_cov = completeness.get('conceptsWithDocumentOrder', 0)
    concept_total = len(graph.get('concepts') or [])
    if concept_total:
        print(f"  document-order coverage: {seq_cov}/{concept_total} concepts")
    if weekly_report:
        print(f"  weekly eval aggregate: {weekly_report.get('aggregate_weekly_accuracy')}")
    print(f"  validation warnings: {len(warnings)}")
    print(f'Full report: {out_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
