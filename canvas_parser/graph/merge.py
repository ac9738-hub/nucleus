import re

from canvas_parser.graph.sequence_hints import parse_heading_numbers
from canvas_parser.graph.humanities_promote import CHAPTER_HEADING_PATTERN
from canvas_parser.weekly_iteration.match_utils import heading_concepts_match, names_match


def _normalize_name(value):
    return re.sub(r'\s+', ' ', str(value or '').strip().casefold())


def _cosine_similarity(left, right):
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = sum(a * a for a in left) ** 0.5
    right_norm = sum(b * b for b in right) ** 0.5
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def _concept_embedding(concept):
    embedded = _concept_field(concept, 'embedded', {})
    if not isinstance(embedded, dict):
        return None
    for key in ('description', 'name'):
        vector = embedded.get(key)
        if isinstance(vector, list) and vector:
            return vector
    return None


def _heading_content_tokens(text: str) -> set[str]:
    stripped = re.sub(r'^(\d+(?:\s+\d+)+)\s+', '', str(text or '').strip()).strip() or str(text or '')
    stopwords = {'the', 'a', 'an', 'for', 'and', 'of', 'to', 'in'}
    return {
        token for token in stripped.split()
        if token not in stopwords and not token.isdigit() and len(token) >= 4
    }


def _should_absorb_heading_shadow(anchor, shadow) -> bool:
    anchor_name = getattr(anchor, 'name', '') or ''
    shadow_name = getattr(shadow, 'name', '') or ''
    if not anchor_name or not shadow_name:
        return False
    if names_match(anchor_name, shadow_name):
        return True
    if not heading_concepts_match(anchor_name, shadow_name):
        return False
    anchor_tokens = _heading_content_tokens(_normalize_name(anchor_name))
    shadow_tokens = _heading_content_tokens(_normalize_name(shadow_name))
    overlap = anchor_tokens & shadow_tokens
    if len(overlap) >= 2:
        return True
    if not overlap:
        return False
    anchor_embedding = _concept_embedding(anchor)
    shadow_embedding = _concept_embedding(shadow)
    if anchor_embedding and shadow_embedding:
        return _cosine_similarity(anchor_embedding, shadow_embedding) >= 0.88
    return len(overlap) == 1 and any(len(token) >= 5 for token in overlap)


def merge_heading_shadow_concepts(course_concepts):
    """Absorb LLM concepts that paraphrase outline-seeded headings (documentOrder.heading set)."""
    if not course_concepts:
        return [], {}

    def _heading(concept):
        order = getattr(concept, 'documentOrder', None) or {}
        if isinstance(order, dict):
            return order.get('heading')
        return None

    anchors = [concept for concept in course_concepts if _heading(concept)]
    if not anchors:
        return course_concepts, {}

    id_remap = {}
    kept = []
    for concept in course_concepts:
        concept_name = getattr(concept, 'name', '') or ''
        concept_id = getattr(concept, 'conceptid', '') or ''
        if _heading(concept):
            kept.append(concept)
            continue
        merged = False
        for anchor in anchors:
            if _should_absorb_heading_shadow(anchor, concept):
                _absorb_concept(anchor, concept, concept_id, id_remap)
                merged = True
                break
        if not merged:
            kept.append(concept)
    return kept, id_remap


def _concept_field(concept, field, default=''):
    if isinstance(concept, dict):
        if field in concept:
            value = concept[field]
            return default if value is None else value
        return default
    if hasattr(concept, field):
        value = getattr(concept, field)
        return default if value is None else value
    return default


