"""Tests for pass overrides and improved pass planning."""
from __future__ import annotations

from canvas_parser.parse.parse_pass_overrides import (
    apply_pass_plan_to_parse_item,
    eval_stratum,
    pass_plan_enabled,
    plan_passes_for_parse_item,
    plan_passes_for_pool_entry,
    prepare_parse_item,
)
from canvas_parser.parse.parse_pass_plan import plan_passes_for_file, summarize_pool_pass_plans


def test_eval_stratum_syllabus():
    assert eval_stratum({'fileType': 'syllabus'}) == 'syllabus'
    assert eval_stratum({'fileType': 'lecture_slides'}) == 'content'


def test_plan_skips_syllabus_llm_for_eval_when_seeded():
    entry = {
        'courseId': '1',
        'fileId': '2',
        'filename': 'Syllabus Fall 2025.pdf',
        'fileType': 'syllabus',
    }
    plan = plan_passes_for_pool_entry(entry, syllabus_seed_present=True, for_gt_build=False)
    assert 'llm_pass1' in plan.skipped_pass_ids()
    assert 'llm_pass2' in plan.skipped_pass_ids()


def test_plan_keeps_syllabus_llm_for_gt_build():
    entry = {
        'courseId': '1',
        'fileId': '2',
        'filename': 'Syllabus Fall 2025.pdf',
        'fileType': 'syllabus',
    }
    plan = plan_passes_for_pool_entry(entry, syllabus_seed_present=True, for_gt_build=True)
    assert 'llm_pass1' in plan.needed_pass_ids()


def test_prepare_parse_item_sets_skip_classify():
    entry = {
        'courseId': '1',
        'fileId': '2',
        'filename': 'Lecture 12 Slides.pdf',
        'fileType': 'lecture_slides',
    }
    plan = plan_passes_for_file(
        course_id='1',
        file_id='2',
        filename=entry['filename'],
        file_type_hint='lecture_slides',
    )
    item = prepare_parse_item({'id': '2', 'courseid': '1'}, entry, plan)
    assert item.get('skipLlmClassify') is True
    assert item.get('skipPass2') is True  # lecture_slides is single-pass + promote


def test_prepare_parse_item_skips_pass2_for_generic():
    entry = {
        'courseId': '1',
        'fileId': '3',
        'filename': 'misc notes.pdf',
        'fileType': 'generic_content',
    }
    plan = plan_passes_for_file(
        course_id='1',
        file_id='3',
        filename=entry['filename'],
        file_type_hint='generic_content',
    )
    item = prepare_parse_item({'id': '3', 'courseid': '1'}, entry, plan)
    assert item.get('skipPass2') is True


def test_prepare_parse_item_skips_pass1_for_seeded_syllabus():
    entry = {
        'courseId': '1',
        'fileId': '2',
        'filename': 'Syllabus Fall 2025.pdf',
        'fileType': 'syllabus',
    }
    plan = plan_passes_for_pool_entry(entry, syllabus_seed_present=True, for_gt_build=False)
    item = prepare_parse_item({'id': '2', 'courseid': '1'}, entry, plan)
    assert item.get('skipLlmPass1') is True
    assert item.get('skipPass2') is True


def test_prepare_parse_item_skips_pass1_for_link_only_profile():
    entry = {
        'courseId': '1',
        'fileId': '9',
        'filename': 'Quiz 3 2024.pdf',
        'fileType': 'past_exam',
    }
    plan = plan_passes_for_pool_entry(entry, syllabus_seed_present=True, for_gt_build=False)
    item = prepare_parse_item({'id': '9', 'courseid': '1'}, entry, plan)
    assert item.get('skipLlmPass1') is True


def test_empty_teaching_signal_skips_pass1():
    entry = {
        'courseId': '15237',
        'fileId': '3309275',
        'filename': 'Mach Bands explained.pdf',
        'fileType': 'generic_content',
        'pageCount': 2,
    }
    plan = plan_passes_for_pool_entry(entry, syllabus_seed_present=True, for_gt_build=False)
    assert 'llm_pass1' in plan.skipped_pass_ids()


def test_problem_set_key_skips_pass1():
    entry = {
        'courseId': '15237',
        'fileId': '3274370',
        'filename': 'Problem Set 2_syn trans I and II KEY.pdf',
        'fileType': 'lecture_slides',
    }
    plan = plan_passes_for_pool_entry(entry, syllabus_seed_present=True, for_gt_build=False)
    assert plan.resolved_type == 'exam_solution'
    assert 'llm_pass1' in plan.skipped_pass_ids()


def test_pool_summary_counts_syllabus_skip():
    entries = [
        {'courseId': '1', 'fileId': 'a', 'filename': 'Syllabus.pdf', 'fileType': 'syllabus'},
        {'courseId': '1', 'fileId': 'b', 'filename': 'Lecture 1.pdf', 'fileType': 'lecture_slides'},
    ]
    summary = summarize_pool_pass_plans(entries, use_snippets=True)
    assert summary['skipSyllabusLlmWhenSeeded'] == 1
    assert summary['contentFileCount'] == 1


def test_apply_pass_plan_to_parse_item_when_enabled(monkeypatch):
    monkeypatch.setenv('PARSER_PASS_PLAN', '1')
    item = {
        'id': '9',
        'courseid': '1',
        'name': 'Quiz 3 2024.pdf',
    }
    out = apply_pass_plan_to_parse_item(item, pages=[])
    assert out.get('skipLlmPass1') is True
    assert out.get('knownFileType') == 'past_exam'
    assert out.get('passPlan')


def test_apply_pass_plan_skipped_when_disabled(monkeypatch):
    monkeypatch.delenv('PARSER_PASS_PLAN', raising=False)
    monkeypatch.setenv('PARSER_PARSE_MODE', 'llm-fast')
    item = {'id': '9', 'courseid': '1', 'name': 'Quiz 3 2024.pdf'}
    out = apply_pass_plan_to_parse_item(item, pages=[])
    assert 'passPlan' not in out
    assert out.get('skipLlmPass1') is None


def test_plan_passes_for_parse_item_uses_live_pages(monkeypatch):
    monkeypatch.setenv('PARSER_PASS_PLAN', '1')
    monkeypatch.setattr(
        'canvas_parser.parse.parse_pass_overrides.heuristic_teaching_signal_empty',
        lambda entry, file_type: True,
    )
    item = {
        'id': '3309275',
        'courseid': '15237',
        'name': 'Mach Bands explained.pdf',
    }
    plan = plan_passes_for_parse_item(
        item,
        pages=[{'pageNumber': 1, 'pageid': 'p1', 'text': 'x'}],
    )
    assert 'llm_pass1' in plan.skipped_pass_ids()
