#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.fast_path import (  # noqa: E402
    is_malformed_event_link_name,
    is_non_fatal_llm_error,
    linked_discovered_use_pass1_only,
    linked_file_uses_light_llm,
    page_is_link_hub,
    pass1_needs_pass2,
    prompt_over_budget,
    sanitize_event_link_name,
    should_skip_llm_for_image,
    trim_pages_for_pass1,
)


def _fake_canonical(name):
    lowered = str(name or '').casefold()
    if 'quiz' in lowered:
        return 'Quiz'
    if 'final' in lowered:
        return 'Final'
    return ''


class ParserFastPathTests(unittest.TestCase):
    def test_prompt_over_budget_by_pages(self):
        pages = [{'text': 'x'} for _ in range(121)]
        self.assertTrue(prompt_over_budget(pages=pages, max_chars=10_000_000))

    def test_trim_pages_for_pass1(self):
        pages = [{'text': 'a' * 1000} for _ in range(130)]
        trimmed, truncated = trim_pages_for_pass1(pages, max_pages=120, max_chars=50_000)
        self.assertTrue(truncated)
        self.assertLessEqual(len(trimmed), 120)

    def test_pass1_needs_pass2(self):
        self.assertFalse(pass1_needs_pass2(['add_concept_node', 'add_file_node']))
        self.assertTrue(pass1_needs_pass2(['log_detail', 'add_concept_node']))
        self.assertFalse(pass1_needs_pass2(['log_literary_theme', 'log_literary_character']))
        self.assertFalse(pass1_needs_pass2(['log_lecture_slide'], profile_pass2=True))

    def test_pass1_skips_pass2_for_type_specific_only(self):
        self.assertFalse(
            pass1_needs_pass2(
                ['log_lecture_slide', 'add_file_node'],
                profile_pass2=True,
            )
        )

    def test_pass1_needs_pass2_problem_only(self):
        from canvas_parser.parse.file_types import get_file_type_profile

        profile = get_file_type_profile('problem_set')
        self.assertFalse(profile.extract_concepts)
        self.assertTrue(profile.extract_problems)
        self.assertFalse(
            pass1_needs_pass2(
                ['log_problem', 'add_assignment_node'],
                profile_pass2=True,
                profile=profile,
            )
        )

    def test_malformed_event_names(self):
        self.assertTrue(is_malformed_event_link_name('Quizeventid'))
        self.assertFalse(is_malformed_event_link_name('Quiz'))

    def test_sanitize_event_link_name(self):
        self.assertEqual(sanitize_event_link_name('Quiz review', _fake_canonical), 'Quiz review')
        self.assertEqual(sanitize_event_link_name('Quizeventid', _fake_canonical), 'Quiz')

    def test_linked_light_study_material(self):
        self.assertTrue(
            linked_file_uses_light_llm(
                filename='MidtermReview.pdf',
                study_material_classification={'filetype': 'study_material'},
            )
        )

    def test_skip_image_files(self):
        self.assertTrue(should_skip_llm_for_image('logo.png', 'image/png'))

    def test_linked_pass1_only_for_substantive_pdf(self):
        self.assertFalse(
            linked_discovered_use_pass1_only(
                filename='Week1_CRT_Demos.pdf',
                file_size=500_000,
                is_study_material=False,
            )
        )

    def test_linked_pass1_only_for_small_study(self):
        self.assertTrue(
            linked_discovered_use_pass1_only(
                filename='MidtermReview.pdf',
                file_size=120_000,
                is_study_material=True,
            )
        )

    def test_is_non_fatal_llm_error(self):
        self.assertFalse(is_non_fatal_llm_error('Error code: 402 - Insufficient Balance'))
        self.assertTrue(is_non_fatal_llm_error('maximum context length exceeded'))
        self.assertTrue(is_non_fatal_llm_error('Error code: 429 - rate limit exceeded'))

    def test_page_is_link_hub(self):
        html = '<a href="/files/123/download">slides</a><a href="/files/456/download">lab</a>'
        self.assertTrue(page_is_link_hub(html, 'Download files below'))
        self.assertFalse(page_is_link_hub('', 'Long prose ' * 200))


if __name__ == '__main__':
    unittest.main()