def merge_duplicate_concepts(course_concepts, similarity_threshold=0.92):
    if not course_concepts:
        return [], {}

    id_remap = {}
    kept = []
    for concept in course_concepts:
        concept_name = _normalize_name(_concept_field(concept, 'name'))
        concept_id = _concept_field(concept, 'conceptid')
        embedding = _concept_embedding(concept)
        merged = False

        for existing in kept:
            existing_name = _normalize_name(existing.name)
            if concept_name and existing_name and (
                concept_name == existing_name
                or heading_concepts_match(concept_name, existing_name)
            ):
                _absorb_concept(existing, concept, concept_id, id_remap)
                merged = True
                break
            existing_embedding = _concept_embedding(existing)
            if embedding and existing_embedding and _cosine_similarity(embedding, existing_embedding) >= similarity_threshold:
                _absorb_concept(existing, concept, concept_id, id_remap)
                merged = True
                break

        if not merged:
            kept.append(concept)

    return kept, id_remap


def _absorb_concept(target, source, source_id, id_remap):
    if source_id and source_id != target.conceptid:
        id_remap[source_id] = target.conceptid
        if source_id not in target.aliases:
            target.aliases.append(source_id)
    source_name = getattr(source, 'name', '')
    if source_name and source_name not in target.aliases:
        target.aliases.append(source_name)
    if not target.description and getattr(source, 'description', ''):
        target.description = source.description
    for detail in getattr(source, 'details', []) or []:
        if not any(existing.name == detail.name for existing in target.details):
            target.details.append(detail)
    for example in getattr(source, 'examples', []) or []:
        if not any(existing.name == example.name for existing in target.examples):
            target.examples.append(example)
    for problem_id in getattr(source, 'problems', []) or []:
        if problem_id not in target.problems:
            target.problems.append(problem_id)
    for prereq in getattr(source, 'prerequisiteConceptIds', []) or []:
        if prereq not in target.prerequisiteConceptIds:
            target.prerequisiteConceptIds.append(prereq)
    for hint in getattr(source, 'moduleOrderHints', []) or []:
        if hint not in target.moduleOrderHints:
            target.moduleOrderHints.append(hint)


def remap_identifier(value, id_remap):
    return id_remap.get(value, value)


def dedupe_echo_concept_details(course_concepts):
    """Drop details that repeat the parent concept name or description."""
    removed = 0
    for concept in course_concepts or []:
        concept_name = _normalize_name(getattr(concept, 'name', ''))
        concept_desc = _normalize_name(getattr(concept, 'description', ''))
        kept = []
        seen_names: set[str] = set()
        for detail in getattr(concept, 'details', []) or []:
            detail_name = _normalize_name(getattr(detail, 'name', ''))
            detail_desc = _normalize_name(getattr(detail, 'description', ''))
            if not detail_name:
                continue
            if detail_name in seen_names:
                removed += 1
                continue
            if detail_name == concept_name:
                removed += 1
                continue
            if concept_desc and (detail_name in concept_desc or detail_desc == concept_desc):
                removed += 1
                continue
            seen_names.add(detail_name)
            kept.append(detail)
        concept.details = kept
    return removed


def prune_excessive_concept_details(course_concepts, *, max_per_concept=2):
    """Keep the most substantive details when LLM/outline seeding over-logs."""
    pruned = 0
    for concept in course_concepts or []:
        details = list(getattr(concept, 'details', []) or [])
        if len(details) <= max_per_concept:
            continue
        seen_names: set[str] = set()
        unique = []
        for detail in details:
            key = _normalize_name(getattr(detail, 'name', ''))
            if not key or key in seen_names:
                continue
            seen_names.add(key)
            unique.append(detail)
        unique.sort(
            key=lambda detail: len(str(getattr(detail, 'description', '') or '')),
            reverse=True,
        )
        concept.details = unique[:max_per_concept]
        pruned += len(details) - len(concept.details)
    return pruned


def _concept_source_file_id(concept) -> str:
    order = getattr(concept, 'documentOrder', None) or {}
    if isinstance(order, dict):
        file_id = str(order.get('fileId') or order.get('fileid') or '').strip()
        if file_id:
            return file_id
    for source in getattr(concept, 'sourcePages', None) or []:
        if not isinstance(source, dict):
            continue
        file_id = str(source.get('fileid') or source.get('fileId') or '').strip()
        if file_id:
            return file_id
    return ''


