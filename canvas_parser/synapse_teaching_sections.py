"""Map Synapse Learn lessons to Canvas weekly schedule section groups."""
from __future__ import annotations

import re
from typing import Any

from canvas_parser.weekly.bridge import build_weekly_schedules
from canvas_parser.weekly_iteration.format import _normalize_pdf_display_name
from canvas_parser.weekly_iteration.match_utils import normalize_name, names_match

WEEK_MODULE = re.compile(r'week\s*(\d+)', re.I)
LECTURE_MODULE = re.compile(r'lecture', re.I)
SETUP_MODULE = re.compile(
    r'syllabus|schedule|course resource|introduction|pinyin|course resources|semester',
    re.I,
)
SUPPLEMENT_MODULE = re.compile(
    r'audio material|course slides|letter sample|individual session|'
    r'past exam|assignment solution|outside sources',
    re.I,
)
EXAM_MODULE = re.compile(r'exam|assignments?(?: \(|$)|videos?$', re.I)
READER_LESSON = re.compile(r'-\s*L(\d+)\s*-|\bL(\d+)\b', re.I)
LECTURE_NUMBER = re.compile(r'lec(?:ture)?\s*[_#.]?\s*(\d+)', re.I)
LECTURE_NOTES_MODULE = re.compile(r'lecture notes?', re.I)
LECTURE_SLIDES_MODULE = re.compile(r'lecture slides?', re.I)

# Sequence numbers embedded in a source FILE name (not the lesson/concept label).
# Used to order files within a single Canvas module by teaching sequence.
FILE_SEQUENCE_PATTERNS = (
    re.compile(r'lecture[_#.\s]*(\d+)', re.I),
    re.compile(r'\bchapter\s*[_#.]?\s*(\d+)', re.I),
    re.compile(r'\bunit\s*[_#.]?\s*(\d+)', re.I),
    re.compile(r'\bweek\s*[_#.]?\s*(\d+)', re.I),
    re.compile(r'\bprecept\s*[_#.]?\s*(\d+)', re.I),
    re.compile(r'\b(?:pset|problem\s*set|ps|hw|homework)\s*[_#.]?\s*(\d+)', re.I),
    re.compile(r'\blesson\s*[_#.]?\s*(\d+)', re.I),
    re.compile(r'\bl(\d+)\b', re.I),
)


def normalize_week_module_label(module_name: str) -> str:
    """Normalize Week2 / Week 2 to a canonical Week N label."""
    match = WEEK_MODULE.search(str(module_name or ''))
    if match:
        return f"Week {int(match.group(1))}"
    return str(module_name or '').strip()


def _module_flow_tier(module_name: str, canvas_position: int) -> tuple:
    name = str(module_name or '').strip()
    week_match = WEEK_MODULE.search(name)
    if week_match:
        return (1, int(week_match.group(1)), canvas_position, name.casefold())
    if SETUP_MODULE.search(name):
        return (0, canvas_position, 0, name.casefold())
    if LECTURE_MODULE.search(name):
        return (2, canvas_position, 0, name.casefold())
    if SUPPLEMENT_MODULE.search(name):
        return (3, canvas_position, 0, name.casefold())
    if EXAM_MODULE.search(name):
        return (4, canvas_position, 0, name.casefold())
    return (2, canvas_position, 0, name.casefold())


def _canvas_data_bucket(canvas_data: dict[str, Any], bucket_name: str, course_id: str):
    bucket = canvas_data.get(bucket_name) or {}
    if not isinstance(bucket, dict):
        return None
    rows = bucket.get(str(course_id))
    if rows is None and str(course_id).isdigit():
        rows = bucket.get(int(course_id))  # type: ignore[arg-type]
    return rows


