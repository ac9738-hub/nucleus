"""Tests for offline template parse eval GT builder."""
from __future__ import annotations

from canvas_parser.parse.parse_eval_gt import compare_file_to_gt
from canvas_parser.parse.template_eval_gt import (
    TEMPLATE_GT_PASSES,
    build_template_gt_from_pdf,
    local_pdf_path,
)


def test_template_gt_passes_defined():
    assert 'extract_pages' in TEMPLATE_GT_PASSES
    assert 'reconcile' in TEMPLATE_GT_PASSES
    assert len(TEMPLATE_GT_PASSES) >= 7


def test_build_template_gt_for_pool_pdf_if_present():
    """When canvasfiles exist, template GT should be non-empty for slide decks."""
    file_id = '3457518'  # NEU201 lecture slides in parse eval pool
    if not local_pdf_path(file_id):
        return
    gt = build_template_gt_from_pdf(
        course_id='15237',
        file_id=file_id,
        filename='A brief history of unit 3.pdf',
        pool_file_type_hint='lecture_slides',
    )
    assert gt['buildMode'] == 'template_multi_pass_offline'
    assert gt['expectedFileType'] == 'lecture_slides'
    assert gt['conceptCount'] >= 3
    assert gt['expectsPass2'] is False
    assert gt['gtProvenance']['offlinePassAudit']['extract_pages']['pageCount'] > 0


def test_template_gt_self_compare_is_perfect_when_stub_matches():
    file_id = '3457518'
    if not local_pdf_path(file_id):
        return
    gt = build_template_gt_from_pdf(
        course_id='15237',
        file_id=file_id,
        filename='A brief history of unit 3.pdf',
        pool_file_type_hint='lecture_slides',
    )
    stub = {
        'concepts': [
            {
                'courseid': '15237',
                'name': c['name'],
                'sourceFiles': [file_id],
                'details': [{'name': d} for d in c.get('details') or []],
            }
            for c in gt['concepts']
        ],
        'files': {
            '15237': {
                file_id: {
                    'academicFileType': gt['expectedFileType'],
                    'name': gt['filename'],
                },
            },
        },
        '_meta': {'deepseek_passes': 1},
    }
    score = compare_file_to_gt(stub, gt)
    assert score['conceptRecall'] >= 0.99
    assert score['fileTypeMatch'] is True
    assert score['passed'] is True
