"""Tests for Synapse Learn lesson grounding."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests' / 'fixtures' / 'sample-graph.json'


def run_cli(*args: str) -> dict:
    cmd = [sys.executable, '-m', 'canvas_parser.synapse_teaching', *args, '--fixture']
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def test_curriculum_lessons_include_grounding_fixture():
    payload = run_cli('curriculum', '--course-id', 'demo')
    lessons = payload.get('lessons') or []
    assert lessons
    first = lessons[0]
    assert isinstance(first.get('groundingChunks'), list)
    assert isinstance(first.get('sourceRefs'), list)
    assert isinstance(first.get('groundingPrompt'), str)
    assert first.get('groundingPrompt')
    assert first.get('groundingLabels')


def test_block_lessons_link_file_chunks():
    payload = run_cli('curriculum', '--course-id', 'demo')
    lessons = payload.get('lessons') or []
    matrix = next(row for row in lessons if row.get('name') == '2.3 Matrix Products')
    assert matrix.get('groundingChunks')
    assert any(
        ref.get('type') in {'text-chunk', 'file-page'}
        for ref in (matrix.get('sourceRefs') or [])
        if isinstance(ref, dict)
    )
    labels = matrix.get('groundingLabels') or []
    assert labels and labels[0].startswith('C')


def test_problem_lesson_has_grounded_sources():
    payload = run_cli('curriculum', '--course-id', 'demo')
    lessons = payload.get('lessons') or []
    problem = next(row for row in lessons if row.get('type') == 'problem')
    assert problem.get('groundingChunks') or problem.get('sourceRefs')
    assert problem.get('groundingPrompt')
    assert problem.get('problemStatement')


def test_grounding_metrics_fixture():
    from canvas_parser.synapse_grounding import lesson_grounding_metrics
    from canvas_parser.synapse_teaching import build_curriculum, load_graph

    graph = load_graph(use_fixture=True)
    lessons = build_curriculum(graph, 'demo')
    metrics = lesson_grounding_metrics(lessons)
    assert metrics['lessonCount'] == len(lessons)
    assert metrics['groundedLessons'] == len(lessons)
    assert metrics['groundedFraction'] == 1.0
    assert metrics['withTextChunks'] >= 1


def test_select_chunks_prefers_teaching_unit_match():
    from canvas_parser.synapse_grounding import select_grounding_chunks_for_lesson
    from canvas_parser.synapse_teaching import build_curriculum, load_graph

    graph = load_graph(use_fixture=True)
    lessons = build_curriculum(graph, 'demo')
    example = next(row for row in lessons if row.get('type') == 'example')
    chunks = select_grounding_chunks_for_lesson(example, graph, 'demo')
    assert chunks
    joined = ' '.join(str(chunk.get('text') or '') for chunk in chunks).casefold()
    assert 'example' in joined or 'solution' in joined
