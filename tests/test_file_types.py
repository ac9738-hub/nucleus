#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.file_types import (  # noqa: E402
    ALL_FILE_TYPE_IDS,
    build_classification_snippet,
    get_file_type_profile,
    heuristic_classify,
    normalize_file_type_id,
    pass1_tool_names_for_profile,
    resolve_file_type_profile,
)


class FileTypeTests(unittest.TestCase):
    def test_all_profiles_exist(self):
        for type_id in ALL_FILE_TYPE_IDS:
            profile = get_file_type_profile(type_id)
            self.assertEqual(profile.type_id, type_id)

    def test_heuristic_past_exam(self):
        snippet = "Your Name: Precept TA: CHM 201 - Final Exam December 20, 2023 HONOR CODE PLEDGE"
        type_id, conf = heuristic_classify(filename='Final_Exam.pdf', snippet=snippet)
        self.assertEqual(type_id, 'past_exam')
        self.assertGreater(conf, 0.8)

    def test_heuristic_literary_low_stem(self):
        snippet = "Chapter One. The old man said, looking out at the sea, that the poem would never end."
        type_id, conf = heuristic_classify(filename='reading.pdf', snippet=snippet)
        self.assertIn(type_id, {'literary_work', 'humanities_reading', 'generic_content'})

    def test_literary_work_no_concept_tools(self):
        profile = get_file_type_profile('literary_work')
        tools = pass1_tool_names_for_profile(profile)
        self.assertNotIn('add_concept_node', tools)
        self.assertNotIn('log_detail', tools)
        self.assertFalse(profile.pass2)

    def test_generic_content_pass1_only(self):
        profile = get_file_type_profile('generic_content')
        self.assertTrue(profile.extract_concepts)
        self.assertFalse(profile.pass2)
        self.assertFalse(profile.teaching_outline)

    def test_problem_set_pass1_only(self):
        profile = get_file_type_profile('problem_set')
        self.assertTrue(profile.extract_problems)
        self.assertFalse(profile.extract_concepts)
        self.assertFalse(profile.pass2)

    def test_assignment_sheet_pass1_only(self):
        profile = get_file_type_profile('assignment_sheet')
        self.assertFalse(profile.pass2)

    def test_review_sheet_pass1_only(self):
        profile = get_file_type_profile('review_sheet')
        self.assertFalse(profile.pass2)

    def test_lecture_slides_single_pass(self):
        profile = get_file_type_profile('lecture_slides')
        self.assertTrue(profile.extract_concepts)
        self.assertFalse(profile.pass2)
        tools = pass1_tool_names_for_profile(profile)
        self.assertIn('log_lecture_slide', tools)
        self.assertNotIn('add_concept_node', tools)
        self.assertNotIn('log_detail', tools)

    def test_llm_overrides_low_heuristic(self):
        profile, type_id, conf, source = resolve_file_type_profile(
            filename='notes.pdf',
            snippet='x' * 100,
            llm_type_id='lecture_slides',
            llm_confidence=0.95,
        )
        self.assertEqual(type_id, 'lecture_slides')
        self.assertEqual(source, 'llm')

    def test_snippet_builder(self):
        pages = [{'pageNumber': 1, 'pageid': 'p1', 'text': 'Hello ' * 500}]
        snippet = build_classification_snippet(pages=pages, max_chars=400)
        self.assertLessEqual(len(snippet), 400)

    def test_normalize_aliases(self):
        self.assertEqual(normalize_file_type_id('exam_paper'), 'past_exam')
        self.assertEqual(normalize_file_type_id('slides'), 'lecture_slides')

    def test_heuristic_author_year_research(self):
        type_id, conf = heuristic_classify(filename='Harvey_2013.pdf', snippet='')
        self.assertEqual(type_id, 'research_article')
        self.assertGreaterEqual(conf, 0.85)

    def test_heuristic_quiz_filename(self):
        type_id, conf = heuristic_classify(filename='Quiz 3 2024.pdf', snippet='')
        self.assertEqual(type_id, 'past_exam')
        self.assertGreaterEqual(conf, 0.8)

    def test_heuristic_example_exam_solution(self):
        type_id, conf = heuristic_classify(filename='example_exam_questions_2025.pdf', snippet='')
        self.assertEqual(type_id, 'exam_solution')
        self.assertGreaterEqual(conf, 0.85)

    def test_textbook_chapter_single_pass(self):
        profile = get_file_type_profile('textbook_chapter')
        self.assertFalse(profile.pass2)

    def test_heuristic_humanities_author_title(self):
        type_id, conf = heuristic_classify(
            filename='Gupta and Ferguson, Beyond Culture.pdf',
            snippet='This essay examines culture, nation, and diaspora in Southeast Asia.',
        )
        self.assertEqual(type_id, 'humanities_reading')
        self.assertGreaterEqual(conf, 0.85)

    def test_heuristic_humanities_author_dash_title(self):
        type_id, conf = heuristic_classify(
            filename='Nguyen - Nothing Ever Dies, On Remembering Others.pdf',
            snippet='War memory and commemoration in Vietnam.',
        )
        self.assertEqual(type_id, 'humanities_reading')
        self.assertGreaterEqual(conf, 0.85)

    def test_heuristic_humanities_chapter_reading(self):
        type_id, conf = heuristic_classify(
            filename='Shah, Stranger Intimacy, Chapter 2.pdf',
            snippet='South Asian migrant labor and intimacy.',
        )
        self.assertEqual(type_id, 'humanities_reading')
        self.assertGreaterEqual(conf, 0.84)

    def test_heuristic_slide_filename_beats_syllabus_snippet(self):
        snippet = 'Course syllabus grading percent policies week 1 introduction'
        type_id, conf = heuristic_classify(
            filename='Lecture 11_auditory systems_slides.pdf',
            snippet=snippet,
        )
        self.assertEqual(type_id, 'lecture_slides')
        self.assertGreaterEqual(conf, 0.9)

    def test_heuristic_q_number_year_quiz(self):
        type_id, conf = heuristic_classify(filename='Q1 2024.pdf', snippet='')
        self.assertEqual(type_id, 'past_exam')
        self.assertGreaterEqual(conf, 0.8)

    def test_heuristic_prefixed_author_year(self):
        type_id, conf = heuristic_classify(filename='memory1_Maguire_2000.pdf', snippet='')
        self.assertEqual(type_id, 'research_article')
        self.assertGreaterEqual(conf, 0.85)

    def test_heuristic_course_topic_filename(self):
        type_id, conf = heuristic_classify(filename='NEU201_Vision.pdf', snippet='')
        self.assertEqual(type_id, 'lecture_slides')
        self.assertGreaterEqual(conf, 0.82)

    def test_heuristic_precept_problem_set(self):
        type_id, conf = heuristic_classify(filename='Precept 3_problem set 2.pdf', snippet='')
        self.assertEqual(type_id, 'problem_set')
        self.assertGreaterEqual(conf, 0.85)

    def test_heuristic_precept_link_discussion(self):
        type_id, conf = heuristic_classify(filename='precept_2.7_link.docx', snippet='')
        self.assertEqual(type_id, 'discussion_prompt')
        self.assertGreaterEqual(conf, 0.8)

    def test_heuristic_grade_curve_administrative(self):
        type_id, conf = heuristic_classify(filename='final grade curves.pdf', snippet='grade curve')
        self.assertEqual(type_id, 'administrative')
        self.assertGreaterEqual(conf, 0.85)

    def test_heuristic_explainer_filename(self):
        type_id, conf = heuristic_classify(filename='Mach Bands explained.pdf', snippet='')
        self.assertEqual(type_id, 'lecture_notes')
        self.assertGreaterEqual(conf, 0.7)

    def test_profile_skips_pass1_for_past_exam(self):
        from canvas_parser.parse.file_types import get_file_type_profile, profile_skips_llm_pass1_for_cost

        profile = get_file_type_profile('past_exam')
        self.assertTrue(profile_skips_llm_pass1_for_cost(profile))
        profile = get_file_type_profile('lecture_slides')
        self.assertFalse(profile_skips_llm_pass1_for_cost(profile))

    def test_problem_set_answer_key_filename(self):
        type_id, conf = heuristic_classify(
            filename='Problem Set 2_syn trans I and II KEY.pdf',
            snippet='',
        )
        self.assertEqual(type_id, 'exam_solution')
        self.assertGreaterEqual(conf, 0.85)

    def test_study_tips_filename_administrative(self):
        type_id, conf = heuristic_classify(filename='How to do well in NEU201-PSY258', snippet='')
        self.assertEqual(type_id, 'administrative')
        self.assertGreaterEqual(conf, 0.85)

    def test_should_skip_classify_for_typed_heuristic(self):
        from canvas_parser.parse.file_types import should_run_llm_classification

        self.assertFalse(
            should_run_llm_classification(0.72, resolved_type='lecture_notes')
        )

    def test_humanities_reading_profile_skips_outline_seed(self):
        profile = get_file_type_profile('humanities_reading')
        self.assertFalse(profile.teaching_outline)
        self.assertIn('add_concept_node', profile.pass1_tool_blocklist)


if __name__ == '__main__':
    unittest.main()
