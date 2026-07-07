#!/usr/bin/env python3
"""Apply finalize-time concept merge + detail pruning to a saved graph."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.graph.edges import GraphEdgeStore  # noqa: E402
from canvas_parser.graph.humanities_promote import (  # noqa: E402
    backfill_humanities_concept_details,
    promote_humanities_extractions_dict,
    promote_humanities_key_term_concepts_dict,
)
from canvas_parser.graph.syllabus_promote import promote_syllabus_week_concepts_dict  # noqa: E402
from canvas_parser.graph.lecture_week_promote import promote_stem_week_shell_concepts_dict  # noqa: E402
from canvas_parser.graph.lecture_slide_promote import (  # noqa: E402
    promote_bulk_stem_recall_boost_dict,
    promote_lecture_slide_concepts_dict,
    promote_numbered_slide_heading_concepts_dict,
)
from canvas_parser.graph.merge import (  # noqa: E402
    _course_humanities_reading_heavy,
    _course_is_detail_sparse,
    _course_is_lecture_slides_heavy,
    apply_concept_id_remap,
    build_file_type_resolver,
    cap_concepts_per_source_file,
    cap_course_concept_budget,
    cap_course_detail_budget,
    dedupe_echo_concept_details,
    merge_duplicate_concepts,
    merge_heading_shadow_concepts,
    prune_excessive_concept_details,
)


class _ConceptObj:
    def __init__(self, payload: dict):
        self.__dict__.update(payload)
        self.details = [_DetailObj(item) for item in (payload.get('details') or [])]
        self.examples = [_DetailObj(item) for item in (payload.get('examples') or [])]


class _DetailObj:
    def __init__(self, payload: dict):
        self.__dict__.update(payload)


def _concept_to_dict(concept: _ConceptObj) -> dict:
    payload = dict(concept.__dict__)
    payload['details'] = [dict(item.__dict__) for item in concept.details]
    payload['examples'] = [dict(item.__dict__) for item in concept.examples]
    return payload


def _file_type_resolver_for_course(course_files: dict | None):
    return build_file_type_resolver(course_files)


def _cap_concepts_for_course(course_id: str, objs: list[_ConceptObj], state: dict) -> int:
    course_files = (state.get('files') or {}).get(str(course_id)) or {}
    return cap_concepts_per_source_file(
        objs,
        file_type_resolver=_file_type_resolver_for_course(course_files),
    )


def _cap_course_volume_for_course(course_id: str, objs: list[_ConceptObj], state: dict) -> int:
    course_files = (state.get('files') or {}).get(str(course_id)) or {}
    resolver = _file_type_resolver_for_course(course_files)
    pruned = dedupe_echo_concept_details(objs)
    pruned += prune_excessive_concept_details(objs)
    file_ids = {
        str((getattr(concept, 'documentOrder', None) or {}).get('fileId') or '').strip()
        for concept in objs
    }
    file_ids.discard('')
    bulk_linked = len(course_files) > 40
    humanities_heavy = _course_humanities_reading_heavy(file_ids, resolver)
    lecture_heavy = _course_is_lecture_slides_heavy(course_files, resolver)
    sparse_signal = (
        (bulk_linked and not lecture_heavy)
        or humanities_heavy
        or _course_is_detail_sparse(objs)
    )
    pruned += cap_concepts_per_source_file(
        objs,
        file_type_resolver=resolver,
    )
    pruned += cap_course_concept_budget(
        objs,
        force_detail_sparse=sparse_signal,
        file_type_resolver=resolver,
        course_files=course_files,
        bulk_linked=bulk_linked and not lecture_heavy,
    )
    pruned += cap_course_detail_budget(
        objs,
        force_detail_sparse=sparse_signal,
        humanities_heavy=humanities_heavy,
    )
    return pruned


def _file_type_resolver_for_state(state: dict):
    files_root = state.get('files') or {}
    cache: dict[str, str] = {}

    def resolver(file_id: str) -> str:
        fid = str(file_id)
        if fid in cache:
            return cache[fid]
        for course_files in files_root.values():
            if isinstance(course_files, dict) and fid in course_files:
                cache[fid] = _file_type_resolver_for_course(course_files)(fid)
                return cache[fid]
        cache[fid] = ''
        return ''

    return resolver


def _remap_problem_ids(problems: list | dict, course_id: str, id_remap: dict) -> None:
    if not id_remap:
        return
    if isinstance(problems, dict):
        course_problems = problems.get(course_id, []) or []
    else:
        course_problems = [
            problem for problem in problems
            if str(problem.get('courseid') or '') == course_id
        ]
    for problem in course_problems:
        problem['incomingConceptNodeIds'] = [
            id_remap.get(item, item) for item in (problem.get('incomingConceptNodeIds') or [])
        ]
        problem['outgoingConceptNodeIds'] = [
            id_remap.get(item, item) for item in (problem.get('outgoingConceptNodeIds') or [])
        ]


def prune_detail_volume_only(state: dict) -> dict:
    """Echo-dedupe, per-concept cap, and course detail budget — no concept merge."""
    concepts = list(state.get('concepts') or [])
    by_course: dict[str, list[dict]] = {}
    for concept in concepts:
        course_id = str(concept.get('courseid') or '')
        by_course.setdefault(course_id, []).append(concept)

    pruned_total = 0
    for course_id, course_concepts in by_course.items():
        objs = [_ConceptObj(concept) for concept in course_concepts]
        pruned_total += _cap_course_volume_for_course(course_id, objs, state)
        by_course[course_id] = [_concept_to_dict(concept) for concept in objs]

    state = dict(state)
    state['concepts'] = [concept for group in by_course.values() for concept in group]
    meta = dict(state.get('meta') or {})
    meta['detailVolumePrune'] = {'prunedDetails': pruned_total}
    state['meta'] = meta
    return state


def postprocess_graph(state: dict, *, skip_volume_caps: bool = False) -> dict:
    concepts = list(state.get('concepts') or [])
    by_course: dict[str, list[dict]] = {}
    for concept in concepts:
        course_id = str(concept.get('courseid') or '')
        by_course.setdefault(course_id, []).append(concept)

    problems = state.get('problems') or []
    edge_payload = state.get('graphEdges') or state.get('edges') or []
    edges = GraphEdgeStore(edge_payload)
    merged_total = 0
    pruned_total = 0
    promoted_total = 0

    for course_id, course_concepts in by_course.items():
        objs = [_ConceptObj(concept) for concept in course_concepts]
        shadowed, shadow_remap = merge_heading_shadow_concepts(objs)
        if shadow_remap:
            merged_total += len(shadow_remap)
            _remap_problem_ids(problems, course_id, shadow_remap)
            apply_concept_id_remap(course_id, {course_id: shadowed}, {}, edges, shadow_remap)
            objs = shadowed
        merged, id_remap = merge_duplicate_concepts(objs)
        if id_remap:
            merged_total += len(id_remap)
            _remap_problem_ids(problems, course_id, id_remap)
            apply_concept_id_remap(course_id, {course_id: merged}, {}, edges, id_remap)
        by_course[course_id] = [_concept_to_dict(concept) for concept in merged]

    state = dict(state)
    state['concepts'] = [concept for group in by_course.values() for concept in group]
    promoted_total = promote_humanities_key_term_concepts_dict(
        state,
        file_type_resolver=_file_type_resolver_for_state(state),
    )
    promoted_total += promote_humanities_extractions_dict(
        state,
        file_type_resolver=_file_type_resolver_for_state(state),
    )
    promoted_total += backfill_humanities_concept_details(
        state,
        file_type_resolver=_file_type_resolver_for_state(state),
    )
    promoted_total += promote_syllabus_week_concepts_dict(state)
    promoted_total += promote_stem_week_shell_concepts_dict(state)
    promoted_total += promote_numbered_slide_heading_concepts_dict(state)
    promoted_total += promote_lecture_slide_concepts_dict(state)

    if not skip_volume_caps:
        by_course = {}
        for concept in state.get('concepts') or []:
            course_id = str(concept.get('courseid') or '')
            by_course.setdefault(course_id, []).append(concept)

        for course_id, course_concepts in by_course.items():
            objs = [_ConceptObj(concept) for concept in course_concepts]
            pruned_total += _cap_course_volume_for_course(course_id, objs, state)
            by_course[course_id] = [_concept_to_dict(concept) for concept in objs]

        state['concepts'] = [concept for group in by_course.values() for concept in group]

    promoted_total += promote_bulk_stem_recall_boost_dict(state)

    state['problems'] = problems
    if 'graphEdges' in state:
        state['graphEdges'] = edges.edges
    elif 'edges' in state:
        state['edges'] = edges.edges
    state.setdefault('meta', {})['postprocess'] = {
        'mergedConceptIds': merged_total,
        'prunedDetails': pruned_total,
        'promotedReadingSections': promoted_total,
    }
    return state


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('-o', '--output', type=Path, required=True)
    args = parser.parse_args()

    state = json.loads(args.input.read_text(encoding='utf-8'))
    processed = postprocess_graph(state)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(processed, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(processed.get('meta', {}).get('postprocess', {}), indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
