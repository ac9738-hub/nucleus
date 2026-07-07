"""Tests for Synapse teaching curriculum builder."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests' / 'fixtures' / 'sample-graph.json'


def run_cli(*args: str) -> dict:
    cmd = [sys.executable, '-m', 'canvas_parser.synapse_teaching', *args, '--fixture']
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def test_list_teachable_courses_fixture():
    payload = run_cli('list-courses', '--teachable-only')
    courses = payload.get('courses') or []
    ids = {row['id'] for row in courses}
    assert 'demo' in ids


def test_curriculum_max_lessons_fixture():
    payload = run_cli('curriculum', '--course-id', 'demo', '--max-lessons', '2')
    lessons = payload.get('lessons') or []
    assert len(lessons) <= 2


def test_curriculum_fixture_demo():
    payload = run_cli('curriculum', '--course-id', 'demo')
    lessons = payload.get('lessons') or []
    assert payload.get('courseId') == 'demo'
    assert len(lessons) >= 2
    first = lessons[0]
    assert first.get('type') in {'concept', 'section', 'example', 'problem'}
    assert first.get('name')
    assert first.get('snippet')
    assert first.get('index') == 0
    assert first.get('total') == len(lessons)


def test_curriculum_orders_by_document_position():
    payload = run_cli('curriculum', '--course-id', 'demo')
    lessons = payload.get('lessons') or []
    names = [row.get('name') for row in lessons]
    if 'Course overview' in names and 'Grading policy' in names:
        assert names.index('Course overview') < names.index('Grading policy')
    if '2.3 Matrix Products' in names and 'Grading policy' in names:
        assert names.index('Grading policy') < names.index('2.3 Matrix Products')


def test_curriculum_includes_examples_and_problems_fixture():
    payload = run_cli('curriculum', '--course-id', 'demo')
    lessons = payload.get('lessons') or []
    types = {row.get('type') for row in lessons}
    assert 'example' in types
    assert 'problem' in types
    problem = next(row for row in lessons if row.get('type') == 'problem')
    example = next(row for row in lessons if row.get('type') == 'example')
    assert problem.get('interaction') == 'answer'
    assert example.get('interaction') == 'example'
    assert problem.get('problemStatement')


def test_curriculum_includes_section_group():
    payload = run_cli('curriculum', '--course-id', 'demo')
    lessons = payload.get('lessons') or []
    assert lessons
    assert lessons[0].get('sectionGroup')


def test_learning_block_lessons_preferred():
    from canvas_parser.synapse_teaching import build_curriculum, build_learning_block_lessons

    graph = {
        'files': {'demo': {}},
        'concepts': [
            {'courseid': 'demo', 'conceptid': 'c1', 'name': 'Alpha', 'description': 'First idea', 'details': []},
            {'courseid': 'demo', 'conceptid': 'c2', 'name': 'Beta', 'description': 'Second idea', 'details': []},
        ],
        'learningBlocks': {
            'demo': [
                {'blockId': 'demo-c1-block', 'courseid': 'demo', 'order': 1, 'conceptId': 'c1', 'explanation': 'First idea', 'detailRefs': []},
                {'blockId': 'demo-c2-block', 'courseid': 'demo', 'order': 2, 'conceptId': 'c2', 'explanation': 'Second idea', 'detailRefs': []},
            ],
        },
    }
    block_lessons = build_learning_block_lessons(graph, 'demo')
    assert len(block_lessons) == 2
    assert block_lessons[0]['source'] == 'learning_blocks'
    lessons = build_curriculum(graph, 'demo', include_concept_fallback=False)
    assert [row.get('name') for row in lessons[:2]] == ['Alpha', 'Beta']


def test_concept_fallback_when_no_page_blocks():
    from canvas_parser.synapse_teaching import build_curriculum, load_graph

    graph = load_graph(use_fixture=True)
    graph['concepts'] = [{
        'courseid': 'demo',
        'name': 'Matrix Products',
        'description': 'Products combine rows and columns of two matrices.',
        'details': [],
        'examples': [{'name': 'Example 3', 'description': 'A system without solutions.'}],
        'moduleOrderHints': [],
    }]
    graph['files']['demo']['1001']['pages'] = []
    lessons = build_curriculum(graph, 'demo')
    names = [row.get('name') for row in lessons]
    assert 'Matrix Products' in names
    assert 'Example 3' in names


def test_syllabus_admin_concepts_filtered():
    from canvas_parser.synapse_teaching import _lesson_is_low_quality

    lesson = {
        'name': 'Problem sets',
        'type': 'concept',
        'filename': 'NEU201 syllabus.pdf',
        'snippet': 'Weekly problem sets due on Friday.',
    }
    assert _lesson_is_low_quality(lesson)


def test_prefer_concept_curriculum_when_blocks_noisy():
    from canvas_parser.synapse_teaching import should_prefer_concept_curriculum

    assert should_prefer_concept_curriculum(1298, 648, 400, 0.5)
    assert should_prefer_concept_curriculum(250, 648, 400, 0.2)
    assert should_prefer_concept_curriculum(1512, 185, 373, 0.3)
    assert not should_prefer_concept_curriculum(1298, 3, 2, 0.0)
    assert not should_prefer_concept_curriculum(50, 648, 5, 0.0)
    assert not should_prefer_concept_curriculum(28, 588, 400, 0.0)


def test_canvas_module_order_index_week_flow():
    from canvas_parser.synapse_teaching_sections import (
        build_canvas_module_order_index,
        lesson_canvas_sort_key,
    )

    canvas_data = {
        'modules': {
            'demo': [
                {'id': 1, 'position': 1, 'name': 'Course Syllabus'},
                {'id': 2, 'position': 8, 'name': 'Week 14'},
                {'id': 3, 'position': 21, 'name': 'Week1'},
            ],
        },
        'module_items': {
            'demo': {
                '3': [{'title': 'Weekly schedule', 'position': 1, 'type': 'SubHeader'}],
            },
        },
    }
    index = build_canvas_module_order_index('demo', canvas_data)
    week1 = lesson_canvas_sort_key(
        {'name': 'Weekly schedule', 'moduleName': 'Week1', 'type': 'section'},
        index,
    )
    week14 = lesson_canvas_sort_key(
        {'name': 'Final review', 'moduleName': 'Week 14', 'type': 'section'},
        index,
    )
    assert week1 < week14


def test_lesson_canvas_sort_key_handles_nested_item_tier():
    from canvas_parser.synapse_teaching_sections import (
        build_canvas_module_order_index,
        lesson_canvas_sort_key,
    )

    canvas_data = {
        'modules': {
            '20959': [
                {'id': 1, 'position': 1, 'name': 'Course Resources'},
                {'id': 2, 'position': 2, 'name': 'ECO 101 Lecture Notes'},
            ],
        },
        'module_items': {
            '20959': {
                '2': [
                    {'title': 'ECO101_Lecture1_Notes_2026.pdf', 'position': 1, 'type': 'File'},
                    {'title': 'ECO101_Lecture2_Notes_2026.pdf', 'position': 2, 'type': 'File'},
                ],
            },
        },
    }
    index = build_canvas_module_order_index('20959', canvas_data)
    lessons = [
        {'name': 'ECO101_Lecture2_Notes_2026', 'moduleName': 'ECO 101 Lecture Notes', 'type': 'section'},
        {'name': 'ECO101_Lecture1_Notes_2026', 'moduleName': 'ECO 101 Lecture Notes', 'type': 'section'},
    ]
    indexed = sorted(range(len(lessons)), key=lambda i: lesson_canvas_sort_key(lessons[i], index))
    assert lessons[indexed[0]]['name'].endswith('Lecture1_Notes_2026')


def test_eco101_prefers_lecture_spine_over_syllabus_homework():
    from canvas_parser.synapse_teaching import build_curriculum

    graph = {
        'files': {'20959': {}},
        'syllabi': {
            '20959': {
                'other': '',
                'assignments': [
                    {'name': 'Homework 1', 'description': 'Due week 2.'},
                    {'name': 'Homework 2', 'description': 'Due week 3.'},
                ],
            },
        },
    }
    lessons = build_curriculum(graph, '20959', hydrate_local=False)
    names = [row.get('name') for row in lessons]
    assert any('Lecture' in str(name) for name in names[:5])
    assert names[0] != 'Homework 1'


def test_canvas_module_section_uses_module_name():
    from canvas_parser.synapse_teaching import build_curriculum

    graph = {'files': {'15222': {}}}
    lessons = build_curriculum(graph, '15222', hydrate_local=False, max_lessons=40)
    if not lessons:
        return
    pinyin = next((row for row in lessons if 'Pinyin Chart' in str(row.get('name') or '')), None)
    if pinyin:
        assert pinyin.get('sectionGroup') == 'Course resource'


def test_reader_audio_lessons_sort_by_lesson_number():
    from canvas_parser.synapse_teaching import build_curriculum
    import json
    from pathlib import Path

    graph = json.loads(Path('.cache/weekly_iteration/graph_eval.json').read_text(encoding='utf-8'))
    lessons = build_curriculum(graph, '15222', hydrate_local=False)
    for book in ('Oh, China', 'A Trip to China'):
        audio = [
            row for row in lessons
            if str(row.get('moduleName') or '') == 'Audio material'
            and book.casefold() in str(row.get('name') or '').casefold()
        ]
        if len(audio) < 4:
            continue
        nums = []
        for row in audio:
            match = re.search(r'L(\d+)', str(row.get('name') or ''), re.I)
            if match:
                nums.append(int(match.group(1)))
        assert nums == sorted(nums), f'{book} audio out of order: {nums[:12]}'


def test_eco101_interleaves_notes_and_slides_by_lecture():
    import json
    from pathlib import Path
    from canvas_parser.synapse_teaching import build_curriculum

    graph = json.loads(Path('.cache/weekly_iteration/graph_eval.json').read_text(encoding='utf-8'))
    lessons = build_curriculum(graph, '20959', hydrate_local=False)
    notes_idx = next(
        i for i, row in enumerate(lessons)
        if str(row.get('name') or '').startswith('ECO101_Lecture1_Notes')
    )
    slides_idx = next(
        i for i, row in enumerate(lessons)
        if str(row.get('name') or '').startswith('ECO101_Lecture1_In_class_Slides')
        or str(row.get('name') or '').startswith('ECO101_Lecture1_In-class_Slides')
    )
    notes2_idx = next(
        i for i, row in enumerate(lessons)
        if str(row.get('name') or '').startswith('ECO101_Lecture2_Notes')
    )
    assert notes_idx < slides_idx < notes2_idx


def test_lesson_canvas_sort_key_orders_concepts_by_page_not_name():
    from canvas_parser.synapse_teaching_sections import (
        build_canvas_module_order_index,
        lesson_canvas_sort_key,
    )

    canvas_data = {
        'modules': {'c': [{'id': 1, 'position': 3, 'name': 'Course slides'}]},
        'module_items': {'c': {}},
    }
    index = build_canvas_module_order_index('c', canvas_data)
    lessons = [
        {'name': 'Zebra topic', 'type': 'concept', 'moduleName': 'Course slides',
         'filename': 'L1 lesson.pdf', 'pageNumber': 3},
        {'name': 'Aardvark topic', 'type': 'concept', 'moduleName': 'Course slides',
         'filename': 'L1 lesson.pdf', 'pageNumber': 8},
    ]
    order = sorted(range(2), key=lambda i: lesson_canvas_sort_key(lessons[i], index))
    # Page 3 precedes page 8 even though "Aardvark" precedes "Zebra" alphabetically.
    assert lessons[order[0]]['name'] == 'Zebra topic'


def test_lesson_canvas_sort_key_orders_files_by_lecture_then_page():
    from canvas_parser.synapse_teaching_sections import (
        build_canvas_module_order_index,
        lesson_canvas_sort_key,
    )

    canvas_data = {
        'modules': {'c': [{'id': 1, 'position': 2, 'name': 'ECO 101 Lecture Notes'}]},
        'module_items': {'c': {}},
    }
    index = build_canvas_module_order_index('c', canvas_data)
    lessons = [
        {'name': 'late point', 'type': 'concept', 'moduleName': 'ECO 101 Lecture Notes',
         'filename': 'ECO101_Lecture10_Notes.pdf', 'pageNumber': 1},
        {'name': 'early point', 'type': 'concept', 'moduleName': 'ECO 101 Lecture Notes',
         'filename': 'ECO101_Lecture2_Notes.pdf', 'pageNumber': 9},
    ]
    order = [lessons[i]['name'] for i in sorted(range(2), key=lambda i: lesson_canvas_sort_key(lessons[i], index))]
    # Lecture 2 sorts before Lecture 10 (numeric, not string).
    assert order == ['early point', 'late point']


def test_dedupe_within_section_collapses_cross_track_concepts():
    from canvas_parser.synapse_teaching import _dedupe_within_section

    lessons = [
        {'name': 'We then define the GDP Deflator as', 'type': 'concept',
         'sectionGroup': 'Lecture 2', 'teachingContext': 'short'},
        {'name': 'Unique notes point here', 'type': 'concept',
         'sectionGroup': 'Lecture 2', 'teachingContext': 'abc'},
        {'name': 'We then define the GDP Deflator as', 'type': 'concept',
         'sectionGroup': 'Lecture 2', 'teachingContext': 'a much longer richer context body'},
    ]
    out = _dedupe_within_section(lessons)
    names = [row['name'] for row in out]
    assert names == ['We then define the GDP Deflator as', 'Unique notes point here']
    # Survivor keeps the richer context from the dropped duplicate.
    assert out[0]['teachingContext'] == 'a much longer richer context body'


def test_dedupe_within_section_collapses_cross_track_problems():
    from canvas_parser.synapse_teaching import _dedupe_within_section

    lessons = [
        {'name': 'Q1: Who would benefit more from an extra $5,000 of income?',
         'type': 'problem', 'sectionGroup': 'Lecture 4', 'teachingContext': 'notes'},
        {'name': 'Q1: Who would benefit more from an extra $5,000 of income?',
         'type': 'problem', 'sectionGroup': 'Lecture 4', 'teachingContext': 'richer slides body'},
    ]
    out = _dedupe_within_section(lessons)
    assert len(out) == 1
    assert out[0]['teachingContext'] == 'richer slides body'


def test_dedupe_within_section_keeps_generic_and_cross_section():
    from canvas_parser.synapse_teaching import _dedupe_within_section

    lessons = [
        {'name': 'Problem 1', 'type': 'problem', 'sectionGroup': 'Course slides'},
        {'name': 'Problem 1', 'type': 'problem', 'sectionGroup': 'Course slides'},
        {'name': 'Step 1', 'type': 'concept', 'sectionGroup': 'Lecture 3'},
        {'name': 'Step 1', 'type': 'concept', 'sectionGroup': 'Lecture 3'},
        {'name': 'Most recent readings', 'type': 'concept', 'sectionGroup': 'Lecture 2'},
        {'name': 'Most recent readings', 'type': 'concept', 'sectionGroup': 'Lecture 5'},
    ]
    out = _dedupe_within_section(lessons)
    # Generic problems and short "Step 1" labels survive; same long name in two
    # different sections is preserved.
    assert sum(1 for r in out if r['name'] == 'Problem 1') == 2
    assert sum(1 for r in out if r['name'] == 'Step 1') == 2
    assert sum(1 for r in out if r['name'] == 'Most recent readings') == 2


def test_problem_interaction_downgrades_non_solvable():
    from canvas_parser.synapse_teaching import enrich_lesson_metadata

    # Misclassified grammar note: no answer key, no solve verb -> read, not answer.
    note = {'type': 'problem', 'name': 'VP + 很有意义 … is meaningful/meaningless',
            'teachingContext': 'A grammar pattern describing meaningfulness.'}
    enrich_lesson_metadata(note, [], {})
    assert note['interaction'] == 'read'

    # Genuine problem with a solve verb stays answer.
    real = {'type': 'problem', 'name': 'Problem 3',
            'teachingContext': 'Calculate the steady-state level of capital.'}
    enrich_lesson_metadata(real, [], {})
    assert real['interaction'] == 'answer'


def test_strip_leading_enumerator_cleans_titles():
    from canvas_parser.synapse_teaching import _strip_leading_enumerator

    a = {'name': '1: A proportional tax on labor income at rate t.'}
    _strip_leading_enumerator(a)
    assert a['name'] == 'A proportional tax on labor income at rate t.'

    b = {'name': '20 : Section 1 of the reading'}
    _strip_leading_enumerator(b)
    assert b['name'] == 'Section 1 of the reading'


def test_strip_leading_enumerator_protects_years_and_short_remainders():
    from canvas_parser.synapse_teaching import _strip_leading_enumerator

    # 4-digit year is not an enumerator.
    y = {'name': '1929: The Great Depression'}
    _strip_leading_enumerator(y)
    assert y['name'] == '1929: The Great Depression'

    # Stripping would leave too little to be a useful title.
    s = {'name': '1: ok'}
    _strip_leading_enumerator(s)
    assert s['name'] == '1: ok'


def test_humanize_generic_lesson_name_uses_context():
    from canvas_parser.synapse_teaching import _humanize_generic_lesson_name

    lesson = {'name': 'Problem 10', 'type': 'problem',
              'teachingContext': '10. Subject + verb pattern for expressing ability'}
    _humanize_generic_lesson_name(lesson)
    assert lesson['name'] == 'Subject + verb pattern for expressing ability'
    assert lesson['parserLabel'] == 'Problem 10'


def test_humanize_generic_lesson_name_leaves_real_titles():
    from canvas_parser.synapse_teaching import _humanize_generic_lesson_name

    lesson = {'name': 'We then define the GDP Deflator as', 'type': 'concept',
              'teachingContext': 'The GDP deflator is defined as nominal over real GDP'}
    _humanize_generic_lesson_name(lesson)
    assert lesson['name'] == 'We then define the GDP Deflator as'
    assert 'parserLabel' not in lesson


def test_humanize_generic_lesson_name_skips_when_context_thin():
    from canvas_parser.synapse_teaching import _humanize_generic_lesson_name

    lesson = {'name': 'Problem 4', 'type': 'problem', 'teachingContext': '4.'}
    _humanize_generic_lesson_name(lesson)
    # Nothing meaningful to derive -> keep the placeholder rather than inventing one.
    assert lesson['name'] == 'Problem 4'


def test_lecture_modules_group_by_lecture_number():
    from canvas_parser.synapse_teaching_sections import assign_section_groups_from_canvas

    lessons = [
        {'name': 'Notes concept', 'type': 'concept', 'fileId': 'a', 'source': 'page_blocks',
         'moduleName': 'ECO 101 Lecture Notes', 'filename': 'ECO101_Lecture1_Notes.pdf'},
        {'name': 'Slides concept', 'type': 'concept', 'fileId': 'b', 'source': 'page_blocks',
         'moduleName': 'ECO 101 Lecture Slides', 'filename': 'ECO101_Lecture1_In_class_Slides.pdf'},
    ]
    assign_section_groups_from_canvas(lessons, 'nocourse', canvas_data=None)
    assert lessons[0]['sectionGroup'] == 'Lecture 1'
    assert lessons[1]['sectionGroup'] == 'Lecture 1'


def test_subheader_teaching_context_enriched():
    from canvas_parser.synapse_teaching import build_curriculum, enrich_lesson_metadata
    import json
    from pathlib import Path

    graph = json.loads(Path('.cache/weekly_iteration/graph_eval.json').read_text(encoding='utf-8'))
    lessons = build_curriculum(graph, '15222', hydrate_local=False)
    sub = next((row for row in lessons if row.get('source') == 'canvas_subheader'), None)
    if not sub:
        return
    assert len(str(sub.get('teachingContext') or '')) >= 80
    assert sub.get('sectionGroup') == 'Course resource' or 'Week' in str(sub.get('sectionGroup') or '')


def test_spreadsheet_module_files_filtered():
    from canvas_parser.synapse_teaching import _lesson_is_low_quality

    assert _lesson_is_low_quality({
        'name': 'EC0101_HW6_excel_data',
        'type': 'section',
        'filename': 'EC0101_HW6_excel_data.xls',
        'snippet': 'x' * 100,
    })


def test_build_canvas_module_file_lessons_eco101_shape():
    from canvas_parser.synapse_teaching import build_canvas_module_file_lessons

    lessons = build_canvas_module_file_lessons('20959')
    if not lessons:
        return
    assert lessons[0].get('source') == 'canvas_module'
    assert any('Lecture' in str(row.get('name') or '') for row in lessons)


def test_resort_curriculum_puts_setup_before_weeks():
    from canvas_parser.synapse_teaching import resort_curriculum_lessons

    lessons = [
        {'name': 'Weekly quiz', 'moduleName': 'Week 9', 'type': 'section', 'sequenceIndex': 2},
        {'name': 'Pinyin system', 'moduleName': 'Course resource', 'type': 'section', 'sequenceIndex': 0},
        {'name': 'Text L1&L2', 'moduleName': 'Week2', 'type': 'section', 'sequenceIndex': 1},
    ]
    resort_curriculum_lessons(lessons, '15222')
    assert lessons[0]['name'] == 'Pinyin system'
    assert lessons[-1]['name'] == 'Weekly quiz'


def test_instructor_learning_block_filtered():
    from canvas_parser.synapse_teaching import _lesson_is_low_quality

    assert _lesson_is_low_quality({
        'name': 'Instructor 马吟秋',
        'type': 'concept',
        'filename': '',
        'snippet': '',
    })


def test_duplicate_parser_section_filtered():
    from canvas_parser.synapse_teaching import _lesson_is_low_quality

    assert _lesson_is_low_quality({
        'name': 'Parasympathetic vs Sympathetic Pharmacology (duplicate)',
        'type': 'section',
        'filename': '',
        'snippet': 'x' * 100,
    })


def test_cap_curriculum_prioritizes_structured_units():
    from canvas_parser.synapse_teaching import cap_curriculum_lessons

    lessons = []
    for index in range(6):
        lessons.append({
            'type': 'concept',
            'name': f'Concept {index}',
            'moduleName': 'Week 1' if index < 3 else 'Week 2',
        })
    lessons.append({'type': 'problem', 'name': 'Problem 1', 'moduleName': 'Week 1'})
    capped = cap_curriculum_lessons(lessons, max_lessons=4)
    types = [row['type'] for row in capped]
    modules = {row.get('moduleName') for row in capped}
    assert 'problem' in types
    assert 'Week 1' in modules
    assert 'Week 2' in modules


def test_module_fallback_from_hints():
    from canvas_parser.synapse_teaching import build_module_fallback_lessons

    graph = {
        'moduleOrderHints': {
            'stats': {
                '1': {
                    'moduleId': '10',
                    'position': 1,
                    'itemType': 'file',
                    'contentId': '9001',
                    'moduleName': 'Class Notes',
                },
                '2': {
                    'moduleId': '11',
                    'position': 1,
                    'itemType': 'file',
                    'contentId': '9002',
                    'moduleName': 'Problem Sets',
                },
            },
        },
        'files': {'stats': {}},
    }
    lessons = build_module_fallback_lessons(graph, 'stats')
    assert len(lessons) == 2
    assert lessons[0]['source'] == 'graph_module'


def test_low_quality_filters_concatenated_labels():
    from canvas_parser.synapse_teaching import _lesson_is_low_quality

    lesson = {
        'name': 'Actual facesIllusory faces',
        'type': 'section',
        'filename': '',
        'snippet': '',
    }
    assert _lesson_is_low_quality(lesson)


def test_merge_block_problems_into_concept_curriculum():
    from canvas_parser.synapse_teaching import _merge_block_interactives

    concepts = [{'type': 'concept', 'name': 'Neurons'}]
    blocks = [
        {'type': 'problem', 'name': 'Problem 1', 'snippet': 'Compute the EPP.'},
        {'type': 'concept', 'name': 'Neurons'},
    ]
    merged = _merge_block_interactives(concepts, blocks)
    names = [row['name'] for row in merged]
    assert 'Neurons' in names
    assert 'Problem 1' in names


def test_syllabus_fallback_from_assignments():
    from canvas_parser.synapse_teaching import build_syllabus_fallback_lessons

    graph = {
        'syllabi': {
            'demo2': {
                'other': 'This course introduces macroeconomic models for policy analysis in the modern economy.',
                'assignments': [{
                    'name': 'Problem Set 1',
                    'description': 'Build a supply and demand model for labor markets.',
                }],
            },
        },
    }
    lessons = build_syllabus_fallback_lessons(graph, 'demo2')
    names = [row['name'] for row in lessons]
    assert 'Course overview' in names
    assert 'Problem Set 1' in names
    assert lessons[0].get('teachingContext')


def test_resolve_lesson_cap_scales_large_courses():
    from canvas_parser.synapse_teaching import ABSOLUTE_MAX_LESSONS, resolve_lesson_cap

    assert resolve_lesson_cap(250, 300) == 250
    assert resolve_lesson_cap(400, 300) == 400
    assert resolve_lesson_cap(633, 300) == 633
    assert resolve_lesson_cap(900, 300) == ABSOLUTE_MAX_LESSONS
    assert resolve_lesson_cap(5000, 300) == ABSOLUTE_MAX_LESSONS
    assert resolve_lesson_cap(10, 2) == 2


def test_concept_body_text_aggregates_details():
    from canvas_parser.synapse_teaching import _concept_body_text

    body = _concept_body_text({
        'name': 'Eigenvalues',
        'description': 'Scalars tied to square matrices.',
        'details': [{'name': 'Diagonalization', 'description': 'Factor A = PDP^-1.'}],
    })
    assert 'Scalars tied to square matrices.' in body
    assert 'Diagonalization' in body


def test_enrich_lesson_metadata_expands_thin_context():
    from canvas_parser.synapse_teaching import enrich_lesson_metadata

    lesson = {
        'type': 'section',
        'name': 'Row reduction',
        'snippet': 'Gaussian elimination transforms a matrix into echelon form using elementary row ops.',
        'source': 'page_blocks',
    }
    enrich_lesson_metadata(lesson, [])
    assert len(lesson.get('teachingContext') or '') >= 80


def test_enrich_lesson_metadata_uses_concept_context():
    from canvas_parser.synapse_teaching import enrich_lesson_metadata

    lesson = {
        'type': 'example',
        'name': 'Eigenvalues',
        'snippet': 'Eigenvalues',
        'source': 'page_blocks',
    }
    concept_context = {
        'eigenvalues': 'Scalars lambda where Av = lambda v for square matrix A.',
    }
    enrich_lesson_metadata(lesson, [], concept_context)
    assert 'lambda' in str(lesson.get('teachingContext') or '').casefold()


def test_teaching_block_includes_context_text():
    from canvas_parser.content.teaching_blocks import classify_teaching_block

    block = classify_teaching_block(
        'Problem 3. Find all eigenvalues of the matrix A = [[2, 1], [0, 3]] and show your work.'
    )
    assert block is not None
    assert len(block.get('contextText') or '') >= len(block.get('snippet') or '')


def test_hydrate_without_local_files_is_noop():
    from canvas_parser.synapse_teaching import build_curriculum, enrich_graph_content, load_graph

    graph = load_graph(use_fixture=True)
    _, stats = enrich_graph_content(graph, 'demo')
    assert stats.get('homepageHydrated') in {True, False}
    without = build_curriculum(graph, 'demo', hydrate_local=False)
    with_hydrate = build_curriculum(graph, 'demo', hydrate_local=True)
    assert len(without) == len(with_hydrate)


def test_hydrate_aborts_when_no_local_files():
    from canvas_parser.synapse_teaching import hydrate_course_from_local_files, load_graph

    graph = load_graph(use_fixture=True)
    graph, stats = hydrate_course_from_local_files(
        graph,
        'demo',
        file_id_filter={'9999999991', '9999999992', '9999999993', '9999999994',
                        '9999999995', '9999999996', '9999999997', '9999999998'},
    )
    assert stats.get('abortedEarly') is True
    assert stats.get('hydratedFiles', 0) == 0


def test_curriculum_quality_metrics():
    from canvas_parser.synapse_teaching import curriculum_quality_metrics

    metrics = curriculum_quality_metrics([
        {'name': 'A', 'type': 'concept', 'teachingContext': 'x' * 100},
        {'name': 'A', 'type': 'section', 'snippet': 'short'},
    ])
    assert metrics['duplicateNames'] == 1
    assert metrics['thinContextCount'] == 1
    assert metrics['avgContextChars'] > 50