def build_canvas_module_order_index(
    course_id: str,
    canvas_data: dict[str, Any],
) -> dict[str, Any]:
    """Map module/item names to teaching-flow sort keys from Canvas layout."""
    course_id = str(course_id or '').strip()
    index: dict[str, Any] = {'modules': {}, 'items': {}}
    if not course_id or not canvas_data:
        return index

    modules = _canvas_data_bucket(canvas_data, 'modules', course_id) or []
    module_names = {
        str(module.get('id') or ''): str(module.get('name') or '').strip()
        for module in modules
        if isinstance(module, dict)
    }
    for module in modules or []:
        if not isinstance(module, dict):
            continue
        module_name = str(module.get('name') or '').strip()
        if not module_name:
            continue
        tier = _module_flow_tier(module_name, int(module.get('position') or 0))
        key = _normalize_section_key(module_name)
        if key:
            index['modules'][key] = tier
        week_label = normalize_week_module_label(module_name)
        week_key = _normalize_section_key(week_label)
        if week_key and week_key not in index['modules']:
            index['modules'][week_key] = tier

    module_items = _canvas_data_bucket(canvas_data, 'module_items', course_id) or {}
    if isinstance(module_items, dict):
        for module_id, items in module_items.items():
            if not isinstance(items, list):
                continue
            module_name = module_names.get(str(module_id), '')
            module_tier = _module_flow_tier(module_name, 0)
            for item in items:
                if not isinstance(item, dict):
                    continue
                title = str(item.get('title') or item.get('name') or '').strip()
                if not title:
                    continue
                item_key = _normalize_section_key(title)
                if not item_key:
                    continue
                index['items'][item_key] = (
                    module_tier,
                    int(item.get('position') or 0),
                    title.casefold(),
                )
    return index


def _reader_lesson_sort_key(label: str) -> tuple:
    """Order Oh China / Trip to China audio and media by book, lesson, then part."""
    text = str(label or '')
    lowered = text.casefold()
    if 'trip to china' in lowered:
        book = 1
    elif 'oh' in lowered and 'china' in lowered:
        book = 0
    else:
        book = 2
    match = READER_LESSON.search(text)
    lesson_num = 9999
    if match:
        lesson_num = int(next(group for group in match.groups() if group))
    if 'vocabulary' in lowered:
        part = 0
    elif re.search(r'\btext\b', lowered):
        part = 1
    else:
        part = 2
    return (book, lesson_num, part, lowered)


def _lecture_number_from_label(label: str) -> int:
    for pattern in FILE_SEQUENCE_PATTERNS:
        match = pattern.search(str(label or ''))
        if match:
            return int(match.group(1))
    return 9999


def _lecture_track_rank(module_name: str) -> int:
    name = str(module_name or '')
    if LECTURE_NOTES_MODULE.search(name):
        return 0
    if LECTURE_SLIDES_MODULE.search(name):
        return 1
    return 9


def subheader_teaching_snippet(title: str, module_name: str = '') -> str:
    """Rich teaching context for Canvas module subheadings."""
    title = str(title or '').strip()
    module = str(module_name or '').strip()
    week_label = normalize_week_module_label(module)
    if WEEK_MODULE.search(week_label):
        return (
            f"In {week_label}, work through the “{title}” section: "
            f"review the linked files under this heading, then complete related "
            f"character exercises, quizzes, or readings for that week."
        )
    if SETUP_MODULE.search(module):
        return (
            f"Course setup in {module}: use the “{title}” section to find Pinyin charts, "
            f"character tools, textbook links, and orientation materials before Week 1."
        )
    if module:
        return (
            f"In {module}, follow the “{title}” section and work through "
            f"the files listed under this heading in order."
        )
    return f"Work through the module section “{title}” and its linked materials in order."


def _filename_sequence_rank(filename: str) -> tuple:
    """Rank a source file within its module by an embedded sequence number.

    Numbered files sort numerically (Lecture 2 before Lecture 10); unnumbered
    files fall after them, grouped by name. All teaching units extracted from one
    file share this rank so their page order is preserved within the file.
    """
    name = str(filename or '').strip()
    if not name:
        return (2, 0, '')
    for pattern in FILE_SEQUENCE_PATTERNS:
        match = pattern.search(name)
        if match:
            return (0, int(match.group(1)), name.casefold())
    return (1, 0, name.casefold())


def _page_number_value(value: Any) -> float:
    if value is None or value == '':
        return 0.0
    match = re.search(r'(\d+(?:\.\d+)?)', str(value))
    return float(match.group(1)) if match else 0.0


