#!/usr/bin/env python3
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.keyword_extract import (  # noqa: E402
    compress_prompt_text,
    maybe_compress_prompt_for_pass1,
    score_sentence,
    select_sentences,
    should_apply_keyword_extract,
    split_sentences,
)


class KeywordExtractTests(unittest.TestCase):
    def test_split_sentences_handles_paragraphs(self):
        text = "First sentence here. Second sentence follows.\n\nThird paragraph sentence."
        sentences = split_sentences(text)
        self.assertGreaterEqual(len(sentences), 2)

    def test_select_sentences_keeps_dates_and_headings(self):
        sentences = [
            "This course introduces many general topics in biology.",
            "The midterm exam is scheduled for March 12, 2026 in class.",
            "Students should read optional background material every week.",
            "Assignment 1 is worth 15% of the final grade.",
        ]
        selected = select_sentences(sentences, max_chars=120)
        joined = ' '.join(selected).casefold()
        self.assertIn('midterm', joined)
        self.assertIn('15%', joined)

    def test_compress_long_repetitive_prompt(self):
        filler = ' '.join(['General background information repeats here.'] * 400)
        important = 'Final exam on May 8, 2026 is worth 30% of the course grade.'
        prompt = f"[[PAGE 1 | pageid=p1 | yScroll=0 | yScrollRatio=0]]\n{important}\n\n{filler}"
        compressed, stats = compress_prompt_text(
            prompt,
            min_input_chars=1000,
            max_chars=3000,
            keep_first_page=True,
        )
        self.assertTrue(stats['compressed'])
        self.assertLess(stats['output_chars'], stats['input_chars'])
        self.assertIn('Final exam on May 8, 2026', compressed)

    def test_short_prompt_not_compressed(self):
        prompt = "Short syllabus excerpt with exam on April 2."
        compressed, stats = compress_prompt_text(prompt, min_input_chars=10_000)
        self.assertFalse(stats['compressed'])
        self.assertEqual(compressed, prompt)

    def test_academic_sentence_scores_higher(self):
        idf_map = {'exam': 2.0, 'grade': 1.5, 'biology': 1.0, 'general': 0.5}
        exam_score = score_sentence('The midterm exam counts for 20% of your grade.', idf_map)
        filler_score = score_sentence('This is general background about biology.', idf_map)
        self.assertGreater(exam_score, filler_score)

    def test_maybe_compress_disabled_by_default(self):
        with patch.dict(os.environ, {'PARSER_KEYWORD_EXTRACT': '0'}, clear=False):
            prompt = 'x' * 50_000
            output, stats = maybe_compress_prompt_for_pass1(prompt)
            self.assertEqual(output, prompt)
            self.assertEqual(stats.get('skipped'), 'disabled')

    def test_maybe_compress_auto_mode(self):
        prompt = '\n'.join([
            '[[PAGE 1 | pageid=p1 | yScroll=0 | yScrollRatio=0]]',
            'Quiz 2 on 3/15 covers chapters 4 and 5.',
            ' '.join(['Filler lecture notes without dates.'] * 800),
        ])
        env = {
            'PARSER_KEYWORD_EXTRACT': 'auto',
            'PARSER_KEYWORD_MIN_INPUT': '5000',
            'PARSER_KEYWORD_MAX_CHARS': '4000',
        }
        with patch.dict(os.environ, env, clear=False):
            self.assertTrue(should_apply_keyword_extract(len(prompt)))
            output, stats = maybe_compress_prompt_for_pass1(prompt)
            self.assertTrue(stats['compressed'])
            self.assertIn('Quiz 2 on 3/15', output)
            self.assertLess(len(output), len(prompt))


if __name__ == '__main__':
    unittest.main()
