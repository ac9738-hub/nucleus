"""Tests for Synapse teaching holdout eval set."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HOLDOUT_SPEC = ROOT / "ground-truth" / "synapse_holdout" / "courses.json"
HOLDOUT_PROFILE = ROOT / "ground-truth" / "synapse_holdout" / "profile.json"
GRAPH_PATH = ROOT / "canvas_graph.json"
FIXTURE_GRAPH = ROOT / "tests" / "fixtures" / "sample-graph.json"


def test_holdout_profile_exists():
    profile = json.loads(HOLDOUT_PROFILE.read_text(encoding="utf-8"))
    assert profile.get("profile") == "synapse_holdout"
    assert profile.get("spec_file") == "courses.json"


def test_holdout_spec_loads_with_expected_layouts():
    spec = json.loads(HOLDOUT_SPEC.read_text(encoding="utf-8"))
    courses = spec.get("courses") or []
    assert len(courses) >= 6
    layouts = {row.get("layout") for row in courses}
    assert "module-only" in layouts
    assert "syllabus-only" in layouts or "syllabus-fallback" in layouts
    assert "block-heavy" in layouts
    assert "holistic-links" in layouts
    for row in courses:
        assert row.get("canvas_course_id")
        assert row.get("label")
        assert row.get("expected")


def test_holdout_course_ids_unique():
    spec = json.loads(HOLDOUT_SPEC.read_text(encoding="utf-8"))
    ids = [str(row["canvas_course_id"]) for row in spec.get("courses") or []]
    assert len(ids) == len(set(ids))


def test_holdout_expectation_checker():
    from scripts.eval_synapse_teaching_holdout import evaluate_holdout_expectations

    spec = {
        "courses": [{
            "canvas_course_id": "demo",
            "label": "Demo",
            "expected": {"teachable": True, "minCurriculumCount": 1},
        }],
    }
    per_course = [{
        "courseId": "demo",
        "label": "Demo",
        "teachable": True,
        "curriculumCount": 3,
        "curriculumSource": "blocks",
        "holisticLessonCount": 0,
        "quality": {"lessonCount": 3, "thinContextCount": 0},
        "hydration": {},
    }]
    result = evaluate_holdout_expectations(per_course, spec)
    assert result["passedCount"] == 1
    assert result["passFraction"] == 1.0


def test_holdout_eval_on_fixture_graph():
    from scripts.eval_synapse_teaching_holdout import evaluate_holdout

    spec = {
        "profile": "test_holdout",
        "courses": [{
            "canvas_course_id": "demo",
            "label": "Demo course",
            "layout": "blocks",
            "why_holdout": "fixture",
            "expected": {
                "teachable": True,
                "minCurriculumCount": 1,
            },
        }],
    }
    spec_path = FIXTURE_GRAPH.parent / "holdout-demo-spec.json"
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    try:
        report = evaluate_holdout(graph_path=FIXTURE_GRAPH, spec_path=spec_path, max_lessons=50)
    finally:
        spec_path.unlink(missing_ok=True)

    assert report["evalSet"] == "synapse_holdout"
    assert report["courseCount"] == 1
    assert report["teachableCount"] == 1
    assert (report.get("expectations") or {}).get("passedCount") == 1


@pytest.mark.skipif(not GRAPH_PATH.exists(), reason="canvas_graph.json not present")
def test_holdout_eval_production_graph():
    from scripts.eval_synapse_teaching_holdout import evaluate_holdout, holdout_course_ids

    course_ids = holdout_course_ids()
    report = evaluate_holdout(graph_path=GRAPH_PATH, max_lessons=300)
    assert report["courseCount"] == len(course_ids)
    assert report["teachableFraction"] >= 0.0
    assert "aggregateQuality" in report
    assert "expectations" in report


@pytest.mark.skipif(not GRAPH_PATH.exists(), reason="canvas_graph.json not present")
def test_holdout_eval_cli():
    cmd = [
        sys.executable,
        str(ROOT / "scripts" / "eval_synapse_teaching_holdout.py"),
        "--graph",
        str(GRAPH_PATH),
    ]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True)
    assert "holdout courses:" in result.stdout
    report_path = ROOT / ".cache" / "synapse_teaching" / "coverage_report_holdout.json"
    assert report_path.exists()
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    assert payload.get("evalSet") == "synapse_holdout"
