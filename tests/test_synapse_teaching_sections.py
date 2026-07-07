"""Tests for weekly-bucket section group assignment."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.synapse_teaching_sections import (
    annotate_section_metadata,
    assign_section_groups_from_canvas,
    build_weekly_section_index,
    resolve_lesson_section_group,
)


def _minimal_canvas_data():
    return {
        'courses': [{
            'id': 1,
            'course_code': 'CHM 201',
            'name': 'General Chemistry I Fall 2024',
            'start_at': '2024-08-26T04:00:00Z',
            'syllabus_body': '<p>Exam 1 (Midterm): October 10, 2024</p>',
        }],
        'assignments': {
            '1': [{
                'id': 'a1',
                'name': 'Problem Set 1',
                'due_at': '2024-09-13T03:59:59Z',
                'published': True,
                'submission_types': ['online_upload'],
            }],
        },
        'file': {'1': []},
        'modules': {'1': [{'id': 'm1', 'name': 'Week 1', 'position': 1}]},
        'module_items': {
            '1': {
                'm1': [{
                    'id': 'i1',
                    'type': 'File',
                    'content_id': '10',
                    'position': 1,
                    'title': 'Week 1 schedule.pdf',
                }],
            },
        },
        'pages': {'1': []},
    }


def test_weekly_file_match_sets_section_group():
    canvas_data = _minimal_canvas_data()
    index = build_weekly_section_index('1', canvas_data)
    assert index.get('by_name')

    lesson = {
        'filename': 'Week 1 schedule.pdf',
        'name': 'Course schedule',
        'moduleName': '',
        'fileId': '10',
        'type': 'section',
    }
    assert resolve_lesson_section_group(lesson, index, 'Introduction') == 'Week 1'


def test_assignment_name_match_sets_section_group():
    canvas_data = _minimal_canvas_data()
    index = build_weekly_section_index('1', canvas_data)

    lesson = {
        'filename': 'notes.pdf',
        'name': 'Problem Set 1',
        'moduleName': '',
        'fileId': '20',
        'type': 'problem',
    }
    assert resolve_lesson_section_group(lesson, index, 'Introduction') == 'Week 1'


def test_module_name_fallback_when_no_weekly_match():
    canvas_data = _minimal_canvas_data()
    lessons = [{
        'filename': 'unrelated.pdf',
        'name': 'Random topic',
        'moduleName': 'Class Notes',
        'fileId': '99',
        'type': 'concept',
    }]
    assign_section_groups_from_canvas(lessons, '1', canvas_data=canvas_data)
    assert lessons[0]['sectionGroup'] == 'Class Notes'


def test_sequential_fallback_without_canvas_data():
    lessons = [{
        'filename': 'notes.pdf',
        'name': 'Topic A',
        'moduleName': 'Week 2 Readings',
        'fileId': '1',
        'type': 'concept',
    }]
    assign_section_groups_from_canvas(lessons, '1', canvas_data=None)
    assert lessons[0]['sectionGroup'] == 'Week 2 Readings'


def test_annotate_section_metadata():
    lessons = [
        {'sectionGroup': 'Week 1'},
        {'sectionGroup': 'Week 1'},
        {'sectionGroup': 'Week 2'},
    ]
    annotate_section_metadata(lessons)
    assert lessons[0]['sectionIndex'] == 0
    assert lessons[0]['sectionLessonIndex'] == 0
    assert lessons[0]['sectionTotal'] == 2
    assert lessons[1]['sectionLessonIndex'] == 1
    assert lessons[2]['sectionIndex'] == 1
    assert lessons[2]['sectionTotal'] == 1


def test_assign_section_groups_prefers_weekly_over_module():
    canvas_data = _minimal_canvas_data()
    lessons = [{
        'filename': 'Week 1 schedule.pdf',
        'name': 'Overview',
        'moduleName': 'Class Notes',
        'fileId': '10',
        'type': 'section',
    }]
    assign_section_groups_from_canvas(lessons, '1', canvas_data=canvas_data)
    assert lessons[0]['sectionGroup'] == 'Week 1'
    assert lessons[0]['sectionIndex'] == 0
    assert lessons[0]['sectionTotal'] == 1
