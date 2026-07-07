#!/usr/bin/env python3
"""Build canvas_graph_tasks.json — app-sized slice without embeddings/pages/chunks."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

DROP_KEYS = frozenset({
    'pages',
    'pageBlocks',
    'chunks',
    'chunkEmbeddings',
    'embedding',
    'embeddings',
    'content_vector',
    'embedded',
    'textChunks',
    'teachingBlocks',
    'typeExtractions',
    'parseQuality',
    'holisticContext',
    'chunkGraph',
    'retrievalIndex',
})


def slim_value(value):
    if isinstance(value, dict):
        return {
            key: slim_value(item)
            for key, item in value.items()
            if key not in DROP_KEYS
        }
    if isinstance(value, list):
        return [slim_value(item) for item in value]
    return value


def slim_concept(concept):
    if not isinstance(concept, dict):
        return concept
    examples = []
    for example in concept.get('examples') or []:
        if not isinstance(example, dict):
            continue
        examples.append({
            'name': example.get('name') or '',
            'description': example.get('description') or '',
        })
    return {
        'name': concept.get('name') or '',
        'conceptid': concept.get('conceptid') or '',
        'description': concept.get('description') or '',
        'courseid': concept.get('courseid') or '',
        'examples': examples,
        'problems': concept.get('problems') or [],
    }


def slim_problem(problem):
    if not isinstance(problem, dict):
        return problem
    return {
        'name': problem.get('name') or '',
        'problemid': problem.get('problemid') or '',
        'steps': problem.get('steps') or [],
        'answer': problem.get('answer') or '',
        'description': problem.get('description') or '',
    }


def slim_file(file_obj):
    if not isinstance(file_obj, dict):
        return file_obj
    slimmed = slim_value(file_obj)
    for key in ('details', 'examples'):
        refs = file_obj.get(key)
        if isinstance(refs, list):
            slimmed[key] = refs
    return slimmed


def extract_task_slice(state):
    files = state.get('files') or {}
    slim_files = {}
    for course_id, course_files in files.items():
        if isinstance(course_files, dict):
            slim_files[course_id] = {
                file_id: slim_file(file_obj)
                for file_id, file_obj in course_files.items()
            }
        else:
            slim_files[course_id] = course_files

    return {
        'graph_version': state.get('graph_version'),
        'syllabi': state.get('syllabi') or {},
        'events': state.get('events') or [],
        'learningBlocks': state.get('learningBlocks') or {},
        'files': slim_files,
        'concepts': [slim_concept(item) for item in (state.get('concepts') or [])],
        'problems': [slim_problem(item) for item in (state.get('problems') or [])],
        'external_platforms': state.get('external_platforms') or {},
        'logged_events': state.get('logged_events') or {},
        'url_to_node': state.get('url_to_node') or {},
        'edges': state.get('edges') or [],
        'courseModules': state.get('courseModules') or {},
        '_slice': {
            'kind': 'app_tasks',
            'source': 'canvas_graph.json',
            'builtAt': int(time.time() * 1000),
        },
    }


def atomic_write_json(path: Path, data):
    temp_path = path.with_name(f'.{path.name}.{os.getpid()}.{time.time_ns()}.tmp')
    with open(temp_path, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_path, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=str(Path(__file__).resolve().parent.parent))
    args = parser.parse_args()
    root = Path(args.root)
    graph_path = root / 'canvas_graph.json'
    out_path = root / 'canvas_graph_tasks.json'

    if not graph_path.exists():
        print(f'canvas_graph.json not found at {graph_path}', file=sys.stderr)
        return 1

    print(f'extract_canvas_graph_tasks: reading {graph_path}', flush=True)
    with open(graph_path, 'r', encoding='utf-8') as handle:
        state = json.load(handle)

    slice_data = extract_task_slice(state)
    atomic_write_json(out_path, slice_data)
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f'extract_canvas_graph_tasks: wrote {out_path} ({size_mb:.1f} MB)', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