def _lesson_document_order(lesson: dict) -> tuple:
    """In-file teaching order: file rank → page → vertical position → sequence."""
    file_rank = _filename_sequence_rank(lesson.get('filename'))
    page = _page_number_value(lesson.get('pageNumber'))
    y_pos = lesson.get('yRatio0')
    if y_pos is None:
        y_pos = lesson.get('y0')
    try:
        y_value = float(y_pos)
    except (TypeError, ValueError):
        y_value = 0.0
    seq = int(lesson.get('sequenceIndex') or lesson.get('globalSequence') or 0)
    return (file_rank, page, y_value, seq)


def lesson_canvas_sort_key(lesson: dict, sort_index: dict[str, Any]) -> tuple:
    """Sort key that follows Canvas module teaching flow (setup → weeks → supplements).

    Within a module, lessons follow document order — the source file's sequence
    number (lecture/chapter/lesson), then page, then vertical position — rather
    than alphabetical name. Many Canvas modules hold several files (e.g. one
    "Lecture Notes" module with 24 lecture PDFs); ordering those by the extracted
    concept/label name scrambles the teaching sequence across lectures.
    """
    modules = sort_index.get('modules') or {}
    items = sort_index.get('items') or {}
    module_name = str(lesson.get('moduleName') or lesson.get('sectionGroup') or '').strip()
    module_key = _normalize_section_key(module_name)
    module_tier = modules.get(module_key, (5, 999, 999, module_key or ''))

    name = str(lesson.get('name') or '').strip()
    name_key = _normalize_section_key(name)
    item_tier = items.get(name_key)
    if item_tier is None and name_key:
        for item_key, tier in items.items():
            if names_match(name_key, item_key):
                item_tier = tier
                break
    try:
        item_position = int(item_tier[1]) if item_tier else 10 ** 6
    except (TypeError, ValueError, IndexError):
        item_position = 10 ** 6

    type_priority = {'section': 0, 'example': 1, 'problem': 2, 'concept': 3}.get(
        str(lesson.get('type') or ''),
        9,
    )
    seq = int(lesson.get('sequenceIndex') or lesson.get('globalSequence') or 0)

    reader_key = _reader_lesson_sort_key(name)
    lecture_num = _lecture_number_from_label(name)
    if lecture_num >= 9999:
        lecture_num = _lecture_number_from_label(str(lesson.get('filename') or ''))
    track = _lecture_track_rank(module_name)
    if reader_key[0] < 2:
        # Audio/media readers carry the lesson number in their label (L1, L2…).
        content_key: tuple = (0, reader_key)
        sort_module_tier = module_tier
    elif lecture_num < 9999 and track < 9:
        # Parallel "Lecture Notes"/"Lecture Slides" tracks: fold onto one spine so
        # each lecture's notes then slides appear together, ordered by lecture
        # number, then by page within each file.
        sort_module_tier = (module_tier[0], 0, 0, 'lecture spine')
        content_key = (0, lecture_num, track, _lesson_document_order(lesson), item_position)
    else:
        # Page-block and concept lessons: order by the source file's sequence
        # number and page position so each file plays out front-to-back instead
        # of alphabetically by the extracted concept label.
        sort_module_tier = module_tier
        content_key = (1, _lesson_document_order(lesson), item_position)
    return (
        sort_module_tier,
        content_key,
        type_priority,
        seq,
        name.casefold(),
    )


def _normalize_section_key(name: str) -> str:
    text = _normalize_pdf_display_name(str(name or '').strip())
    text = re.sub(r'\.[^.]+$', '', text)
    return normalize_name(text)


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


def _index_entry(label: str, order: int) -> dict[str, Any]:
    return {'label': label, 'order': order}


def _add_index_key(index: dict[str, Any], raw_name: str, label: str, order: int) -> None:
    key = _normalize_section_key(raw_name)
    if not key:
        return
    entry = _index_entry(label, order)
    by_name = index.setdefault('by_name', {})
    existing = by_name.get(key)
    if existing is None or order < existing.get('order', 9999):
        by_name[key] = entry


def _module_week_label(module_name: str, week_order: list[str]) -> tuple[str, int] | None:
    week_match = WEEK_MODULE.search(str(module_name or ''))
    if not week_match:
        return None
    week_num = int(week_match.group(1))
    label = f"Week {week_num}"
    if label in week_order:
        return label, week_order.index(label) + 1
    return label, week_num


