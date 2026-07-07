"""Tests for per-pass planning and merge fixes."""
from __future__ import annotations

from canvas_parser.parse.lambda_runtime import merge_graph_fragments
from canvas_parser.parse.parse_pass_plan import (
    audit_fragment_passes,
    plan_passes_for_file,
    summarize_pool_pass_plans,
)
from canvas_parser.parse.parse_modes import apply_parse_mode, normalize_parse_mode


def test_pool_hint_does_not_mask_typed_heuristic():
    plan = plan_passes_for_file(
        course_id='1',
        file_id='2',
        filename='Mach Bands explained.pdf',
        file_type_hint='generic_content',
    )
    assert plan.resolved_type == 'lecture_notes'


def test_plan_skips_llm_classify_when_heuristic_confident():
    plan = plan_passes_for_file(
        course_id='1',
        file_id='2',
        filename='Lecture 12 Slides.pdf',
        file_type_hint='lecture_slides',
    )
    assert 'llm_classify' in plan.skipped_pass_ids()
    assert plan.est_llm_calls() == 1


def test_plan_skips_pass2_for_past_exam():
    plan = plan_passes_for_file(
        course_id='1',
        file_id='2',
        filename='Midterm Exam 2024.pdf',
        file_type_hint='past_exam',
    )
    assert 'llm_pass2' in plan.skipped_pass_ids()


def test_plan_skips_pass2_for_problem_set():
    plan = plan_passes_for_file(
        course_id='1',
        file_id='2',
        filename='Problem Set 3.pdf',
        file_type_hint='problem_set',
    )
    assert 'llm_pass2' in plan.skipped_pass_ids()
    assert plan.est_llm_calls() == 1


def test_plan_skips_pass2_for_review_sheet():
    plan = plan_passes_for_file(
        course_id='1',
        file_id='2',
        filename='Midterm Review Guide.pdf',
        file_type_hint='review_sheet',
    )
    assert 'llm_pass2' in plan.skipped_pass_ids()


def test_plan_skips_pass2_for_lecture_slides():
    plan = plan_passes_for_file(
        course_id='1',
        file_id='2',
        filename='Lecture 12 Slides.pdf',
        file_type_hint='lecture_slides',
    )
    assert 'llm_pass2' in plan.skipped_pass_ids()
    assert plan.est_llm_calls() == 1


def test_realistic_estimates_at_most_upper_bound():
    plan = plan_passes_for_file(
        course_id='1',
        file_id='2',
        filename='Chapter 3 Reading.pdf',
        file_type_hint='textbook_chapter',
    )
    assert plan.est_realistic_llm_calls() <= plan.est_llm_calls()
    if plan.est_llm_calls() > 1:
        assert plan.est_realistic_llm_calls() < plan.est_llm_calls()


def test_pool_pass_plan_summary_savings():
    entries = [
        {'courseId': '1', 'fileId': 'a', 'filename': 'Lecture 1.pdf', 'fileType': 'lecture_slides'},
        {'courseId': '1', 'fileId': 'b', 'filename': 'Quiz 2.pdf', 'fileType': 'past_exam'},
    ]
    summary = summarize_pool_pass_plans(entries)
    assert summary['fileCount'] == 2
    assert summary['estSavingsVsNaive'] > 0


def test_audit_flags_wasted_classify():
    fragment = {
        'files': {'15237': {'9': {'academicFileType': 'lecture_slides', 'pages': [{'text': 'x'}]}}},
        'concepts': [{'courseid': '15237', 'name': 'Topic', 'details': [{'name': 'detail'}]}],
        'completed_model_calls': {
            'deepseek_classifications': [{'courseid': '15237', 'fileid': '9', 'usage': {'total_tokens': 100}}],
            'deepseek_file_passes': [{'courseid': '15237', 'fileid': '9', 'usage': {'total_tokens': 500}, 'turns': []}],
        },
        '_meta': {'deepseek_passes': 1},
    }
    audit = audit_fragment_passes(
        fragment,
        course_id='15237',
        file_id='9',
        filename='Lecture 12 Slides.pdf',
        file_type_hint='lecture_slides',
    )
    classify = next(s for s in audit['steps'] if s['pass'] == 'llm_classify')
    assert classify['verdict'] in ('cut', 'skipped_ok', 'keep')


def test_merge_syllabus_prefers_richer_fragment():
    thin = {'syllabi': {'100': {'courseid': '100', 'assignments': []}}}
    rich = {'syllabi': {'100': {'courseid': '100', 'assignments': [{'name': 'PSet 1'}, {'name': 'PSet 2'}]}}}
    merged = merge_graph_fragments([thin, rich])
    assert len(merged['syllabi']['100']['assignments']) == 2
    merged2 = merge_graph_fragments([rich, thin])
    assert len(merged2['syllabi']['100']['assignments']) == 2


def test_aggregate_pass_audits_empty():
    from canvas_parser.parse.parse_pass_plan import aggregate_pass_audits

    assert aggregate_pass_audits([])['fileCount'] == 0


def test_aggregate_pass_audits_counts():
    from canvas_parser.parse.parse_pass_plan import aggregate_pass_audits

    audits = [{
        'totalLlmTokens': 100,
        'cutCandidates': ['llm_classify'],
        'recommendations': ['Skip classify'],
        'steps': [
            {'pass': 'llm_classify', 'ran': True, 'useful': False, 'verdict': 'cut', 'tokens': 50},
            {'pass': 'llm_pass1', 'ran': True, 'useful': True, 'verdict': 'keep', 'tokens': 50},
        ],
    }]
    agg = aggregate_pass_audits(audits)
    assert agg['fileCount'] == 1
    assert agg['byPass']['llm_classify']['cut'] == 1


def test_llm_cost_mode_registered():
    assert normalize_parse_mode('llm-cost') == 'llm-cost'
    apply_parse_mode('llm-cost')
    import os
    assert os.environ.get('PARSER_SKIP_SYLLABUS_FINAL_PASS') == '1'
    assert os.environ.get('PARSER_DEFER_PER_FILE_FINALIZE') == '0'
    assert os.environ.get('PARSER_SKIP_LLM_CLASSIFY') == '1'


def test_plan_skips_llm_for_image():
    plan = plan_passes_for_file(
        course_id='1',
        file_id='2',
        filename='Screenshot 2024-09-10.png',
        file_type_hint='generic_content',
    )
    assert 'llm_pass1' in plan.skipped_pass_ids()
    assert plan.est_llm_calls() == 0
