#!/usr/bin/env python3
"""Evaluate Synapse Learn curriculum coverage from canvas_graph.json."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.synapse_teaching import (  # noqa: E402
    build_concept_fallback_lessons,
    build_curriculum,
    build_module_fallback_lessons,
    build_syllabus_fallback_lessons,
    cap_curriculum_lessons,
    course_concepts_for_id,
    course_has_teaching_units,
    curriculum_quality_metrics,
    hydrate_course_from_local_files,
    enrich_graph_content,
    list_courses,
    load_graph,
    resolve_lesson_cap,
    should_prefer_concept_curriculum,
)
from canvas_parser.synapse_grounding import lesson_grounding_metrics  # noqa: E402

DEFAULT_GRAPH = ROOT / "canvas_graph.json"
DEFAULT_REPORT = ROOT / ".cache" / "synapse_teaching" / "coverage_report.json"


def file_block_stats(course_files: dict) -> dict:
    total_files = 0
    files_with_pages = 0
    files_with_blocks = 0
    page_count = 0
    block_count = 0
    for file_node in (course_files or {}).values():
        if not isinstance(file_node, dict):
            continue
        total_files += 1
        pages = file_node.get("pages") if isinstance(file_node.get("pages"), list) else []
        if pages:
            files_with_pages += 1
        page_count += len(pages)
        has_blocks = False
        for page in pages:
            if not isinstance(page, dict):
                continue
            blocks = page.get("blocks") if isinstance(page.get("blocks"), list) else []
            block_count += len(blocks)
            if blocks:
                has_blocks = True
        if has_blocks:
            files_with_blocks += 1
    return {
        "files": total_files,
        "filesWithPages": files_with_pages,
        "filesWithBlocks": files_with_blocks,
        "pages": page_count,
        "blocks": block_count,
    }


def evaluate_synapse_teaching(graph_path=DEFAULT_GRAPH, max_lessons=300, course_ids=None):
    graph = load_graph(graph_path)
    all_courses = list_courses(graph, teachable_only=False)
    if course_ids is not None:
        wanted = {str(course_id) for course_id in course_ids}
        all_courses = [course for course in all_courses if str(course.get("id")) in wanted]
    files = graph.get("files") or {}

    per_course = []
    total_hydrated = 0
    total_duplicates = 0
    context_lengths: list[int] = []
    truncated_courses = []
    grounding_fractions: list[float] = []
    grounded_problem_total = 0
    problem_total = 0
    for course in all_courses:
        course_id = str(course["id"])
        hydrated_graph, hydration_stats = enrich_graph_content(graph, course_id)
        total_hydrated += hydration_stats.get("hydratedFiles", 0)
        course_files = (hydrated_graph.get("files") or {}).get(course_id) or {}
        stats = file_block_stats(course_files)
        block_lessons = build_curriculum(
            hydrated_graph,
            course_id,
            max_lessons=0,
            include_concept_fallback=False,
            hydrate_local=False,
        )
        concept_lessons = build_concept_fallback_lessons(hydrated_graph, course_id)
        syllabus_lessons = build_syllabus_fallback_lessons(hydrated_graph, course_id)
        module_lessons = build_module_fallback_lessons(hydrated_graph, course_id)
        uncapped_lessons = build_curriculum(
            hydrated_graph,
            course_id,
            max_lessons=0,
            hydrate_local=False,
        )
        effective_cap = resolve_lesson_cap(len(uncapped_lessons), max_lessons) if max_lessons else len(uncapped_lessons)
        lessons = build_curriculum(
            hydrated_graph,
            course_id,
            max_lessons=max_lessons,
            hydrate_local=False,
        )
        quality = curriculum_quality_metrics(lessons)
        grounding = lesson_grounding_metrics(lessons)
        total_duplicates += quality.get("duplicateNames", 0)
        if grounding.get("groundedFraction") is not None:
            grounding_fractions.append(grounding["groundedFraction"])
        grounded_problem_total += grounding.get("problemGrounded", 0)
        problem_total += grounding.get("problemCount", 0)
        if quality.get("avgContextChars"):
            context_lengths.append(quality["avgContextChars"])
        answer_keys = sum(1 for row in lessons if row.get("hasAnswerKey"))
        concept_only = bool(concept_lessons) and not block_lessons
        prefer_concepts = should_prefer_concept_curriculum(
            len(block_lessons),
            len(course_concepts_for_id(hydrated_graph, course_id)),
            len(concept_lessons),
        )
        module_groups = len({row.get("moduleName") or row.get("sectionGroup") for row in lessons})
        type_counts = {}
        for row in lessons:
            lesson_type = str(row.get("type") or "unknown")
            type_counts[lesson_type] = type_counts.get(lesson_type, 0) + 1
        truncated = bool(max_lessons) and len(uncapped_lessons) > effective_cap
        if truncated:
            truncated_courses.append({
                "courseId": course_id,
                "label": course.get("label") or course_id,
                "uncappedCount": len(uncapped_lessons),
                "effectiveCap": effective_cap,
            })
        holistic_count = sum(
            1 for row in lessons if str(row.get('source') or '').startswith('canvas_')
        )
        page_unit_count = sum(
            1 for row in lessons if str(row.get('source') or '') == 'canvas_page_units'
        )
        module_file_count = sum(
            1 for row in lessons if str(row.get('source') or '') == 'canvas_module_file'
        )
        per_course.append({
            "courseId": course_id,
            "label": course.get("label") or course_id,
            "teachable": course_has_teaching_units(hydrated_graph, course_id),
            "conceptCount": len(course_concepts_for_id(hydrated_graph, course_id)),
            "hydration": hydration_stats,
            "quality": quality,
            "grounding": grounding,
            **stats,
            "blockLessonCount": len(block_lessons),
            "conceptFallbackCount": len(concept_lessons),
            "syllabusFallbackCount": len(syllabus_lessons),
            "moduleFallbackCount": len(module_lessons),
            "uncappedCount": len(uncapped_lessons),
            "effectiveCap": effective_cap,
            "holisticLessonCount": holistic_count,
            "pageUnitLessonCount": page_unit_count,
            "moduleFileLessonCount": module_file_count,
            "curriculumCount": len(lessons),
            "moduleGroupCount": module_groups,
            "lessonTypeCounts": type_counts,
            "conceptOnly": concept_only,
            "preferConceptCurriculum": prefer_concepts and bool(concept_lessons),
            "answerKeyCount": answer_keys,
            "truncated": truncated,
            "curriculumSource": (
                "concept"
                if prefer_concepts and concept_lessons and not block_lessons
                else "concept_override"
                if prefer_concepts and concept_lessons
                else "blocks"
                if block_lessons
                else "concept"
                if concept_lessons
                else "syllabus"
                if syllabus_lessons
                else "module"
                if module_lessons
                else "none"
            ),
        })

    page_unit_total = sum(row.get('pageUnitLessonCount', 0) for row in per_course)
    module_file_total = sum(row.get('moduleFileLessonCount', 0) for row in per_course)
    holistic_total = sum(row.get('holisticLessonCount', 0) for row in per_course)
    teachable_count = sum(1 for row in per_course if row["teachable"])
    with_blocks = sum(
        1
        for row in per_course
        if row.get("filesWithBlocks", 0) > 0 or (row.get("hydration") or {}).get("hydratedFiles", 0) > 0
    )
    concept_only_courses = sum(1 for row in per_course if row["conceptOnly"] and row["teachable"])
    concept_override = sum(1 for row in per_course if row.get("preferConceptCurriculum"))
    syllabus_teachable = sum(1 for row in per_course if row.get("curriculumSource") == "syllabus")
    module_teachable = sum(1 for row in per_course if row.get("curriculumSource") == "module")

    return {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "graphPath": str(graph_path),
        "maxLessons": max_lessons,
        "courseCount": len(all_courses),
        "teachableCount": teachable_count,
        "teachableFraction": round(teachable_count / len(all_courses), 4) if all_courses else 0.0,
        "coursesWithBlockFiles": with_blocks,
        "conceptOnlyTeachable": concept_only_courses,
        "conceptOverrideCourses": concept_override,
        "syllabusTeachable": syllabus_teachable,
        "moduleTeachable": module_teachable,
        "aggregateQuality": {
            "hydratedFiles": total_hydrated,
            "homepagesHydrated": sum(
                1 for row in per_course if (row.get('hydration') or {}).get('homepageHydrated')
            ),
            "searchtextHydrated": sum(
                1 for row in per_course if (row.get('hydration') or {}).get('searchtextHydrated', 0) > 0
            ),
            "holisticLessons": holistic_total,
            "pageUnitLessons": page_unit_total,
            "moduleFileLessons": module_file_total,
            "duplicateNames": total_duplicates,
            "avgContextChars": round(sum(context_lengths) / len(context_lengths))
            if context_lengths
            else 0,
            "truncatedCourses": truncated_courses,
            "groundedLessonFraction": round(
                sum(grounding_fractions) / len(grounding_fractions), 4
            ) if grounding_fractions else 0.0,
            "problemGroundedFraction": round(
                grounded_problem_total / problem_total, 4
            ) if problem_total else 0.0,
        },
        "perCourse": sorted(per_course, key=lambda row: (-row["curriculumCount"], row["label"].casefold())),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", default=str(DEFAULT_GRAPH))
    parser.add_argument("--max-lessons", type=int, default=300)
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    parser.add_argument(
        "--courses",
        type=int,
        nargs="*",
        help="Optional subset of course IDs (default: all courses in graph)",
    )
    args = parser.parse_args()

    report = evaluate_synapse_teaching(
        graph_path=Path(args.graph),
        max_lessons=args.max_lessons,
        course_ids=args.courses,
    )
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"courses: {report['courseCount']}")
    print(f"teachable: {report['teachableCount']} ({report['teachableFraction']:.1%})")
    print(f"courses with block-indexed files: {report['coursesWithBlockFiles']}")
    print(f"concept-only teachable: {report['conceptOnlyTeachable']}")
    print(f"concept override (noisy blocks): {report['conceptOverrideCourses']}")
    print(f"syllabus-only teachable: {report['syllabusTeachable']}")
    print(f"module-only teachable: {report['moduleTeachable']}")
    quality = report.get("aggregateQuality") or {}
    print(f"local files hydrated: {quality.get('hydratedFiles', 0)}")
    print(f"homepages hydrated: {quality.get('homepagesHydrated', 0)}")
    print(f"holistic link lessons: {quality.get('holisticLessons', 0)}")
    print(f"module file lessons: {quality.get('moduleFileLessons', 0)}")
    print(f"page unit lessons: {quality.get('pageUnitLessons', 0)}")
    print(f"duplicate lesson names: {quality.get('duplicateNames', 0)}")
    print(f"avg context chars: {quality.get('avgContextChars', 0)}")
    truncated = quality.get("truncatedCourses") or []
    if truncated:
        print(f"truncated at {report['maxLessons']} lessons: {len(truncated)} courses")
        for row in truncated[:5]:
            print(
                f"  {row['label']}: uncapped={row.get('uncappedCount', '?')} "
                f"cap={row.get('effectiveCap', report['maxLessons'])}"
            )
    print(f"report: {report_path}")

    not_teachable = [row for row in report["perCourse"] if not row["teachable"] and row["files"]]
    if not_teachable:
        print("still not teachable (have files):")
        for row in not_teachable[:8]:
            print(
                f"  {row['label']}: files={row['files']} concepts={row['conceptCount']} "
                f"blocks={row['blocks']}"
            )


if __name__ == "__main__":
    main()
