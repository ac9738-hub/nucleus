#!/usr/bin/env python3
"""Analyze effects of recent parser changes on a freshly parsed graph."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_cost import assess_completed_model_calls, format_cost_summary  # noqa: E402


def load_graph(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def count_nodes(g: dict) -> dict:
    concepts = g.get('concepts') or []
    file_nodes = [
        fn for course in (g.get('files') or {}).values()
        for fn in (course or {}).values()
        if isinstance(fn, dict)
    ]
    return {
        'concepts': len(concepts),
        'details': sum(len(c.get('details') or []) for c in concepts),
        'examples': sum(len(c.get('examples') or []) for c in concepts),
        'problems': len(g.get('problems') or []),
        'events': len(g.get('events') or []),
        'syllabi': len(g.get('syllabi') or {}),
        'assignments': sum(
            len((s or {}).get('assignments') or [])
            for s in (g.get('syllabi') or {}).values()
        ),
        'files': len(file_nodes),
        'file_pages': sum(len(fn.get('pages') or []) for fn in file_nodes),
        'text_chunks': sum(len(fn.get('textChunks') or []) for fn in file_nodes),
    }


def analyze_type_extractions(graph: dict) -> dict:
    bucket_counts: Counter[str] = Counter()
    academic_types: Counter[str] = Counter()
    files_with_te = 0
    files_with_type = 0
    total_rows = 0
    sample_rows: dict[str, list] = {}

    for course_files in (graph.get('files') or {}).values():
        for fn in (course_files or {}).values():
            if not isinstance(fn, dict):
                continue
            aft = str(fn.get('academicFileType') or '')
            if aft:
                academic_types[aft] += 1
                files_with_type += 1
            store = fn.get('typeExtractions') or {}
            if not isinstance(store, dict) or not store:
                continue
            files_with_te += 1
            for group, cats in store.items():
                if not isinstance(cats, dict):
                    continue
                for cat, rows in cats.items():
                    if not isinstance(rows, list):
                        continue
                    key = f'{group}.{cat}'
                    bucket_counts[key] += len(rows)
                    total_rows += len(rows)
                    if key not in sample_rows and rows:
                        sample_rows[key] = rows[:2]

    return {
        'files_with_typeExtractions': files_with_te,
        'files_with_academicFileType': files_with_type,
        'total_rows': total_rows,
        'buckets': dict(bucket_counts.most_common()),
        'academic_types': dict(academic_types.most_common()),
        'samples': sample_rows,
    }


def analyze_passes(graph: dict) -> dict:
    completed = graph.get('completed_model_calls') or {}
    passes = completed.get('deepseek_file_passes') or []
    classifications = completed.get('deepseek_classifications') or []
    by_course = Counter(str(p.get('courseid') or '') for p in passes)
    by_pass = Counter(p.get('pass_index') for p in passes)
    with_cost = sum(1 for p in passes if p.get('cost_usd') is not None)
    cache_rates = [float(p.get('cache_hit_rate') or 0) for p in passes if p.get('cache_hit_rate') is not None]
    avg_cache = sum(cache_rates) / len(cache_rates) if cache_rates else 0.0
    return {
        'pass_records': len(passes),
        'classifications': len(classifications),
        'turns': sum(int(p.get('turn_count') or 0) for p in passes),
        'tool_calls': sum(int(p.get('tool_count') or 0) for p in passes),
        'records_with_cost': with_cost,
        'avg_pass_cache_hit_rate': round(avg_cache, 4),
        'by_pass_index': dict(by_pass),
        'by_course': dict(by_course.most_common()),
    }


def chunk_edge_stats(graph: dict) -> dict:
    type_edges = 0
    weekly_edges = 0
    teaching_edges = 0
    chunks = 0
    for course_files in (graph.get('files') or {}).values():
        for fn in (course_files or {}).values():
            if not isinstance(fn, dict):
                continue
            for chunk in fn.get('textChunks') or []:
                if not isinstance(chunk, dict):
                    continue
                chunks += 1
                for edge in chunk.get('edges') or []:
                    if not isinstance(edge, dict):
                        continue
                    et = edge.get('type')
                    if et == 'type-extraction':
                        type_edges += 1
                    elif et == 'weekly-item':
                        weekly_edges += 1
                    elif et == 'teaching-unit':
                        teaching_edges += 1
    return {
        'chunks': chunks,
        'type_extraction_edges': type_edges,
        'weekly_edges': weekly_edges,
        'teaching_unit_edges': teaching_edges,
    }


def main() -> int:
    graph_path = ROOT / 'canvas_graph.json'
    backup_path = ROOT / 'canvas_graph.json.pre_full_reparse.bak'
    graph = load_graph(graph_path)
    backup = load_graph(backup_path) if backup_path.is_file() else {}

    new_counts = count_nodes(graph)
    old_counts = count_nodes(backup) if backup else {}

    type_stats = analyze_type_extractions(graph)
    pass_stats = analyze_passes(graph)
    chunk_stats = chunk_edge_stats(graph)
    cost = assess_completed_model_calls(graph.get('completed_model_calls') or {})

    report = {
        'graph_counts_new': new_counts,
        'graph_counts_old_backup': old_counts,
        'type_extractions': type_stats,
        'parser_passes': pass_stats,
        'chunk_edges': chunk_stats,
        'parse_cost': {
            'summary': format_cost_summary(cost),
            'total_usd': cost.get('total_cost_usd'),
            'cache_hit_rate': cost.get('cache_hit_rate'),
            'usage': cost.get('usage'),
            'top_files': sorted(
                cost.get('files') or [],
                key=lambda row: row.get('total_cost_usd', 0),
                reverse=True,
            )[:10],
        },
    }

    out_path = ROOT / '.cache' / 'reparse_effects_analysis.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')

    print('=== Graph scope (new vs pre-reparse backup) ===')
    for key in new_counts:
        old = old_counts.get(key, 'n/a')
        print(f'  {key:14} {new_counts[key]:>6}  (was {old})')

    print('\n=== Recent change: typeExtractions ===')
    print(f"  files with extractions: {type_stats['files_with_typeExtractions']} / {new_counts['files']}")
    print(f"  files classified: {type_stats['files_with_academicFileType']} / {new_counts['files']}")
    print(f"  total structured rows: {type_stats['total_rows']}")
    for key, count in list(type_stats['buckets'].items())[:12]:
        print(f'    {key}: {count}')

    print('\n=== Recent change: parse cost tracking ===')
    print(f"  {report['parse_cost']['summary']}")
    print(f"  records with per-pass cost: {pass_stats['records_with_cost']} / {pass_stats['pass_records']}")
    print(f"  avg pass cache hit rate: {pass_stats['avg_pass_cache_hit_rate']*100:.1f}%")

    print('\n=== Recent change: retrieval chunk edges ===')
    print(f"  text chunks: {chunk_stats['chunks']}")
    print(f"  type-extraction edges: {chunk_stats['type_extraction_edges']}")
    print(f"  weekly-item edges: {chunk_stats['weekly_edges']}")
    print(f"  teaching-unit edges: {chunk_stats['teaching_unit_edges']}")

    print(f'\nFull report: {out_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