def build_weekly_section_index(
    course_id: str,
    canvas_data: dict[str, Any],
    graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build lookup from normalized item names to weekly section labels."""
    course_id = str(course_id or '').strip()
    index: dict[str, Any] = {
        'by_name': {},
        'week_order': [],
        'module_to_week': {},
    }
    if not course_id or not canvas_data:
        return index

    schedules = build_weekly_schedules(canvas_data, graph=graph, use_graph=False)
    weeks = schedules.get(course_id) or schedules.get(str(course_id)) or []
    if not weeks:
        _index_modules_only(course_id, canvas_data, index)
        return index

    week_order: list[str] = []
    for week_idx, week in enumerate(weeks, start=1):
        if not isinstance(week, dict):
            continue
        label = str(week.get('name') or f'Week {week_idx}').strip() or f'Week {week_idx}'
        if label not in week_order:
            week_order.append(label)
        order = week_idx

        for file_row in week.get('files') or []:
            if isinstance(file_row, dict):
                _add_index_key(index, file_row.get('name') or '', label, order)

        for bucket_key in ('assignments', 'events'):
            for row in week.get(bucket_key) or []:
                if not isinstance(row, dict):
                    continue
                _add_index_key(index, row.get('name') or '', label, order)
                for nested in row.get('files') or []:
                    if isinstance(nested, dict):
                        _add_index_key(index, nested.get('name') or '', label, order)

    index['week_order'] = week_order
    _index_modules_only(course_id, canvas_data, index)
    return index


def _index_modules_only(course_id: str, canvas_data: dict[str, Any], index: dict[str, Any]) -> None:
    modules_bucket = canvas_data.get('modules') or {}
    modules = modules_bucket.get(course_id) or modules_bucket.get(str(course_id)) or []
    week_order = index.get('week_order') or []
    module_to_week = index.setdefault('module_to_week', {})

    for module in modules or []:
        if not isinstance(module, dict):
            continue
        module_name = str(module.get('name') or '').strip()
        if not module_name:
            continue
        mapped = _module_week_label(module_name, week_order)
        if not mapped:
            continue
        label, order = mapped
        module_key = _normalize_section_key(module_name)
        if module_key:
            module_to_week[module_key] = _index_entry(label, order)
            _add_index_key(index, module_name, label, order)


def _lookup_index(index: dict[str, Any], raw_name: str) -> dict[str, Any] | None:
    key = _normalize_section_key(raw_name)
    if not key:
        return None
    by_name = index.get('by_name') or {}
    if key in by_name:
        return by_name[key]

    for indexed_key, entry in by_name.items():
        if names_match(key, indexed_key):
            return entry
    return None


def _weekly_match(lesson: dict, index: dict[str, Any]) -> dict[str, Any] | None:
    candidates = [
        lesson.get('filename'),
        lesson.get('name'),
        lesson.get('moduleName'),
    ]
    for candidate in candidates:
        match = _lookup_index(index, str(candidate or ''))
        if match:
            return match

    module_name = str(lesson.get('moduleName') or '')
    module_key = _normalize_section_key(module_name)
    module_to_week = index.get('module_to_week') or {}
    if module_key and module_key in module_to_week:
        return module_to_week[module_key]
    return None


def _weekly_label_is_canonical(label: str) -> bool:
    text = str(label or '').strip()
    if not text:
        return False
    if WEEK_MODULE.search(text):
        return True
    if SETUP_MODULE.search(text):
        return True
    if LECTURE_MODULE.search(text):
        return True
    if SUPPLEMENT_MODULE.search(text):
        return True
    if EXAM_MODULE.search(text):
        return True
    return False


def module_section_label(module_name: str) -> str:
    """Canonical section label from a Canvas module name."""
    name = str(module_name or '').strip()
    if not name:
        return 'Introduction'
    week_label = normalize_week_module_label(name)
    if WEEK_MODULE.search(week_label):
        return week_label
    return name


def _lecture_section_label(lesson: dict) -> str:
    """Group lessons from parallel Lecture Notes/Slides modules under "Lecture N".

    Keeps a lecture's notes and slides in one section instead of alternating
    between whatever weekly buckets each track maps to.
    """
    if _lecture_track_rank(lesson.get('moduleName')) >= 9:
        return ''
    number = _lecture_number_from_label(str(lesson.get('name') or ''))
    if number >= 9999:
        number = _lecture_number_from_label(str(lesson.get('filename') or ''))
    if number >= 9999:
        return ''
    return f'Lecture {number}'


def resolve_lesson_section_group(
    lesson: dict,
    index: dict[str, Any],
    fallback_section: str,
) -> str:
    """Resolve sectionGroup for one lesson; prefer weekly bucket over fallback."""
    lecture_label = _lecture_section_label(lesson)
    if lecture_label:
        return lecture_label

    module_name = str(lesson.get('moduleName') or '').strip()
    if str(lesson.get('source') or '') in {'canvas_module', 'canvas_subheader'} and module_name:
        return module_section_label(module_name)

    # Keep a coherent Canvas module (Week N, Course slides, Audio material, etc.)
    # intact: every file in the module stays under the module's section instead of
    # being scattered into weekly buckets by per-file filename matches. Without this
    # a "Course slides" repository thrashes Course slides -> Week 2 -> Course slides
    # as individual review PDFs happen to match a weekly schedule row.
    if module_name and _weekly_label_is_canonical(module_name):
        return module_section_label(module_name)

    match = _weekly_match(lesson, index)
    if match:
        label = str(match.get('label') or '').strip()
        if _weekly_label_is_canonical(label):
            return label or fallback_section
    return fallback_section


def _assign_section_groups_sequential(lessons: list[dict]) -> None:
    current_section = 'Introduction'
    current_file = ''
    for lesson in lessons:
        file_id = str(lesson.get('fileId') or '')
        if file_id != current_file:
            current_file = file_id
            module_name = str(lesson.get('moduleName') or '').strip()
            current_section = _lecture_section_label(lesson) or module_section_label(module_name)
        anchor = _section_anchor_name(lesson)
        if anchor:
            current_section = anchor
        lesson['sectionGroup'] = current_section


def assign_section_groups_from_canvas(
    lessons: list[dict],
    course_id: str,
    canvas_data: dict[str, Any] | None = None,
    graph: dict[str, Any] | None = None,
) -> None:
    """Assign sectionGroup from Canvas weekly buckets with module-based fallback."""
    if not lessons:
        return

    index: dict[str, Any] = {}
    has_weekly = False
    if canvas_data:
        index = build_weekly_section_index(course_id, canvas_data, graph=graph)
        has_weekly = bool(index.get('by_name'))

    if not has_weekly:
        _assign_section_groups_sequential(lessons)
        annotate_section_metadata(lessons)
        return

    current_section = 'Introduction'
    current_file = ''
    for lesson in lessons:
        file_id = str(lesson.get('fileId') or '')
        if file_id != current_file:
            current_file = file_id
            module_name = str(lesson.get('moduleName') or '').strip()
            current_section = module_section_label(module_name)

        anchor = _section_anchor_name(lesson)
        if anchor:
            current_section = anchor

        resolved = resolve_lesson_section_group(lesson, index, current_section)
        lesson['sectionGroup'] = resolved
        # Propagate the resolved section so later lessons in the same file (and
        # orphan files that only match a week through one lesson) inherit it,
        # instead of re-deriving a possibly different weekly bucket per lesson.
        current_section = resolved

    annotate_section_metadata(lessons)


def annotate_section_metadata(lessons: list[dict]) -> None:
    """Add sectionIndex, sectionLessonIndex, and sectionTotal for UI ordering."""
    section_order: list[str] = []
    seen: set[str] = set()
    section_counts: dict[str, int] = {}

    for lesson in lessons:
        section = str(lesson.get('sectionGroup') or 'Introduction').strip() or 'Introduction'
        if section not in seen:
            seen.add(section)
            section_order.append(section)
        section_counts[section] = section_counts.get(section, 0) + 1

    section_index_map = {name: idx for idx, name in enumerate(section_order)}
    section_progress: dict[str, int] = {}

    for lesson in lessons:
        section = str(lesson.get('sectionGroup') or 'Introduction').strip() or 'Introduction'
        lesson['sectionIndex'] = section_index_map.get(section, 0)
        lesson['sectionLessonIndex'] = section_progress.get(section, 0)
        section_progress[section] = section_progress.get(section, 0) + 1
        lesson['sectionTotal'] = section_counts.get(section, 0)