def _concept_cap_rank(concept) -> tuple:
    order = getattr(concept, 'documentOrder', None) or {}
    has_heading = 1 if isinstance(order, dict) and order.get('heading') else 0
    desc_len = len(str(getattr(concept, 'description', '') or ''))
    detail_count = len(getattr(concept, 'details', []) or [])
    problem_count = len(getattr(concept, 'problems', []) or [])
    example_count = len(getattr(concept, 'examples', []) or [])
    return (has_heading, detail_count + problem_count + example_count, desc_len)


def _reading_term_budget_rank(concept) -> tuple:
    """Prefer short, unparenthesized key terms when reserving humanities recall slots."""
    name = str(getattr(concept, 'name') or '')
    word_count = len(name.split())
    paren_penalty = 1 if '(' in name else 0
    brevity = max(0, 12 - word_count)
    if word_count <= 2:
        brevity += 6
    elif word_count <= 4:
        brevity += 3
    detail_count = len(getattr(concept, 'details', []) or [])
    desc_len = len(str(getattr(concept, 'description', '') or ''))
    return (brevity, -paren_penalty, detail_count, desc_len)


def _course_concept_budget_rank(concept) -> tuple:
    """Prefer week shells, syllabus weeks, promoted readings, and slides when trimming."""
    concept_id = str(getattr(concept, 'conceptid') or '')
    week_shell = 1 if concept_id.startswith('week-shell-') else 0
    syllabus = 1 if concept_id.startswith('syllabus-week-') else 0
    lecture_heading = 2 if concept_id.startswith('lecture-heading-') else 0
    reading_section = (
        2
        if concept_id.startswith('reading-')
        and not concept_id.startswith(('reading-term-', 'reading-arg-', 'reading-file-'))
        else 0
    )
    reading_term = 2 if concept_id.startswith('reading-term-') else 0
    reading_arg = 2 if concept_id.startswith('reading-arg-') else 0
    lecture_slide = 1 if concept_id.startswith('lecture-slide-') else 0
    base = _concept_cap_rank(concept)
    return (
        week_shell,
        syllabus,
        lecture_heading,
        reading_section,
        reading_term,
        reading_arg,
        lecture_slide,
        base[0],
        base[1],
        base[2],
    )


HUMANITIES_FILE_TYPES = frozenset({'humanities_reading', 'literary_work'})
LECTURE_FILE_TYPES = frozenset({'lecture_slides', 'lecture_notes', 'textbook_chapter'})


def _parse_time_concept_limit(file_type: str) -> int:
    file_type = str(file_type or '').strip()
    if file_type in LECTURE_FILE_TYPES:
        return 22
    if file_type in HUMANITIES_FILE_TYPES:
        return 4
    return 10


