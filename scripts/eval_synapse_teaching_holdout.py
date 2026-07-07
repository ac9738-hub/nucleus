#!/usr/bin/env python3
"""Evaluate Synapse Learn curriculum coverage on held-out courses.

Holdout course IDs live in ground-truth/synapse_holdout/courses.json (eval-only).
In-sample eval: python scripts/eval_synapse_teaching.py

Usage:
  python scripts/eval_synapse_teaching_holdout.py
  python scripts/eval_synapse_teaching_holdout.py --compare-in-sample
  python scripts/eval_synapse_teaching_holdout.py --graph canvas_graph.json --max-lessons 300
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.eval_synapse_teaching import (  # noqa: E402
    DEFAULT_GRAPH,
    DEFAULT_REPORT,
    evaluate_synapse_teaching,
)

HOLDOUT_SPEC = ROOT / "ground-truth" / "synapse_holdout" / "courses.json"
HOLDOUT_PROFILE = ROOT / "ground-truth" / "synapse_holdout" / "profile.json"
DEFAULT_HOLDOUT_REPORT = ROOT / ".cache" / "synapse_teaching" / "coverage_report_holdout.json"


def load_holdout_spec(path: Path = HOLDOUT_SPEC) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def holdout_course_ids(spec: dict | None = None) -> list[str]:
    payload = spec or load_holdout_spec()
    return [str(row["canvas_course_id"]) for row in payload.get("courses") or []]


def _expectation_passes(row: dict, expected: dict) -> list[str]:
    failures: list[str] = []
    if "teachable" in expected and bool(row.get("teachable")) != bool(expected["teachable"]):
        failures.append(f"teachable expected {expected['teachable']} got {row.get('teachable')}")
    if expected.get("curriculumSource") and row.get("curriculumSource") != expected["curriculumSource"]:
        failures.append(
            f"curriculumSource expected {expected['curriculumSource']} got {row.get('curriculumSource')}"
        )
    if expected.get("minCurriculumCount") is not None:
        count = int(row.get("curriculumCount") or 0)
        floor = int(expected["minCurriculumCount"])
        if count < floor:
            failures.append(f"curriculumCount {count} < min {floor}")
    if expected.get("holisticLessonsMin") is not None:
        holistic = int(row.get("holisticLessonCount") or 0)
        floor = int(expected["holisticLessonsMin"])
        if holistic < floor:
            failures.append(f"holisticLessonCount {holistic} < min {floor}")
    if expected.get("minBlocks") is not None:
        blocks = int(row.get("blocks") or 0)
        floor = int(expected["minBlocks"])
        if blocks < floor:
            failures.append(f"blocks {blocks} < min {floor}")
    if "homepageHydrated" in expected:
        hydrated = bool((row.get("hydration") or {}).get("homepageHydrated"))
        if hydrated != bool(expected["homepageHydrated"]):
            failures.append(f"homepageHydrated expected {expected['homepageHydrated']} got {hydrated}")
    return failures


def evaluate_holdout_expectations(per_course: list[dict], spec: dict) -> dict:
    by_id = {str(row.get("courseId")): row for row in per_course}
    checks = []
    for entry in spec.get("courses") or []:
        course_id = str(entry.get("canvas_course_id"))
        row = by_id.get(course_id)
        expected = entry.get("expected") or {}
        if row is None:
            checks.append({
                "courseId": course_id,
                "label": entry.get("label") or course_id,
                "passed": False,
                "failures": ["course missing from graph eval"],
            })
            continue
        failures = _expectation_passes(row, expected)
        checks.append({
            "courseId": course_id,
            "label": row.get("label") or entry.get("label") or course_id,
            "layout": entry.get("layout"),
            "passed": not failures,
            "failures": failures,
        })
    passed = sum(1 for row in checks if row["passed"])
    return {
        "courseCount": len(checks),
        "passedCount": passed,
        "passFraction": round(passed / len(checks), 4) if checks else 0.0,
        "perCourse": checks,
    }


def compare_with_in_sample(holdout_report: dict, in_sample_path: Path = DEFAULT_REPORT) -> dict | None:
    if not in_sample_path.exists():
        return None
    in_sample = json.loads(in_sample_path.read_text(encoding="utf-8"))
    holdout_ids = {str(row.get("courseId")) for row in holdout_report.get("perCourse") or []}

    def thin_fraction(report: dict) -> float:
        per = report.get("perCourse") or []
        thin = sum(int((row.get("quality") or {}).get("thinContextCount") or 0) for row in per)
        lessons = sum(int((row.get("quality") or {}).get("lessonCount") or 0) for row in per)
        return round(thin / lessons, 4) if lessons else 0.0

    in_sample_filtered = [
        row for row in (in_sample.get("perCourse") or []) if str(row.get("courseId")) in holdout_ids
    ]
    return {
        "inSampleReport": str(in_sample_path),
        "holdout": {
            "courseCount": holdout_report.get("courseCount"),
            "teachableFraction": holdout_report.get("teachableFraction"),
            "holisticLessons": (holdout_report.get("aggregateQuality") or {}).get("holisticLessons"),
            "homepagesHydrated": (holdout_report.get("aggregateQuality") or {}).get("homepagesHydrated"),
            "avgContextChars": (holdout_report.get("aggregateQuality") or {}).get("avgContextChars"),
            "thinContextFraction": thin_fraction(holdout_report),
        },
        "inSampleSameCourses": {
            "courseCount": len(in_sample_filtered),
            "teachableFraction": round(
                sum(1 for row in in_sample_filtered if row.get("teachable")) / len(in_sample_filtered),
                4,
            )
            if in_sample_filtered
            else 0.0,
            "holisticLessons": sum(int(row.get("holisticLessonCount") or 0) for row in in_sample_filtered),
            "homepagesHydrated": sum(
                1 for row in in_sample_filtered if (row.get("hydration") or {}).get("homepageHydrated")
            ),
            "avgContextChars": round(
                sum(int((row.get("quality") or {}).get("avgContextChars") or 0) for row in in_sample_filtered)
                / len(in_sample_filtered)
            )
            if in_sample_filtered
            else 0,
            "thinContextFraction": thin_fraction({"perCourse": in_sample_filtered}),
        },
        "inSampleAll": {
            "courseCount": in_sample.get("courseCount"),
            "teachableFraction": in_sample.get("teachableFraction"),
            "holisticLessons": (in_sample.get("aggregateQuality") or {}).get("holisticLessons"),
            "homepagesHydrated": (in_sample.get("aggregateQuality") or {}).get("homepagesHydrated"),
            "avgContextChars": (in_sample.get("aggregateQuality") or {}).get("avgContextChars"),
            "thinContextFraction": thin_fraction(in_sample),
        },
    }


def evaluate_holdout(
    graph_path: Path = DEFAULT_GRAPH,
    max_lessons: int = 300,
    spec_path: Path = HOLDOUT_SPEC,
    compare_in_sample: bool = False,
) -> dict:
    spec = load_holdout_spec(spec_path)
    course_ids = holdout_course_ids(spec)
    report = evaluate_synapse_teaching(
        graph_path=graph_path,
        max_lessons=max_lessons,
        course_ids=course_ids,
    )
    quality = report.get("aggregateQuality") or {}
    thin_total = sum(int((row.get("quality") or {}).get("thinContextCount") or 0) for row in report["perCourse"])
    lesson_total = sum(int((row.get("quality") or {}).get("lessonCount") or 0) for row in report["perCourse"])
    payload = {
        **report,
        "evalSet": "synapse_holdout",
        "holdoutSpec": str(spec_path),
        "holdoutProfile": str(HOLDOUT_PROFILE),
        "finishedAt": datetime.now(timezone.utc).isoformat(),
        "aggregateQuality": {
            **quality,
            "thinContextCount": thin_total,
            "thinContextFraction": round(thin_total / lesson_total, 4) if lesson_total else 0.0,
        },
        "expectations": evaluate_holdout_expectations(report["perCourse"], spec),
    }
    if compare_in_sample:
        payload["comparison"] = compare_with_in_sample(report)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", default=str(DEFAULT_GRAPH))
    parser.add_argument("--max-lessons", type=int, default=300)
    parser.add_argument("--spec", default=str(HOLDOUT_SPEC))
    parser.add_argument("--report", default=str(DEFAULT_HOLDOUT_REPORT))
    parser.add_argument(
        "--compare-in-sample",
        action="store_true",
        help="Include metrics for the same holdout courses from the in-sample coverage report",
    )
    args = parser.parse_args()

    report = evaluate_holdout(
        graph_path=Path(args.graph),
        max_lessons=args.max_lessons,
        spec_path=Path(args.spec),
        compare_in_sample=args.compare_in_sample,
    )
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    quality = report.get("aggregateQuality") or {}
    expectations = report.get("expectations") or {}
    print(f"holdout courses: {report['courseCount']}")
    print(f"teachable: {report['teachableCount']} ({report['teachableFraction']:.1%})")
    print(f"homepages hydrated: {quality.get('homepagesHydrated', 0)}")
    print(f"holistic link lessons: {quality.get('holisticLessons', 0)}")
    print(f"thin context lessons: {quality.get('thinContextCount', 0)} ({quality.get('thinContextFraction', 0):.1%})")
    print(f"avg context chars: {quality.get('avgContextChars', 0)}")
    truncated = quality.get("truncatedCourses") or []
    if truncated:
        print(f"truncated at {report['maxLessons']} lessons: {len(truncated)} courses")
    print(
        f"expectations: {expectations.get('passedCount', 0)}/{expectations.get('courseCount', 0)} "
        f"({expectations.get('passFraction', 0):.1%})"
    )
    failed = [row for row in (expectations.get("perCourse") or []) if not row.get("passed")]
    for row in failed[:5]:
        print(f"  FAIL {row.get('label')}: {', '.join(row.get('failures') or [])}")
    if args.compare_in_sample and report.get("comparison"):
        comp = report["comparison"]
        hold = comp.get("holdout") or {}
        all_sample = comp.get("inSampleAll") or {}
        print("vs in-sample (all courses):")
        print(f"  teachable fraction: holdout {hold.get('teachableFraction')} vs all {all_sample.get('teachableFraction')}")
        print(f"  holistic lessons: holdout {hold.get('holisticLessons')} vs all {all_sample.get('holisticLessons')}")
        print(f"  thin context fraction: holdout {hold.get('thinContextFraction')} vs all {all_sample.get('thinContextFraction')}")
    print(f"report: {report_path}")


if __name__ == "__main__":
    main()
