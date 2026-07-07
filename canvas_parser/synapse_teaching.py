"""Course curricula from graph teaching blocks for Synapse Learn mode."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.content.teaching_blocks import (  # noqa: E402
    extract_teaching_units_from_pages,
    teaching_labels_match,
)
from canvas_parser.content.holistic_canvas import (  # noqa: E402
    CANVAS_HELP_BLOCK,
    build_holistic_link_lessons,
    build_page_teaching_lessons,
    load_canvas_data,
)
from canvas_parser.synapse_teaching_sections import (  # noqa: E402
    assign_section_groups_from_canvas,
    build_canvas_module_order_index,
    lesson_canvas_sort_key,
)
from canvas_parser.graph.sequence_hints import document_order_sort_key  # noqa: E402
from canvas_parser.synapse_grounding import attach_curriculum_grounding  # noqa: E402

DEFAULT_GRAPH = ROOT / 'canvas_graph.json'
FIXTURE_GRAPH = ROOT / 'tests' / 'fixtures' / 'sample-graph.json'
CANVAS_DATA_PATH = ROOT / 'canvas_data.json'
SYLLABUS_HINT = re.compile(r'syllabus|homepage|course\s*outline', re.I)
LECTURE_FILE = re.compile(r'lecture\s*(\d+)', re.I)
WEEK_MODULE = re.compile(r'week\s*(\d+)', re.I)
PROBLEM_NUM = re.compile(r'(?:problem|exercise|question|ex\.?|q\.?)\s*[#.]?\s*(\d+)', re.I)
COURSE_CODE_PREFIX = re.compile(
    r'^([A-Z]{2,6}(?:-[A-Z0-9]+)?_[FS]\d{4}|[A-Z]{2,6}\s*\d{2,4}[A-Z]?)\s+(.+)$',
    re.I,
)
LOW_QUALITY_LESSON = re.compile(
    r'^(?:also posted|see\b.+\bwebsite|professor of\b|\d{1,2}$|'
    r'watch lecture\b|precepts start\b|class schedule$|research participation assignment$)',
    re.I,
)
LOGISTICS_FILE = re.compile(r'intro|logistics|homepage|how to do well', re.I)
ADMIN_CONCEPT_OK = re.compile(
    r'course goals?|problem sets?|grading|exam|quiz|syllabus|lecture|precept|office hours',
    re.I,
)
PERSON_NAME_LIKE = re.compile(
    r'^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$',
)
UNIT_FILE = re.compile(r'unit\s*(\d+)', re.I)
CHAPTER_FILE = re.compile(r'chapter\s*(\d+)', re.I)
SYLLABUS_ADMIN_CONCEPT = re.compile(
    r'problem sets?|(?:in-class )?quizzes?|cumulative final|grading(?: policy)?|'
    r'office hours|course policies|attendance|homework policy|late policy|'
    r'academic integrity|plagiarism|research participation',
    re.I,
)
EXAM_ARTIFACT = re.compile(
    r'choose all that apply|left/right|true or false|circle (?:one|the)|select all',
    re.I,
)
CONCATENATED_JUNK = re.compile(r'[a-z]{2}[A-Z]|[a-z][A-Z][a-z]')
INCOMPLETE_SENTENCE = re.compile(r',\s*(?:so|and|or|but|which|that)\s*$', re.I)
TRAILING_FRAGMENT = re.compile(r'(?:~|=|\+|\|)\s*$')
DUPLICATE_PARSER_SECTION = re.compile(
    r'\((?:alt(?:ernate)?|duplicate|source \d+|2|summary|detail|from precept)\)$',
    re.I,
)
INSTRUCTOR_LESSON = re.compile(r'^instructor\b', re.I)
TEXTBOOK_LESSON = re.compile(r'textbook|character website|pleco|dictionary|oh china|trip to china', re.I)
ADMIN_LESSON = re.compile(r'^instructor\b|office hours|grading statistics|grade statistics', re.I)
SUPPLEMENTAL_MODULE = re.compile(
    r'solution|past exam|precept|assignment solution|grade curve|'
    r'individual session|letter sample|outside sources',
    re.I,
)
SPINE_MODULE = re.compile(
    r'syllabus|schedule|course resource|lecture note|lecture slide|week\s*\d|'
    r'pinyin|audio material|course slides|introduction|semester|videos?',
    re.I,
)
SYLLABUS_LOGISTICS = re.compile(r'homework|problem set|pset|midterm|final exam|quiz', re.I)
ANSWER_KEY_FILE = re.compile(r'\bkey\b|solution', re.I)
GRADE_ARTIFACT = re.compile(r'grade curve|course grade|quiz \d+$', re.I)
HOLISTIC_NOISE = re.compile(r'bloomberg|economist|tariff', re.I)
# A genuinely solvable problem uses an explicit solve verb or a question. The parser
# over-labels numbered list items (grammar notes, syllabus rows) as `problem`; those
# carry none of these markers and should read as content, not a "solve this" prompt.
PROBLEM_SOLVE_SIGNAL = re.compile(
    r'\?|'
    r'\b(find|calculate|compute|solve|prove|derive|evaluate|determine|sketch|'
    r'estimate|simplify|show that|how much|how many|what is|what are|which of)\b',
    re.I,
)
SPREADSHEET_FILE = re.compile(r'\.(?:xls|xlsx)$', re.I)
BLOCK_NOISE_THRESHOLD = 400
MIN_CONCEPTS_FOR_BLOCK_OVERRIDE = 8
SPARSE_CURRICULUM_THRESHOLD = 25
MIN_DOCUMENT_ORDER_COVERAGE = 0.12
SNIPPET_LIMIT = 240
TEACHING_CONTEXT_LIMIT = 1200
DEFAULT_MAX_LESSONS = 300
ABSOLUTE_MAX_LESSONS = 750
THIN_CONTEXT_THRESHOLD = 80
LESSON_TYPE_PRIORITY = {'section': 0, 'example': 1, 'problem': 2, 'concept': 3}

_canvas_name_cache: dict[str, str] | None = None



def load_graph(graph_path=None, use_fixture=False):
    path = Path(graph_path or DEFAULT_GRAPH)
    if use_fixture or not path.exists():
        path = FIXTURE_GRAPH
    return json.loads(path.read_text(encoding='utf-8'))


def load_canvas_course_names():
    global _canvas_name_cache
    if _canvas_name_cache is not None:
        return _canvas_name_cache

    names: dict[str, str] = {}
    try:
        data = json.loads(CANVAS_DATA_PATH.read_text(encoding='utf-8'))
        for course in data.get('courses') or []:
            if not isinstance(course, dict):
                continue
            course_id = course.get('id')
            if course_id is None:
                continue
            label = str(course.get('name') or course.get('course_code') or '').strip()
            if label:
                names[str(course_id)] = label
    except (OSError, json.JSONDecodeError):
        pass
    _canvas_name_cache = names
    return names


def _title_from_filename(filename: str) -> str:
    name = str(filename or '').strip()
    if not name:
        return ''
    stem = re.sub(r'\.(pdf|html?|docx?)$', '', name, flags=re.I).strip()
    match = COURSE_CODE_PREFIX.match(stem)
    if match:
        return f"{match.group(1)} {match.group(2).strip()}".strip()
    if SYLLABUS_HINT.search(stem):
        return stem
    return ''


def infer_course_label_from_graph(course_id: str, graph: dict) -> str:
    course_files = (graph.get('files') or {}).get(str(course_id)) or {}
    if not isinstance(course_files, dict):
        return ''

    candidates: list[str] = []
    for file_node in course_files.values():
        if not isinstance(file_node, dict):
            continue
        title = _title_from_filename(str(file_node.get('name') or ''))
        if title:
            candidates.append(title)

    if not candidates:
        return ''

    candidates.sort(key=lambda row: (
        0 if SYLLABUS_HINT.search(row) else 1,
        len(row),
    ))
    return candidates[0]


def resolve_course_meta(course_id: str, graph: dict) -> dict:
    course_id = str(course_id or '').strip()
    canvas_names = load_canvas_course_names()
    label = canvas_names.get(course_id, '')
    source = 'canvas_data' if label else ''

    if not label:
        label = infer_course_label_from_graph(course_id, graph)
        if label:
            source = 'filename'

    if not label:
        syllabus = (graph.get('syllabi') or {}).get(course_id) or {}
        if isinstance(syllabus, dict):
            label = str(syllabus.get('courseid') or '').strip()
            if label:
                source = 'syllabus'

    if not label:
        label = course_id
        source = 'id'

    return {
        'id': course_id,
        'name': label,
        'label': label,
        'source': source,
    }


def list_courses(graph, teachable_only=False):
    course_ids = set((graph.get('files') or {}).keys())
    rows = [resolve_course_meta(course_id, graph) for course_id in course_ids]
    rows.sort(key=lambda row: (row.get('label') or row.get('id')).casefold())

    if not teachable_only:
        return rows
    return [row for row in rows if course_has_teaching_units(graph, row['id'])]


def course_concepts_for_id(graph, course_id: str) -> list[dict]:
    course_id = str(course_id or '').strip()
    rows = []
    for concept in graph.get('concepts') or []:
        if not isinstance(concept, dict):
            continue
        if str(concept.get('courseid') or '').strip() != course_id:
            continue
        name = str(concept.get('name') or '').strip()
        if name:
            rows.append(concept)
    return rows


def course_has_teaching_units(graph, course_id):
    course_id = str(course_id or '').strip()
    course_files = (graph.get('files') or {}).get(course_id) or {}
    if isinstance(course_files, dict):
        for file_node in course_files.values():
            if not isinstance(file_node, dict):
                continue
            pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
            if extract_teaching_units_from_pages(pages, max_units=1):
                return True
    if course_concepts_for_id(graph, course_id):
        return True
    if build_syllabus_fallback_lessons(graph, course_id, max_lessons=1):
        return True
    if build_module_fallback_lessons(graph, course_id, max_lessons=1):
        return True
    return False


def _parse_page_number(value) -> float:
    if value is None or value == '':
        return 0.0
    text = str(value).strip()
    match = re.search(r'(\d+(?:\.\d+)?)', text)
    if match:
        return float(match.group(1))
    return 0.0


def _module_sort_key(hint: dict) -> tuple:
    module_name = str(hint.get('moduleName') or '')
    week_match = WEEK_MODULE.search(module_name)
    week_num = int(week_match.group(1)) if week_match else 999
    return (
        week_num,
        str(hint.get('moduleId') or ''),
        int(hint.get('position') or 0),
    )


LOCAL_HYDRATE_MAX_FILES = 32
LOCAL_HYDRATE_PROBE_LIMIT = 8


def _patch_course_files(graph: dict, course_id: str, course_files: dict) -> dict:
    files = dict(graph.get('files') or {})
    files[str(course_id)] = course_files
    return {**graph, 'files': files}


def _collect_hydration_file_ids(
    course_id: str,
    graph: dict,
    *,
    extra_ids: list[str] | None = None,
) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()

    hints = (graph.get('moduleOrderHints') or {}).get(str(course_id)) or {}
    if isinstance(hints, dict):
        ordered = sorted(
            (hint for hint in hints.values() if isinstance(hint, dict)),
            key=_module_sort_key,
        )
        for hint in ordered:
            if str(hint.get('itemType') or '').lower() != 'file':
                continue
            file_id = str(hint.get('contentId') or '').strip()
            if file_id and file_id not in seen:
                seen.add(file_id)
                candidates.append(file_id)

    course_files = (graph.get('files') or {}).get(str(course_id)) or {}
    if isinstance(course_files, dict):
        for file_id in course_files:
            fid = str(file_id).strip()
            if fid and fid not in seen:
                seen.add(fid)
                candidates.append(fid)
    for file_id in extra_ids or []:
        fid = str(file_id or '').strip()
        if fid and fid not in seen:
            seen.add(fid)
            candidates.append(fid)
    return candidates


def hydrate_course_from_local_files(
    graph: dict,
    course_id: str,
    *,
    max_files: int = LOCAL_HYDRATE_MAX_FILES,
    file_id_filter: set[str] | None = None,
) -> tuple[dict, dict]:
    """Attach positioned blocks from canvasfiles/ for unindexed graph files (in-memory)."""
    from canvas_parser.content.page_blocks import pages_missing_positioned_blocks
    from canvas_parser.index_on_read import (
        extract_blocks_from_path,
        file_node_has_blocks,
        local_canvasfile_path,
    )
    from parser import merge_file_pages, normalize_file_pages

    course_id = str(course_id or '').strip()
    raw_course_files = (graph.get('files') or {}).get(course_id) or {}
    course_files = dict(raw_course_files) if isinstance(raw_course_files, dict) else {}

    candidates = _collect_hydration_file_ids(
        course_id,
        graph,
        extra_ids=list(file_id_filter or []),
    )
    if file_id_filter:
        candidates = [fid for fid in candidates if fid in file_id_filter]
    stats = {
        'candidateFiles': len(candidates),
        'hydratedFiles': 0,
        'skippedExisting': 0,
        'missingLocal': 0,
        'extractFailed': 0,
        'abortedEarly': False,
    }

    miss_streak = 0
    for file_id in candidates:
        if stats['hydratedFiles'] >= max_files:
            break
        file_node = course_files.get(file_id)
        if isinstance(file_node, dict) and file_node_has_blocks(file_node):
            stats['skippedExisting'] += 1
            miss_streak = 0
            continue

        local_path = local_canvasfile_path(file_id)
        if not local_path.exists():
            stats['missingLocal'] += 1
            if stats['hydratedFiles'] == 0:
                miss_streak += 1
                if miss_streak >= LOCAL_HYDRATE_PROBE_LIMIT:
                    stats['abortedEarly'] = True
                    break
            continue

        miss_streak = 0
        filename = str((file_node or {}).get('name') or local_path.name)
        try:
            pages = extract_blocks_from_path(local_path, file_id, filename=filename)
        except Exception:
            stats['extractFailed'] += 1
            continue

        pages = normalize_file_pages(pages or [], file_id)
        if not pages or pages_missing_positioned_blocks(pages):
            stats['extractFailed'] += 1
            continue

        if not isinstance(file_node, dict):
            file_node = {'fileid': file_id, 'courseid': course_id, 'name': filename}
        existing_pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
        file_node['pages'] = merge_file_pages(existing_pages, pages)
        file_node['fileid'] = file_id
        file_node['courseid'] = course_id
        if filename:
            file_node['name'] = filename
        course_files[file_id] = file_node
        stats['hydratedFiles'] += 1

    return _patch_course_files(graph, course_id, course_files), stats


def enrich_graph_content(graph: dict, course_id: str) -> tuple[dict, dict]:
    """Homepage HTML, holistic link discovery, and local file block hydration."""
    from canvas_parser.content.holistic_canvas import (
        collect_linked_canvas_file_ids,
        enrich_course_files_holistic,
        load_canvas_data,
    )

    course_id = str(course_id or '').strip()
    canvas_data = load_canvas_data()
    linked_ids = collect_linked_canvas_file_ids(course_id, graph, canvas_data)

    def _hydrate_filtered(patched_graph, cid, file_id_filter=None):
        return hydrate_course_from_local_files(
            patched_graph,
            cid,
            max_files=max(LOCAL_HYDRATE_MAX_FILES, len(file_id_filter or [])),
            file_id_filter=file_id_filter,
        )

    graph, holistic_stats = enrich_course_files_holistic(
        graph,
        course_id,
        hydrate_local_files_fn=lambda g, cid, file_id_filter=None: _hydrate_filtered(
            g,
            cid,
            file_id_filter=file_id_filter or set(linked_ids),
        ),
    )
    graph, local_stats = hydrate_course_from_local_files(graph, course_id)
    if holistic_stats.get('localHydrationAborted') and local_stats.get('abortedEarly'):
        local_stats = {**local_stats, 'skippedDuplicateScan': True}
    stats = {
        **holistic_stats,
        **local_stats,
        'linkedFileIds': len(linked_ids),
    }
    return graph, stats


def build_file_rank_map(course_id: str, graph: dict) -> dict[str, int]:
    hints = (graph.get('moduleOrderHints') or {}).get(str(course_id)) or {}
    file_hints: list[tuple[str, dict]] = []
    if isinstance(hints, dict):
        for hint in hints.values():
            if not isinstance(hint, dict):
                continue
            if str(hint.get('itemType') or '').lower() != 'file':
                continue
            file_id = str(hint.get('contentId') or '').strip()
            if file_id:
                file_hints.append((file_id, hint))

    file_hints.sort(key=lambda pair: _module_sort_key(pair[1]))
    ranks: dict[str, int] = {}
    next_rank = 0
    for file_id, _ in file_hints:
        if file_id not in ranks:
            ranks[file_id] = next_rank
            next_rank += 1

    course_files = (graph.get('files') or {}).get(str(course_id)) or {}
    if isinstance(course_files, dict):
        syllabus_ids: list[str] = []
        for file_id, file_node in course_files.items():
            if not isinstance(file_node, dict):
                continue
            name = str(file_node.get('name') or '')
            if SYLLABUS_HINT.search(name):
                syllabus_ids.append(str(file_id))
        syllabus_ids.sort(
            key=lambda fid: (
                0 if str((course_files.get(fid) or {}).get('name') or '').startswith('course-syllabus') else 1,
                str((course_files.get(fid) or {}).get('name') or '').casefold(),
            ),
        )
        for index, file_id in enumerate(syllabus_ids):
            ranks.setdefault(file_id, -200 + index)

    homepage_id = f'homepage-{course_id}'
    if homepage_id in course_files:
        ranks.setdefault(homepage_id, -150)

    return ranks


def build_file_module_map(course_id: str, graph: dict) -> dict[str, str]:
    hints = (graph.get('moduleOrderHints') or {}).get(str(course_id)) or {}
    module_map: dict[str, str] = {}
    if not isinstance(hints, dict):
        return module_map
    for hint in hints.values():
        if not isinstance(hint, dict):
            continue
        if str(hint.get('itemType') or '').lower() != 'file':
            continue
        file_id = str(hint.get('contentId') or '').strip()
        module_name = str(hint.get('moduleName') or '').strip()
        if file_id and module_name and file_id not in module_map:
            module_map[file_id] = module_name
    return module_map


def file_sort_key(
    course_id: str,
    file_id: str,
    file_node: dict,
    graph: dict,
    rank_map: dict[str, int] | None = None,
) -> tuple:
    rank_map = rank_map if rank_map is not None else build_file_rank_map(course_id, graph)
    file_id = str(file_id)
    if file_id in rank_map:
        return (0, rank_map[file_id], '')

    name = str(file_node.get('name') or file_id)
    if SYLLABUS_HINT.search(name):
        return (-1, 0, name.casefold())

    lecture_match = LECTURE_FILE.search(name)
    if lecture_match:
        return (1, int(lecture_match.group(1)), name.casefold())

    unit_match = UNIT_FILE.search(name)
    if unit_match:
        return (2, int(unit_match.group(1)), name.casefold())

    chapter_match = CHAPTER_FILE.search(name)
    if chapter_match:
        return (3, int(chapter_match.group(1)), name.casefold())

    return (4, 0, name.casefold())


def _lesson_is_low_quality(lesson: dict) -> bool:
    name = str(lesson.get('name') or '').strip()
    lesson_type = str(lesson.get('type') or '')
    filename = str(lesson.get('filename') or '')
    if lesson_type == 'section' and re.fullmatch(r'\d{1,2}', name):
        if WEEK_MODULE.search(str(lesson.get('moduleName') or '')):
            return False
        return True
    if not name or len(name) < 2:
        return True
    if LOW_QUALITY_LESSON.search(name):
        return True
    if EXAM_ARTIFACT.search(name):
        return True
    if CONCATENATED_JUNK.search(name):
        return True
    if INCOMPLETE_SENTENCE.search(name):
        return True
    if TRAILING_FRAGMENT.search(name):
        return True
    if lesson_type in {'section', 'concept'} and len(name) < 8 and ' ' not in name:
        return True
    if lesson_type == 'concept' and PERSON_NAME_LIKE.match(name):
        if not re.search(
            r'\b(products|systems|algebra|calculus|neurons|memory|structure|function|'
            r'analysis|theory|models|methods|introduction|overview|matrix|vector|'
            r'cell|protein|exam|lecture|chapter|week|problem)\b',
            name,
            re.I,
        ):
            return True
    if lesson_type == 'concept' and len(name) > 48 and ' ' not in name.strip():
        return True
    if lesson_type == 'concept' and LOGISTICS_FILE.search(filename):
        if not ADMIN_CONCEPT_OK.search(name):
            snippet = str(lesson.get('snippet') or lesson.get('teachingContext') or '')
            if len(snippet) < THIN_CONTEXT_THRESHOLD:
                return True
    if lesson_type == 'section' and 'homepage' in filename.casefold():
        snippet = str(lesson.get('snippet') or lesson.get('teachingContext') or '')
        if CANVAS_HELP_BLOCK.search(name) or CANVAS_HELP_BLOCK.search(snippet):
            return True
    if SYLLABUS_HINT.search(filename) and lesson_type == 'concept':
        if SYLLABUS_ADMIN_CONCEPT.search(name):
            return True
    if INSTRUCTOR_LESSON.search(name) and lesson_type == 'concept':
        return True
    if DUPLICATE_PARSER_SECTION.search(name):
        return True
    if lesson_type == 'section' and DUPLICATE_PARSER_SECTION.search(name):
        return True
    if lesson_type == 'section' and GRADE_ARTIFACT.search(name):
        return True
    if lesson_type == 'section' and ANSWER_KEY_FILE.search(filename):
        if LECTURE_FILE.search(filename) or LECTURE_FILE.search(name):
            return False
        return True
    if SPREADSHEET_FILE.search(filename):
        return True
    return False


def _section_anchor_name(lesson: dict) -> str:
    lesson_type = str(lesson.get('type') or '')
    if lesson_type != 'section':
        return ''
    name = str(lesson.get('name') or '').strip()
    week_match = WEEK_MODULE.search(str(lesson.get('snippet') or ''))
    if week_match:
        return f"Week {week_match.group(1)}"
    if name.isdigit():
        module_name = str(lesson.get('moduleName') or '')
        if WEEK_MODULE.search(module_name):
            return f"Week {name}"
        return ''
    return name if len(name) >= 3 else ''


def _assign_section_groups(lessons: list[dict]) -> None:
    current_section = 'Introduction'
    current_file = ''
    for lesson in lessons:
        file_id = str(lesson.get('fileId') or '')
        if file_id != current_file:
            current_file = file_id
            module_name = str(lesson.get('moduleName') or '').strip()
            current_section = module_name or 'Introduction'
        anchor = _section_anchor_name(lesson)
        if anchor:
            current_section = anchor
        lesson['sectionGroup'] = current_section


def _lesson_sort_key(row: dict) -> tuple:
    problem_match = PROBLEM_NUM.search(str(row.get('name') or ''))
    problem_num = int(problem_match.group(1)) if problem_match else 9999
    y_pos = row.get('yRatio0')
    if y_pos is None:
        y_pos = row.get('y0')
    if y_pos is None:
        y_pos = 0
    return (
        tuple(row.get('fileSortKey') or (9, 0, '')),
        _parse_page_number(row.get('pageNumber')),
        float(y_pos),
        int(row.get('sequenceIndex') or 0),
        0 if problem_match else 1,
        problem_num,
        str(row.get('name') or '').casefold(),
    )


def _lesson_local_sort_key(row: dict) -> tuple:
    problem_match = PROBLEM_NUM.search(str(row.get('name') or ''))
    problem_num = int(problem_match.group(1)) if problem_match else 9999
    y_pos = row.get('yRatio0')
    if y_pos is None:
        y_pos = row.get('y0')
    if y_pos is None:
        y_pos = 0
    return (
        _parse_page_number(row.get('pageNumber')),
        0 if problem_match else 1,
        problem_num,
        float(y_pos),
        int(row.get('sequenceIndex') or 0),
        str(row.get('name') or '').casefold(),
    )


def _concept_module_name(concept: dict, module_map: dict[str, str] | None = None) -> str:
    hints = concept.get('moduleOrderHints') if isinstance(concept.get('moduleOrderHints'), list) else []
    for hint in hints:
        if not isinstance(hint, dict):
            continue
        module_name = str(hint.get('moduleName') or '').strip()
        if module_name:
            return module_name
    module_map = module_map or {}
    for ref in concept.get('sourcePages') or []:
        if not isinstance(ref, dict):
            continue
        file_id = str(ref.get('fileid') or '').strip()
        module_name = module_map.get(file_id, '')
        if module_name:
            return module_name
    return ''


def _concept_sort_key(concept: dict) -> tuple:
    hints = concept.get('moduleOrderHints') if isinstance(concept.get('moduleOrderHints'), list) else []
    if hints:
        first = hints[0] if isinstance(hints[0], dict) else {}
        week_match = WEEK_MODULE.search(str(first.get('moduleName') or ''))
        week_num = int(week_match.group(1)) if week_match else 999
        return (0, week_num, int(first.get('position') or 0), str(concept.get('name') or '').casefold())

    document_order = concept.get('documentOrder')
    if isinstance(document_order, dict) and (
        document_order.get('fileId')
        or document_order.get('pageNumber')
        or document_order.get('sequenceIndex')
    ):
        return (1, *document_order_sort_key(document_order))

    return (2, 0, 0, 0, str(concept.get('name') or '').casefold())


def _snippet_from_text(text: str, fallback: str = '', limit: int = SNIPPET_LIMIT) -> str:
    cleaned = re.sub(r'\s+', ' ', str(text or '')).strip()
    if cleaned:
        return cleaned[:limit]
    return str(fallback or '')[:limit]


def resolve_lesson_cap(uncapped_count: int, requested_max: int) -> int:
    """Scale lesson cap for large courses while keeping a hard ceiling."""
    if not requested_max:
        return uncapped_count
    if uncapped_count <= requested_max:
        return uncapped_count
    if requested_max < DEFAULT_MAX_LESSONS:
        return requested_max
    if uncapped_count <= ABSOLUTE_MAX_LESSONS:
        return uncapped_count
    return ABSOLUTE_MAX_LESSONS


def _concept_body_text(concept: dict) -> str:
    parts: list[str] = []
    concept_name = str(concept.get('name') or '').strip()
    desc = str(concept.get('description') or '').strip()
    if desc and desc.casefold() != concept_name.casefold():
        parts.append(desc)
    for detail in concept.get('details') or []:
        if not isinstance(detail, dict):
            continue
        detail_name = str(detail.get('name') or '').strip()
        detail_desc = str(detail.get('description') or '').strip()
        if detail_desc:
            parts.append(f'{detail_name}: {detail_desc}' if detail_name else detail_desc)
        elif detail_name and detail_name.casefold() != concept_name.casefold():
            parts.append(detail_name)
    return re.sub(r'\s+', ' ', ' '.join(parts)).strip()


def build_learning_block_lessons(graph: dict, course_id: str, max_lessons: int = 0) -> list[dict]:
    """Build sequenced curriculum lessons from hybrid learningBlocks."""
    course_id = str(course_id or '').strip()
    blocks = (graph.get('learningBlocks') or {}).get(course_id) or []
    if not isinstance(blocks, list) or not blocks:
        return []

    concepts_by_id = {
        str(concept.get('conceptid') or ''): concept
        for concept in course_concepts_for_id(graph, course_id)
        if concept.get('conceptid')
    }
    lessons: list[dict] = []
    ordered_blocks = sorted(
        [block for block in blocks if isinstance(block, dict) and block.get('blockId')],
        key=lambda block: int(block.get('order') or 0),
    )
    for block in ordered_blocks:
        concept = concepts_by_id.get(str(block.get('conceptId') or '')) or {}
        name = str(concept.get('name') or block.get('conceptId') or '').strip()
        if not name:
            continue
        explanation = str(block.get('explanation') or concept.get('description') or name).strip()
        source_refs = block.get('sourceRefs') if isinstance(block.get('sourceRefs'), list) else []
        file_id = ''
        page_number = None
        pageid = ''
        if source_refs and isinstance(source_refs[0], dict):
            file_id = str(source_refs[0].get('fileid') or '')
            page_number = source_refs[0].get('pageNumber')
            pageid = str(source_refs[0].get('pageid') or '')
        lessons.append({
            'id': f"{course_id}:learning-block:{block.get('blockId')}",
            'courseId': course_id,
            'type': 'concept',
            'name': name,
            'snippet': _snippet_from_text(explanation, name),
            'contextText': _snippet_from_text(explanation, name, TEACHING_CONTEXT_LIMIT),
            'teachingContext': _snippet_from_text(explanation, name, TEACHING_CONTEXT_LIMIT),
            'fileId': file_id,
            'filename': '',
            'pageNumber': page_number,
            'pageid': pageid,
            'sequenceIndex': int(block.get('order') or len(lessons)),
            'y0': None,
            'yRatio0': None,
            'moduleName': '',
            'source': 'learning_blocks',
            'blockId': str(block.get('blockId') or ''),
            'orderSource': str(block.get('orderSource') or ''),
            'detailRefs': block.get('detailRefs') if isinstance(block.get('detailRefs'), list) else [],
        })
        if max_lessons and len(lessons) >= max_lessons:
            break
    lessons.sort(key=_learning_block_sort_key)
    return lessons


def _learning_block_sort_key(lesson: dict) -> tuple:
    name = str(lesson.get('name') or '')
    if TEXTBOOK_LESSON.search(name):
        return (0, int(lesson.get('sequenceIndex') or 0), name.casefold())
    if ADMIN_LESSON.search(name):
        return (9, int(lesson.get('sequenceIndex') or 0), name.casefold())
    return (5, int(lesson.get('sequenceIndex') or 0), name.casefold())


def build_concept_fallback_lessons(
    graph: dict,
    course_id: str,
    max_lessons: int = 0,
    module_map: dict[str, str] | None = None,
) -> list[dict]:
    """Build lessons from parser concepts when file page blocks are missing."""
    course_id = str(course_id or '').strip()
    if module_map is None:
        module_map = build_file_module_map(course_id, graph)
    concepts = sorted(course_concepts_for_id(graph, course_id), key=_concept_sort_key)
    if not concepts:
        return []

    lessons: list[dict] = []
    seen: set[tuple[str, str]] = set()
    seen_names: set[str] = set()

    def append_lesson(lesson_type: str, name: str, snippet: str, module_name: str = '', source: str = 'graph_concept') -> None:
        name = str(name or '').strip()
        if not name:
            return
        name_key = name.casefold()
        if name_key in seen_names:
            return
        key = (lesson_type, name_key)
        if key in seen:
            return
        seen.add(key)
        seen_names.add(name_key)
        full_context = _snippet_from_text(snippet, name, TEACHING_CONTEXT_LIMIT)
        candidate = {
            'id': f"{course_id}:concept:{lesson_type}:{name}",
            'courseId': course_id,
            'type': lesson_type,
            'name': name,
            'snippet': _snippet_from_text(snippet, name),
            'teachingContext': full_context,
            'fileId': '',
            'filename': '',
            'pageNumber': None,
            'pageid': '',
            'sequenceIndex': len(lessons),
            'y0': None,
            'yRatio0': None,
            'moduleName': module_name,
            'source': source,
        }
        if _lesson_is_low_quality(candidate):
            return
        lessons.append(candidate)

    for concept in concepts:
        module_name = _concept_module_name(concept, module_map)
        concept_name = str(concept.get('name') or '').strip()
        concept_body = _concept_body_text(concept)
        concept_desc = str(concept.get('description') or '').strip()
        append_lesson(
            'concept',
            concept_name,
            concept_body or concept_desc or concept_name,
            module_name,
        )

        for detail in concept.get('details') or []:
            if not isinstance(detail, dict):
                continue
            detail_name = str(detail.get('name') or '').strip()
            detail_desc = str(detail.get('description') or concept_desc).strip()
            section_body = detail_desc
            if len(section_body) < THIN_CONTEXT_THRESHOLD and concept_body:
                section_body = f'{detail_name}. {concept_body}' if detail_name else concept_body
            append_lesson('section', detail_name, section_body or detail_name, module_name)

        for example in concept.get('examples') or []:
            if not isinstance(example, dict):
                continue
            example_name = str(example.get('name') or '').strip()
            example_desc = str(example.get('description') or concept_desc).strip()
            append_lesson('example', example_name, example_desc or example_name, module_name)

    graph_problems = build_graph_problems_for_course(graph, course_id)
    for problem in graph_problems:
        problem_name = str(problem.get('name') or '').strip()
        if not problem_name:
            continue
        steps = problem.get('steps') if isinstance(problem.get('steps'), list) else []
        snippet = ' '.join(str(step).strip() for step in steps if str(step).strip()) or problem_name
        append_lesson('problem', problem_name, snippet, source='graph_problem')

    if max_lessons and len(lessons) > max_lessons:
        lessons = lessons[:max_lessons]
    return lessons


def _lesson_group_key(lesson: dict) -> str:
    module_name = str(lesson.get('moduleName') or '').strip()
    if module_name:
        return module_name
    return str(lesson.get('sectionGroup') or 'General').strip() or 'General'


def _merge_block_interactives(concept_lessons: list[dict], block_lessons: list[dict]) -> list[dict]:
    seen = {
        (str(lesson.get('type') or ''), str(lesson.get('name') or '').casefold())
        for lesson in concept_lessons
    }
    merged = list(concept_lessons)
    for lesson in block_lessons:
        lesson_type = str(lesson.get('type') or '')
        if lesson_type not in {'problem', 'example'}:
            continue
        key = (lesson_type, str(lesson.get('name') or '').casefold())
        if key in seen:
            continue
        seen.add(key)
        merged.append(lesson)
    return merged


def _syllabus_lessons_are_logistics_only(lessons: list[dict]) -> bool:
    if not lessons:
        return False
    logistics = 0
    for lesson in lessons:
        name = str(lesson.get('name') or '')
        if SYLLABUS_LOGISTICS.search(name):
            logistics += 1
    return logistics >= max(3, int(len(lessons) * 0.6))


def _canvas_module_is_supplemental(module_name: str) -> bool:
    return bool(SUPPLEMENTAL_MODULE.search(str(module_name or '')))


def _canvas_module_is_spine(module_name: str) -> bool:
    return bool(SPINE_MODULE.search(str(module_name or '')))


def _canvas_module_teaching_snippet(module_name: str, label: str) -> str:
    module_name = str(module_name or '').strip() or 'Course material'
    label = str(label or '').strip()
    lecture_match = LECTURE_FILE.search(label)
    if lecture_match:
        topic = re.sub(r'^Lecture\s*\d+[_\s\-]*', '', label, flags=re.I)
        topic = re.sub(r'[_\.]+', ' ', topic)
        topic = re.sub(r'\s*(slides|pdf)\s*$', '', topic, flags=re.I).strip()
        if topic:
            return (
                f"In {module_name}, study Lecture {lecture_match.group(1)}: {topic}. "
                f"Connect this material to the surrounding module topics."
            )
    if re.search(r'-\s*L\d+\s*-', label, re.I):
        return (
            f"In {module_name}, review “{label}” and practice with the matching "
            f"textbook lesson and weekly assignments."
        )
    return (
        f"Canvas module “{module_name}”. "
        f"Review “{label}” and connect it to the rest of the module."
    )


def build_canvas_module_file_lessons(
    course_id: str,
    canvas_data: dict | None = None,
    max_lessons: int = 0,
    *,
    include_supplemental: bool = False,
) -> list[dict]:
    """Build lessons from Canvas module PDFs when the parser graph is sparse."""
    from canvas_parser.content.holistic_canvas import collect_canvas_module_file_rows
    from canvas_parser.synapse_teaching_sections import build_canvas_module_order_index, lesson_canvas_sort_key

    course_id = str(course_id or '').strip()
    canvas_data = canvas_data if canvas_data is not None else load_canvas_data()
    rows = collect_canvas_module_file_rows(course_id, canvas_data)
    if not rows:
        return []

    sort_index = build_canvas_module_order_index(course_id, canvas_data)
    lessons: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        module_name = str(row.get('moduleName') or '').strip() or 'Course material'
        if _canvas_module_is_supplemental(module_name) and not include_supplemental:
            continue
        filename = str(row.get('title') or '').strip()
        if not filename:
            continue
        label = re.sub(r'\.(pdf|html?|docx?|pptx?)$', '', filename, flags=re.I).strip() or filename
        key = (module_name, label.casefold())
        if key in seen:
            continue
        seen.add(key)
        lecture_match = LECTURE_FILE.search(label)
        snippet = _canvas_module_teaching_snippet(module_name, label)
        candidate = {
            'id': f"{course_id}:canvas-module:{module_name}:{label}",
            'courseId': course_id,
            'type': 'section',
            'name': label,
            'snippet': _snippet_from_text(snippet, label),
            'teachingContext': _snippet_from_text(snippet, label, TEACHING_CONTEXT_LIMIT),
            'fileId': str(row.get('contentId') or ''),
            'filename': filename,
            'pageNumber': None,
            'pageid': '',
            'sequenceIndex': len(lessons),
            'y0': None,
            'yRatio0': None,
            'moduleName': module_name,
            'source': 'canvas_module',
            'lectureNumber': int(lecture_match.group(1)) if lecture_match else None,
        }
        if _lesson_is_low_quality(candidate):
            continue
        lessons.append(candidate)
        if max_lessons and len(lessons) >= max_lessons:
            break

    indexed = list(enumerate(lessons))
    indexed.sort(key=lambda pair: (lesson_canvas_sort_key(pair[1], sort_index), pair[0]))
    lessons = [lesson for _, lesson in indexed]
    for index, lesson in enumerate(lessons):
        lesson['sequenceIndex'] = index
    return lessons


def build_module_fallback_lessons(graph: dict, course_id: str, max_lessons: int = 0) -> list[dict]:
    """Build coarse lessons from module/file layout when concepts and blocks are absent."""
    course_id = str(course_id or '').strip()
    hints = (graph.get('moduleOrderHints') or {}).get(course_id) or {}
    if not isinstance(hints, dict) or not hints:
        return []

    course_files = (graph.get('files') or {}).get(course_id) or {}
    title_map = {}
    try:
        from canvas_parser.content.holistic_canvas import module_file_title_map

        title_map = module_file_title_map(course_id)
    except Exception:
        title_map = {}

    ordered = sorted(
        (hint for hint in hints.values() if isinstance(hint, dict)),
        key=_module_sort_key,
    )

    lessons: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for hint in ordered:
        item_type = str(hint.get('itemType') or '').lower()
        if item_type not in {'file', 'page'}:
            continue
        content_id = str(hint.get('contentId') or '').strip()
        module_name = str(hint.get('moduleName') or '').strip() or 'Course material'
        file_node = course_files.get(content_id) if content_id else None
        filename = str((file_node or {}).get('name') or '').strip()
        if not filename and content_id:
            filename = str(title_map.get(content_id) or '').strip()
        if filename:
            label = re.sub(r'\.(pdf|html?|docx?)$', '', filename, flags=re.I).strip()
        else:
            position = int(hint.get('position') or 0)
            label = module_name if position <= 1 else f"{module_name} ({position})"
        if not label:
            continue
        key = (module_name, label.casefold())
        if key in seen:
            continue
        seen.add(key)
        snippet = (
            f"Canvas module “{module_name}”. "
            f"Review “{label}” and connect it to the rest of the module."
        )
        lessons.append({
            'id': f"{course_id}:module:{module_name}:{label}",
            'courseId': course_id,
            'type': 'section',
            'name': label,
            'snippet': _snippet_from_text(snippet, label),
            'teachingContext': _snippet_from_text(snippet, label, TEACHING_CONTEXT_LIMIT),
            'fileId': content_id,
            'filename': filename,
            'pageNumber': None,
            'pageid': '',
            'sequenceIndex': len(lessons),
            'y0': None,
            'yRatio0': None,
            'moduleName': module_name,
            'source': 'graph_module',
        })

    if max_lessons and len(lessons) > max_lessons:
        lessons = lessons[:max_lessons]
    return lessons


def build_syllabus_fallback_lessons(graph: dict, course_id: str, max_lessons: int = 0) -> list[dict]:
    """Build lessons from syllabus prose and assignment descriptions when concepts are absent."""
    course_id = str(course_id or '').strip()
    syllabus = (graph.get('syllabi') or {}).get(course_id) or {}
    if not isinstance(syllabus, dict):
        return []

    lessons: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def append_lesson(name: str, snippet: str, lesson_type: str = 'concept') -> None:
        name = str(name or '').strip()
        if not name:
            return
        key = (lesson_type, name.casefold())
        if key in seen:
            return
        seen.add(key)
        body = _snippet_from_text(snippet, name, TEACHING_CONTEXT_LIMIT)
        lessons.append({
            'id': f"{course_id}:syllabus:{lesson_type}:{name}",
            'courseId': course_id,
            'type': lesson_type,
            'name': name,
            'snippet': _snippet_from_text(snippet, name),
            'teachingContext': body,
            'fileId': '',
            'filename': 'Syllabus',
            'pageNumber': None,
            'pageid': '',
            'sequenceIndex': len(lessons),
            'y0': None,
            'yRatio0': None,
            'moduleName': 'Syllabus',
            'source': 'graph_syllabus',
        })

    overview = str(syllabus.get('other') or '').strip()
    if len(overview) > 60:
        append_lesson('Course overview', overview)

    for assignment in syllabus.get('assignments') or []:
        if not isinstance(assignment, dict):
            continue
        name = str(assignment.get('name') or '').strip()
        if not name:
            continue
        description = str(assignment.get('description') or '').strip()
        append_lesson(name, description or name, lesson_type='section')

    if max_lessons and len(lessons) > max_lessons:
        lessons = lessons[:max_lessons]
    return lessons


def cap_curriculum_lessons(lessons: list[dict], max_lessons: int) -> list[dict]:
    if not max_lessons or len(lessons) <= max_lessons:
        return lessons

    interactive_cap = max(12, max_lessons // 4)
    picked: list[tuple[int, dict]] = []
    picked_indices: set[int] = set()

    for index, lesson in enumerate(lessons):
        if str(lesson.get('type') or '') not in {'problem', 'example'}:
            continue
        if len(picked) >= interactive_cap:
            break
        picked.append((index, lesson))
        picked_indices.add(index)

    groups: dict[str, list[tuple[int, dict]]] = {}
    group_order: list[str] = []
    for index, lesson in enumerate(lessons):
        if index in picked_indices:
            continue
        key = _lesson_group_key(lesson)
        if key not in groups:
            groups[key] = []
            group_order.append(key)
        groups[key].append((index, lesson))

    round_index = 0
    while len(picked) < max_lessons and group_order:
        advanced = False
        for key in group_order:
            bucket = groups.get(key) or []
            if round_index >= len(bucket):
                continue
            index, lesson = bucket[round_index]
            if index in picked_indices:
                continue
            picked.append((index, lesson))
            picked_indices.add(index)
            advanced = True
            if len(picked) >= max_lessons:
                break
        if not advanced:
            break
        round_index += 1

    if len(picked) < max_lessons:
        indexed = [
            (index, lesson)
            for index, lesson in enumerate(lessons)
            if index not in picked_indices
        ]
        indexed.sort(
            key=lambda pair: (
                LESSON_TYPE_PRIORITY.get(str(pair[1].get('type') or ''), 9),
                pair[0],
            ),
        )
        for index, lesson in indexed:
            if len(picked) >= max_lessons:
                break
            picked.append((index, lesson))
            picked_indices.add(index)

    picked.sort(key=lambda pair: pair[0])
    return [lesson for _, lesson in picked]


def concept_document_order_coverage(concepts: list[dict]) -> float:
    if not concepts:
        return 0.0
    anchored = 0
    for concept in concepts:
        document_order = concept.get('documentOrder')
        if not isinstance(document_order, dict):
            continue
        if document_order.get('fileId') or document_order.get('pageNumber') or document_order.get('sequenceIndex'):
            anchored += 1
    return anchored / len(concepts)


def should_prefer_concept_curriculum(
    block_lesson_count: int,
    concept_count: int,
    concept_lesson_count: int = 0,
    document_order_coverage: float = 0.0,
) -> bool:
    if concept_count < MIN_CONCEPTS_FOR_BLOCK_OVERRIDE:
        return False
    if concept_lesson_count < 10:
        return False
    if (
        block_lesson_count < 50
        and concept_count > 200
        and document_order_coverage < MIN_DOCUMENT_ORDER_COVERAGE
    ):
        return False
    if block_lesson_count >= BLOCK_NOISE_THRESHOLD:
        return True
    if document_order_coverage >= MIN_DOCUMENT_ORDER_COVERAGE and concept_lesson_count >= 20:
        return True
    if concept_lesson_count > block_lesson_count:
        return True
    return False


def build_graph_problems_for_course(graph: dict, course_id: str) -> list[dict]:
    rows = []
    for problem in graph.get('problems') or []:
        if not isinstance(problem, dict):
            continue
        if str(problem.get('courseid') or '').strip() == str(course_id).strip():
            rows.append(problem)
    return rows


def _lookup_concept_context(name: str, concept_context: dict[str, str]) -> str:
    label = str(name or '').strip()
    if not label or not concept_context:
        return ''
    direct = concept_context.get(label.casefold())
    if direct:
        return direct
    for concept_name, body in concept_context.items():
        if teaching_labels_match(label, concept_name):
            return body
    return ''


def _build_concept_context_index(graph: dict, course_id: str) -> dict[str, str]:
    index: dict[str, str] = {}
    for concept in course_concepts_for_id(graph, course_id):
        name = str(concept.get('name') or '').strip()
        body = _concept_body_text(concept)
        if name and body and len(body) >= THIN_CONTEXT_THRESHOLD:
            index[name.casefold()] = body
    return index


def _match_graph_problem(lesson: dict, graph_problems: list[dict]) -> dict | None:
    lesson_name = str(lesson.get('name') or '')
    lesson_snippet = str(lesson.get('snippet') or '')
    for problem in graph_problems:
        problem_name = str(problem.get('name') or '')
        if not problem_name:
            continue
        if teaching_labels_match(lesson_name, problem_name):
            return problem
        if teaching_labels_match(lesson_snippet, problem_name):
            return problem
    return None


def _problem_is_solvable(lesson: dict) -> bool:
    """True when a `problem`-typed lesson reads like an exercise to solve.

    Checks the title and statement/context for an explicit solve verb or question.
    Used to keep genuine problems as a "solve this" interaction while letting
    parser-misclassified list items fall back to plain reading.
    """
    text = ' '.join(
        str(lesson.get(key) or '')
        for key in ('name', 'problemStatement', 'teachingContext', 'snippet')
    )
    return bool(PROBLEM_SOLVE_SIGNAL.search(text))


def enrich_lesson_metadata(
    lesson: dict,
    graph_problems: list[dict],
    concept_context: dict[str, str] | None = None,
) -> dict:
    source = str(lesson.get('source') or '')
    snippet = str(lesson.get('snippet') or '').strip()
    name = str(lesson.get('name') or '').strip()
    context = str(lesson.get('teachingContext') or '').strip()
    if not context or len(context) < THIN_CONTEXT_THRESHOLD:
        rich = str(lesson.get('contextText') or '').strip()
        if not rich:
            rich = snippet if len(snippet) > len(name) else ''
        if source.startswith('graph_') and len(snippet) >= SNIPPET_LIMIT:
            rich = snippet
        elif rich and rich.casefold() != name.casefold():
            lesson['teachingContext'] = _snippet_from_text(rich, name, TEACHING_CONTEXT_LIMIT)
            context = lesson['teachingContext']
        elif snippet and snippet.casefold() != name.casefold():
            lesson['teachingContext'] = _snippet_from_text(snippet, name, TEACHING_CONTEXT_LIMIT)
            context = lesson['teachingContext']
    if (not context or len(context) < THIN_CONTEXT_THRESHOLD) and concept_context:
        matched_body = _lookup_concept_context(name, concept_context)
        if matched_body:
            lesson['teachingContext'] = _snippet_from_text(matched_body, name, TEACHING_CONTEXT_LIMIT)
            context = lesson['teachingContext']
    if (not context or len(context) < THIN_CONTEXT_THRESHOLD) and source == 'canvas_subheader':
        from canvas_parser.synapse_teaching_sections import subheader_teaching_snippet

        rich = subheader_teaching_snippet(name, str(lesson.get('moduleName') or ''))
        lesson['teachingContext'] = _snippet_from_text(rich, name, TEACHING_CONTEXT_LIMIT)
        if not snippet or len(snippet) < THIN_CONTEXT_THRESHOLD:
            lesson['snippet'] = _snippet_from_text(rich, name)
        context = lesson['teachingContext']
    lesson_type = str(lesson.get('type') or '')
    if lesson_type == 'problem':
        matched = _match_graph_problem(lesson, graph_problems)
        step_text = ''
        if matched:
            steps = matched.get('steps') if isinstance(matched.get('steps'), list) else []
            step_text = ' '.join(str(step).strip() for step in steps if str(step).strip())
            answer = str(matched.get('answer') or '').strip()
            if answer and answer.lower() not in {'none', 'see file for answer.'}:
                lesson['hasAnswerKey'] = True
                lesson['answerKey'] = answer
            if steps:
                lesson['problemSteps'] = [
                    str(step).strip() for step in steps if str(step).strip()
                ][:6]
        statement = step_text or snippet or name
        lesson['problemStatement'] = _snippet_from_text(statement, name, TEACHING_CONTEXT_LIMIT)
        if (not context or len(context) < THIN_CONTEXT_THRESHOLD) and step_text:
            lesson['teachingContext'] = _snippet_from_text(step_text, name, TEACHING_CONTEXT_LIMIT)
        # Only treat as a solve-this prompt when it is actually solvable; otherwise a
        # parser-misclassified list item (grammar note, syllabus row) reads as content.
        if lesson.get('hasAnswerKey') or lesson.get('problemSteps') or _problem_is_solvable(lesson):
            lesson['interaction'] = 'answer'
        else:
            lesson['interaction'] = 'read'
        return lesson
    if lesson_type == 'example':
        lesson['interaction'] = 'example'
        return lesson
    lesson['interaction'] = 'read'
    return lesson


def _curriculum_type_counts(lessons: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for lesson in lessons:
        lesson_type = str(lesson.get('type') or 'unknown')
        counts[lesson_type] = counts.get(lesson_type, 0) + 1
    return counts


def curriculum_quality_metrics(lessons: list[dict]) -> dict:
    if not lessons:
        return {
            'lessonCount': 0,
            'duplicateNames': 0,
            'avgContextChars': 0,
            'medianContextChars': 0,
            'thinContextCount': 0,
            'problemCount': 0,
            'exampleCount': 0,
            'conceptCount': 0,
        }

    names = [str(row.get('name') or '').casefold() for row in lessons if row.get('name')]
    unique_names = set(names)
    contexts: list[int] = []
    thin = 0
    for row in lessons:
        context = str(row.get('teachingContext') or row.get('snippet') or '')
        length = len(context)
        contexts.append(length)
        if length < THIN_CONTEXT_THRESHOLD:
            thin += 1

    type_counts = _curriculum_type_counts(lessons)
    sorted_contexts = sorted(contexts)
    mid = len(sorted_contexts) // 2
    median = sorted_contexts[mid] if sorted_contexts else 0
    return {
        'lessonCount': len(lessons),
        'duplicateNames': len(names) - len(unique_names),
        'avgContextChars': round(sum(contexts) / len(contexts)) if contexts else 0,
        'medianContextChars': median,
        'thinContextCount': thin,
        'problemCount': type_counts.get('problem', 0),
        'exampleCount': type_counts.get('example', 0),
        'conceptCount': type_counts.get('concept', 0),
    }


def resort_curriculum_lessons(
    lessons: list[dict],
    course_id: str,
    canvas_data: dict | None = None,
) -> None:
    """Reorder merged lessons to follow Canvas module teaching flow."""
    if not lessons:
        return
    canvas_data = canvas_data if canvas_data is not None else load_canvas_data()
    sort_index = build_canvas_module_order_index(course_id, canvas_data)
    if not sort_index.get('modules') and not sort_index.get('items'):
        return
    indexed = list(enumerate(lessons))
    indexed.sort(key=lambda pair: (lesson_canvas_sort_key(pair[1], sort_index), pair[0]))
    reordered = [lesson for _, lesson in indexed]
    lessons[:] = reordered
    for index, lesson in enumerate(lessons):
        lesson['sequenceIndex'] = index


def _holistic_lesson_is_noise(lesson: dict) -> bool:
    name = str(lesson.get('name') or '').strip()
    if re.fullmatch(r'videos?', name, re.I):
        return True
    if HOLISTIC_NOISE.search(name):
        return True
    return False


def _merge_unique_lessons(
    primary: list[dict],
    extra: list[dict],
    *,
    filter_holistic_noise: bool = False,
) -> list[dict]:
    seen = {str(row.get('name') or '').casefold() for row in primary if row.get('name')}
    merged = list(primary)
    for lesson in extra:
        if filter_holistic_noise and _holistic_lesson_is_noise(lesson):
            continue
        name_key = str(lesson.get('name') or '').casefold()
        if not name_key or name_key in seen:
            continue
        seen.add(name_key)
        merged.append(lesson)
    return merged


# Cross-track dedupe applies to substantive concept/example/problem headings.
# Generic short labels ("Step 1", "Problem 1") repeat legitimately across files in
# one section, so they are excluded by the minimum-length guard (they run shorter
# than this threshold and so are never merged). The `problem` type is included so a
# discussion question duplicated across a lecture's notes and slides collapses too.
_DEDUPE_SECTION_TYPES = {'concept', 'example', 'problem'}
_DEDUPE_MIN_NAME_LEN = 12


def _dedupe_within_section(lessons: list[dict]) -> list[dict]:
    """Collapse identical concept/example headings inside one sectionGroup.

    Parallel Lecture Notes/Slides PDFs repeat the same heading (e.g. a lecture's
    "We then define the GDP Deflator as" appears in both files). Keeping both adds
    no teaching value, so within a single section the duplicate is dropped and the
    richer teaching context is preserved on the surviving lesson. Problems, sections
    and short generic labels are never merged because identical names there denote
    distinct items from different source files.
    """
    kept_index: dict[tuple[str, str, str], int] = {}
    result: list[dict] = []
    for lesson in lessons:
        name = str(lesson.get('name') or '').strip()
        ltype = str(lesson.get('type') or '')
        if ltype in _DEDUPE_SECTION_TYPES and len(name) >= _DEDUPE_MIN_NAME_LEN:
            key = (str(lesson.get('sectionGroup') or ''), ltype, name.casefold())
            existing = kept_index.get(key)
            if existing is not None:
                survivor = result[existing]
                new_ctx = str(lesson.get('teachingContext') or '')
                if len(new_ctx) > len(str(survivor.get('teachingContext') or '')):
                    survivor['teachingContext'] = lesson.get('teachingContext')
                    survivor['snippet'] = lesson.get('snippet')
                continue
            kept_index[key] = len(result)
        result.append(lesson)
    return result


# Placeholder titles the parser emits for numbered list items (the real text lives
# in teachingContext). A bare "Problem 10" is meaningless in the curriculum UI.
_GENERIC_LESSON_NAME = re.compile(
    r'^(?:problem|exercise|question|step|item|part|task|no\.?|q)\s*\.?\s*\d+$',
    re.I,
)
# Leading list enumerator inside extracted context: "10.", "3)", "(2)", "1：".
_LEADING_ENUMERATOR = re.compile(r'^\s*[(\[]?\d+\s*[.):\]、．，：]\s*')


def _humanize_generic_lesson_name(lesson: dict) -> None:
    """Derive a content title for numbered-list lessons named "Problem N" etc.

    Only fires on generic placeholder names; a real title (concept sentence, named
    section) is left untouched. The original parser label is kept in `parserLabel`
    for traceability. This is presentation-only: type, interaction and ids are
    unchanged — it does not reclassify anything (parser stays the source of truth).
    """
    name = str(lesson.get('name') or '').strip()
    if not (_GENERIC_LESSON_NAME.match(name) or name.isdigit()):
        return
    context = str(lesson.get('teachingContext') or lesson.get('snippet') or '').strip()
    if not context:
        return
    cleaned = _LEADING_ENUMERATOR.sub('', context).strip()
    cleaned = re.split(r'[\r\n]+', cleaned, maxsplit=1)[0].strip()
    if len(cleaned) > 80:
        cleaned = cleaned[:80].rstrip() + '…'
    if len(cleaned) < 6 or cleaned.casefold() == name.casefold():
        return
    lesson['parserLabel'] = name
    lesson['name'] = cleaned


# Leading list enumerator on an otherwise-real title: "1: A proportional tax …",
# "20 : Section 1", "3 , Chapter 18 …". Years are protected (1–3 digits only) and a
# trailing space + ≥6-char remainder is required, so real titles are not truncated.
_LEADING_ENUM_DISPLAY = re.compile(r'^\s*\(?\d{1,3}\)?\s*[,:;.)\-–]\s+')


def _strip_leading_enumerator(lesson: dict) -> None:
    """Remove a bare leading list number from a display title (presentation-only)."""
    name = str(lesson.get('name') or '').strip()
    match = _LEADING_ENUM_DISPLAY.match(name)
    if not match:
        return
    stripped = name[match.end():].strip()
    if len(stripped) < 6 or stripped.casefold() == name.casefold():
        return
    lesson.setdefault('parserLabel', name)
    lesson['name'] = stripped


def build_curriculum(
    graph,
    course_id,
    max_lessons=0,
    include_concept_fallback=True,
    hydrate_local=True,
):
    course_id = str(course_id or '').strip()
    hydration_stats = None
    if hydrate_local:
        graph, hydration_stats = enrich_graph_content(graph, course_id)
    course_files = (graph.get('files') or {}).get(course_id) or {}
    if not isinstance(course_files, dict):
        course_files = {}

    rank_map = build_file_rank_map(course_id, graph)
    module_map = build_file_module_map(course_id, graph)
    ordered_files = sorted(
        course_files.items(),
        key=lambda item: file_sort_key(
            course_id,
            str(item[0]),
            item[1] if isinstance(item[1], dict) else {},
            graph,
            rank_map,
        ),
    )

    ordered_lessons: list[dict] = []
    for file_id, file_node in ordered_files:
        if not isinstance(file_node, dict):
            continue
        pages = file_node.get('pages') if isinstance(file_node.get('pages'), list) else []
        if not pages:
            continue
        filename = str(file_node.get('name') or file_id)
        units = extract_teaching_units_from_pages(pages)
        file_sort = file_sort_key(course_id, str(file_id), file_node, graph, rank_map)
        module_name = module_map.get(str(file_id), '')
        file_lessons: list[dict] = []
        for sequence_index, unit in enumerate(units):
            name = str(unit.get('name') or '').strip()
            if not name:
                continue
            context_text = str(unit.get('contextText') or unit.get('snippet') or name)
            lesson = {
                'id': f"{course_id}:{file_id}:{unit.get('type', 'unit')}:{name}",
                'courseId': course_id,
                'type': str(unit.get('type') or 'section'),
                'name': name,
                'snippet': _snippet_from_text(context_text, name),
                'contextText': context_text,
                'teachingContext': _snippet_from_text(context_text, name, TEACHING_CONTEXT_LIMIT),
                'fileId': str(file_id),
                'filename': filename,
                'pageNumber': unit.get('pageNumber'),
                'pageid': str(unit.get('pageid') or ''),
                'sequenceIndex': sequence_index,
                'y0': unit.get('y0'),
                'yRatio0': unit.get('yRatio0'),
                'moduleName': module_name,
                'fileSortKey': list(file_sort),
                'source': 'page_blocks',
            }
            if _lesson_is_low_quality(lesson):
                continue
            file_lessons.append(lesson)
        file_lessons.sort(key=_lesson_local_sort_key)
        ordered_lessons.extend(file_lessons)

    learning_block_lessons = build_learning_block_lessons(graph, course_id)
    if learning_block_lessons:
        if ordered_lessons:
            block_lessons = _merge_block_interactives(learning_block_lessons, ordered_lessons)
        else:
            block_lessons = learning_block_lessons
    else:
        block_lessons = ordered_lessons
    concept_count = len(course_concepts_for_id(graph, course_id))
    course_concepts = course_concepts_for_id(graph, course_id)
    doc_coverage = concept_document_order_coverage(course_concepts)
    concept_lessons = (
        build_concept_fallback_lessons(graph, course_id, module_map=module_map)
        if include_concept_fallback else []
    )
    syllabus_lessons = (
        build_syllabus_fallback_lessons(graph, course_id)
        if include_concept_fallback else []
    )
    canvas_data = load_canvas_data()
    canvas_module_lessons = (
        build_canvas_module_file_lessons(course_id, canvas_data)
        if include_concept_fallback else []
    )
    has_lecture_spine = any(
        _canvas_module_is_spine(str(row.get('moduleName') or ''))
        for row in canvas_module_lessons
    )

    if should_prefer_concept_curriculum(
        len(block_lessons),
        concept_count,
        len(concept_lessons),
        doc_coverage,
    ) and concept_lessons:
        lessons = _merge_block_interactives(concept_lessons, block_lessons)
    elif block_lessons:
        lessons = block_lessons
    elif concept_lessons:
        lessons = concept_lessons
    elif has_lecture_spine and canvas_module_lessons:
        lessons = canvas_module_lessons
    elif syllabus_lessons and not _syllabus_lessons_are_logistics_only(syllabus_lessons):
        lessons = syllabus_lessons
    elif canvas_module_lessons:
        lessons = canvas_module_lessons
    elif syllabus_lessons:
        lessons = syllabus_lessons
    else:
        lessons = build_module_fallback_lessons(graph, course_id) if include_concept_fallback else []

    holistic_lessons = (
        build_holistic_link_lessons(course_id, graph=graph)
        if include_concept_fallback else []
    )
    if holistic_lessons:
        lessons = _merge_unique_lessons(lessons, holistic_lessons, filter_holistic_noise=True)

    course_files = (graph.get('files') or {}).get(course_id) or {}
    page_unit_lessons = (
        build_page_teaching_lessons(course_id, course_files)
        if include_concept_fallback else []
    )
    if page_unit_lessons:
        lessons = _merge_unique_lessons(lessons, page_unit_lessons, filter_holistic_noise=True)

    if include_concept_fallback and len(lessons) < SPARSE_CURRICULUM_THRESHOLD:
        module_lessons = build_module_fallback_lessons(graph, course_id)
        supplemental_module_lessons = build_canvas_module_file_lessons(
            course_id,
            canvas_data,
            include_supplemental=True,
        )
        if module_lessons:
            lessons = _merge_unique_lessons(lessons, module_lessons)
        if supplemental_module_lessons:
            existing = {str(row.get('name') or '').casefold() for row in lessons}
            extras = [
                row for row in supplemental_module_lessons
                if str(row.get('name') or '').casefold() not in existing
            ]
            if extras:
                lessons = _merge_unique_lessons(lessons, extras)
        elif canvas_module_lessons:
            lessons = _merge_unique_lessons(lessons, canvas_module_lessons)

    resort_curriculum_lessons(lessons, course_id, canvas_data)
    assign_section_groups_from_canvas(
        lessons,
        course_id,
        canvas_data=canvas_data,
        graph=graph,
    )
    lessons = _dedupe_within_section(lessons)
    uncapped_count = len(lessons)
    effective_cap = resolve_lesson_cap(uncapped_count, max_lessons) if max_lessons else uncapped_count
    if max_lessons and uncapped_count > effective_cap:
        lessons = cap_curriculum_lessons(lessons, effective_cap)
    graph_problems = build_graph_problems_for_course(graph, course_id)
    concept_context = _build_concept_context_index(graph, course_id)
    for lesson in lessons:
        enrich_lesson_metadata(lesson, graph_problems, concept_context)
    attach_curriculum_grounding(lessons, graph, course_id)
    for lesson in lessons:
        _humanize_generic_lesson_name(lesson)
        _strip_leading_enumerator(lesson)
    # Second dedupe pass: relabeling above turns generic "Problem N" placeholders
    # into their real content titles, so cross-track duplicates that were too short
    # to merge earlier (e.g. a discussion question in both a lecture's notes and
    # slides) are only now visible as identical names.
    lessons = _dedupe_within_section(lessons)
    total = len(lessons)
    for index, lesson in enumerate(lessons):
        lesson['index'] = index
        lesson['total'] = total
        lesson['globalSequence'] = index
        lesson.pop('fileSortKey', None)

    return lessons


def _configure_stdout() -> None:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')


def main(argv=None) -> int:
    _configure_stdout()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['list-courses', 'curriculum'])
    parser.add_argument('--course-id', default='')
    parser.add_argument('--graph', default=str(DEFAULT_GRAPH))
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--teachable-only', action='store_true')
    parser.add_argument('--max-lessons', type=int, default=0)
    parser.add_argument('--no-hydrate', action='store_true')
    args = parser.parse_args(argv)

    graph = load_graph(args.graph, use_fixture=args.fixture)
    if args.command == 'list-courses':
        sys.stdout.write(json.dumps({
            'courses': list_courses(graph, teachable_only=args.teachable_only),
        }, ensure_ascii=False))
        return 0

    if not args.course_id:
        sys.stdout.write(json.dumps({'error': 'course-id is required', 'lessons': []}))
        return 1
    lessons = build_curriculum(
        graph,
        args.course_id,
        max_lessons=args.max_lessons,
        hydrate_local=not args.no_hydrate,
    )
    sys.stdout.write(json.dumps({
        'courseId': str(args.course_id),
        'lessons': lessons,
    }, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