def _lecture_concept_cap_rank(concept) -> tuple:
    name = str(getattr(concept, 'name') or '')
    heading = parse_heading_numbers(name)
    has_heading = 1 if heading else 0
    word_count = len(name.split())
    if word_count <= 6:
        length_score = 6 - abs(word_count - 3)
    else:
        length_score = max(0, 8 - word_count // 2)
    base = _concept_cap_rank(concept)
    return (has_heading, length_score, base[0], base[1], base[2])


def _course_is_lecture_slides_heavy(course_files, file_type_resolver=None, *, min_lecture_files=8):
    if not course_files or not file_type_resolver:
        return False
    lecture_count = 0
    total = 0
    for file_id in course_files:
        total += 1
        if str(file_type_resolver(str(file_id)) or '').strip() in LECTURE_FILE_TYPES:
            lecture_count += 1
    if total > 55:
        return False
    return lecture_count >= min_lecture_files and lecture_count >= max(3, total // 4)


def _course_is_bulk_linked_lecture_stem(
    course_files,
    file_type_resolver=None,
    *,
    min_course_files=40,
    min_lecture_files=16,
):
    """Bulk linked PDF dumps (CHM201) — many lecture files but not compact slide layout (ART102)."""
    if not course_files or not file_type_resolver:
        return False
    if len(course_files) <= min_course_files:
        return False
    if _course_is_lecture_slides_heavy(course_files, file_type_resolver):
        return False
    lecture_count = sum(
        1 for file_id in course_files
        if str(file_type_resolver(str(file_id)) or '').strip() in LECTURE_FILE_TYPES
    )
    return lecture_count >= min_lecture_files


def build_file_type_resolver(course_files):
    """Return file_id -> parser file type using stored metadata or filename heuristics."""
    from canvas_parser.parse.file_types import heuristic_classify, normalize_file_type_id

    course_files = course_files or {}

    def resolver(file_id: str) -> str:
        node = course_files.get(str(file_id)) or {}
        if not isinstance(node, dict):
            return ''
        stored = node.get('parserFileType') or node.get('fileType') or ''
        if stored:
            return normalize_file_type_id(stored)
        file_type, _confidence = heuristic_classify(
            filename=str(node.get('name') or ''),
            snippet='',
        )
        return file_type

    return resolver


def _humanities_concept_cap_rank(concept) -> tuple:
    name = str(getattr(concept, 'name') or '')
    concept_id = str(getattr(concept, 'conceptid') or '')
    promoted = 1 if concept_id.startswith('reading-') else 0
    is_chapter = 1 if CHAPTER_HEADING_PATTERN.match(name) else 0
    word_count = len(name.split())
    if word_count <= 6:
        length_score = 6 - abs(word_count - 3)
    else:
        length_score = max(0, 10 - word_count)
    base = _concept_cap_rank(concept)
    return (promoted, length_score, -is_chapter, base[0], base[1], base[2])


def cap_concepts_per_source_file(
    course_concepts,
    *,
    max_per_file=10,
    humanities_max_per_file=4,
    lecture_max_per_file=22,
    file_type_resolver=None,
):
    """Drop lowest-ranked concepts when a single file over-seeds the graph."""
    if not course_concepts:
        return 0

    by_file: dict[str, list] = {}
    orphans = []
    for concept in course_concepts:
        file_id = _concept_source_file_id(concept)
        if file_id:
            by_file.setdefault(file_id, []).append(concept)
        else:
            orphans.append(concept)

    kept = list(orphans)
    removed = 0
    for file_id, group in by_file.items():
        limit = max_per_file
        file_type = ''
        if file_type_resolver:
            file_type = str(file_type_resolver(file_id) or '').strip()
            if file_type in HUMANITIES_FILE_TYPES:
                limit = humanities_max_per_file
            elif file_type in LECTURE_FILE_TYPES:
                limit = lecture_max_per_file
        if len(group) <= limit:
            kept.extend(group)
            continue
        if file_type in HUMANITIES_FILE_TYPES:
            recall_promoted = [
                concept for concept in group
                if str(getattr(concept, 'conceptid') or '').startswith('reading-')
            ]
            other_group = [
                concept for concept in group
                if concept not in recall_promoted
            ]

            def _humanities_recall_rank(concept):
                concept_id = str(getattr(concept, 'conceptid') or '')
                if concept_id.startswith(('reading-term-', 'reading-arg-')):
                    return _reading_term_budget_rank(concept)
                return _humanities_concept_cap_rank(concept)

            recall_keep = sorted(recall_promoted, key=_humanities_recall_rank, reverse=True)
            effective_limit = max(limit, min(8, len(recall_keep)))
            if len(recall_keep) > effective_limit:
                recall_keep = recall_keep[:effective_limit]
            other_limit = max(0, effective_limit - len(recall_keep))
            ranked_other = sorted(other_group, key=_humanities_concept_cap_rank, reverse=True)[:other_limit]
            kept.extend(recall_keep + ranked_other)
            removed += len(group) - len(recall_keep) - len(ranked_other)
            continue
        if file_type in LECTURE_FILE_TYPES:
            rank_key = _lecture_concept_cap_rank
        else:
            rank_key = _concept_cap_rank
        ranked = sorted(group, key=rank_key, reverse=True)
        kept.extend(ranked[:limit])
        removed += len(group) - limit

    course_concepts[:] = kept
    return removed


def _course_is_detail_sparse(
    course_concepts,
    *,
    sparse_threshold=0.20,
    sparse_empty_fraction=0.70,
):
    if not course_concepts:
        return False
    total_details = sum(len(getattr(concept, 'details', []) or []) for concept in course_concepts)
    if total_details <= 0:
        return False
    concept_count = len(course_concepts)
    empty_concepts = sum(
        1 for concept in course_concepts
        if not (getattr(concept, 'details', []) or [])
    )
    return (
        (total_details / concept_count) <= sparse_threshold
        or (empty_concepts / concept_count) >= sparse_empty_fraction
    )


def _course_humanities_reading_heavy(file_ids, file_type_resolver=None, *, min_files=3):
    if not file_ids or not file_type_resolver:
        return False
    humanities = sum(
        1 for file_id in file_ids
        if str(file_type_resolver(file_id) or '').strip() in HUMANITIES_FILE_TYPES
    )
    return humanities >= min_files and humanities >= len(file_ids) // 2


def cap_course_concept_budget(
    course_concepts,
    *,
    slots_per_file=6,
    sparse_slots_per_file=4,
    floor=30,
    sparse_threshold=0.20,
    sparse_empty_fraction=0.70,
    force_detail_sparse=False,
    file_type_resolver=None,
    course_files=None,
    bulk_linked=False,
):
    """Cap total concepts using contributing source-file count (quality graphs are sparse per file)."""
    if not course_concepts:
        return 0

    file_ids = {
        file_id for file_id in (_concept_source_file_id(concept) for concept in course_concepts)
        if file_id
    }
    per_file = slots_per_file
    sparse = force_detail_sparse or _course_is_detail_sparse(
        course_concepts,
        sparse_threshold=sparse_threshold,
        sparse_empty_fraction=sparse_empty_fraction,
    )
    humanities_heavy = _course_humanities_reading_heavy(file_ids, file_type_resolver)
    lecture_heavy = _course_is_lecture_slides_heavy(course_files or {}, file_type_resolver)
    file_count = len(file_ids)
    if sparse:
        per_file = sparse_slots_per_file
    if humanities_heavy:
        per_file = min(max(per_file, 2), 3)
        if file_count > 15:
            per_file = min(per_file, 2)
    # Bulk linked-lecture STEM courses only — not compact lecture-slide layouts (ART102).
    if bulk_linked:
        per_file = min(per_file, 2)
    elif file_count > 40 and not lecture_heavy:
        per_file = min(per_file, 1)
    elif sparse and file_count > 15 and not lecture_heavy:
        per_file = min(per_file, 2)
    if lecture_heavy:
        lecture_slots = 7 if file_count >= 20 else slots_per_file
        per_file = max(per_file, lecture_slots)
        floor = max(floor, min(250, file_count * lecture_slots))
    budget = max(floor, file_count * per_file)
    if bulk_linked and not lecture_heavy:
        budget = min(budget, max(floor, int(file_count * 1.55) + 2))
    if len(course_concepts) <= budget:
        return 0

    if humanities_heavy:
        reserved_terms = [
            concept for concept in course_concepts
            if str(getattr(concept, 'conceptid') or '').startswith(('reading-term-', 'reading-arg-'))
        ]
        reserved_sections = [
            concept for concept in course_concepts
            if str(getattr(concept, 'conceptid') or '').startswith('reading-')
            and not str(getattr(concept, 'conceptid') or '').startswith(
                ('reading-term-', 'reading-arg-', 'reading-file-', 'reading-chapter-')
            )
        ]
        term_cap = min(10, max(3, budget // 4), len(reserved_terms))
        section_cap = min(8, max(2, budget // 5), len(reserved_sections))
        ranked_terms = sorted(reserved_terms, key=_reading_term_budget_rank, reverse=True)[:term_cap]
        ranked_sections = sorted(
            reserved_sections,
            key=_humanities_concept_cap_rank,
            reverse=True,
        )[:section_cap]
        reserved_ids = {id(concept) for concept in ranked_terms + ranked_sections}
        other_budget = max(0, budget - len(reserved_ids))
        others = [concept for concept in course_concepts if id(concept) not in reserved_ids]
        ranked_other = sorted(others, key=_course_concept_budget_rank, reverse=True)[:other_budget]
        keep_ids = reserved_ids | {id(concept) for concept in ranked_other}
    else:
        ranked = sorted(course_concepts, key=_course_concept_budget_rank, reverse=True)
        keep_ids = {id(concept) for concept in ranked[:budget]}
    removed = 0
    kept = []
    for concept in course_concepts:
        if id(concept) in keep_ids:
            kept.append(concept)
        else:
            removed += 1
    course_concepts[:] = kept
    return removed


def cap_course_detail_budget(
    course_concepts,
    *,
    ratio=0.17,
    sparse_ratio=0.04,
    humanities_ratio=0.12,
    floor=2,
    humanities_floor=4,
    sparse_threshold=0.20,
    sparse_empty_fraction=0.70,
    force_detail_sparse=False,
    humanities_heavy=False,
):
    """Keep detail volume near quality baseline (~0.17/concept; ~0.04 for detail-sparse STEM)."""
    if not course_concepts:
        return 0
    concept_count = len(course_concepts)
    effective_ratio = ratio
    detail_floor = floor
    if humanities_heavy:
        effective_ratio = humanities_ratio
        detail_floor = humanities_floor
    elif concept_count and (
        force_detail_sparse
        or _course_is_detail_sparse(
            course_concepts,
            sparse_threshold=sparse_threshold,
            sparse_empty_fraction=sparse_empty_fraction,
        )
    ):
        effective_ratio = sparse_ratio
    budget = max(detail_floor, int(concept_count * effective_ratio))
    ranked = []
    for concept in course_concepts:
        for detail in getattr(concept, 'details', []) or []:
            ranked.append((
                len(str(getattr(detail, 'description', '') or '')),
                concept,
                detail,
            ))
    if len(ranked) <= budget:
        return 0
    ranked.sort(key=lambda item: item[0], reverse=True)
    keep_ids = {id(item[2]) for item in ranked[:budget]}
    removed = 0
    for concept in course_concepts:
        before = len(getattr(concept, 'details', []) or [])
        concept.details = [
            detail for detail in (getattr(concept, 'details', []) or [])
            if id(detail) in keep_ids
        ]
        removed += before - len(concept.details)
    return removed


def apply_concept_id_remap(courseid, concept_nodes, problems_dict, graph_edges, id_remap):
    if not id_remap:
        return

    for concept in concept_nodes.get(courseid, []) or []:
        concept.prerequisiteConceptIds = [
            remap_identifier(item, id_remap) for item in concept.prerequisiteConceptIds
        ]

    for problem in problems_dict.get(courseid, []) or []:
        problem.incomingConceptNodeIds = [
            remap_identifier(item, id_remap) for item in problem.incomingConceptNodeIds
        ]
        problem.outgoingConceptNodeIds = [
            remap_identifier(item, id_remap) for item in problem.outgoingConceptNodeIds
        ]

    for edge in graph_edges.edges:
        if edge.get('fromType') == 'concept':
            edge['fromId'] = remap_identifier(edge.get('fromId'), id_remap)
        if edge.get('toType') == 'concept':
            edge['toId'] = remap_identifier(edge.get('toId'), id_remap)
