"""Tests for per-item Lambda parser runtime isolation."""
from __future__ import annotations

from canvas_parser.parse.lambda_runtime import reset_parser_state


def test_reset_parser_state_clears_per_invocation_course_content():
    import parser as parser_mod

    parser_mod.current_assignment_files_groups.append({
        'indicator': 1,
        'assignmentid': 'assignment-a',
        'courseid': 'course-a',
        'name': 'Assignment A',
    })
    parser_mod.current_files_groups.append({
        'indicator': 1,
        'fileid': 'file-a',
        'courseid': 'course-a',
        'name': 'File A',
    })
    parser_mod.allsyllabi['course-a'] = {'courseid': 'course-a', 'other': 'private syllabus'}
    parser_mod.eventNodes['course-a'] = [parser_mod.eventNode(name='Private Exam')]
    parser_mod.assignment_description_summary_cache[('private assignment text', 120)] = 'private summary'
    parser_mod._debug_pass1_tool_names[('course-a', 'file-a')] = ['log_detail']
    parser_mod.course_name_cache = {'course-a': 'Private Course'}

    reset_parser_state()

    assert parser_mod.current_assignment_files_groups == []
    assert parser_mod.current_files_groups == []
    assert parser_mod.allsyllabi == {}
    assert parser_mod.eventNodes == {}
    assert parser_mod.assignment_description_summary_cache == {}
    assert parser_mod._debug_pass1_tool_names == {}
    assert parser_mod.course_name_cache is None
