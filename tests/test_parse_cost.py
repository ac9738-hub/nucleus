#!/usr/bin/env python3
"""Unit tests for DeepSeek parse cost estimation."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_cost import (  # noqa: E402
    assess_completed_model_calls,
    assess_file_parse_from_pass_records,
    assess_parse_cost,
    estimate_call_cost,
    format_cost_summary,
    normalize_usage,
)


class ParseCostTests(unittest.TestCase):
    def test_normalize_usage_assumes_cache_miss_without_split(self):
        usage = normalize_usage({'prompt_tokens': 1000, 'completion_tokens': 200})
        self.assertEqual(usage['prompt_cache_miss_tokens'], 1000)
        self.assertEqual(usage['prompt_cache_hit_tokens'], 0)

    def test_estimate_call_cost_with_cache_hit_and_miss(self):
        breakdown = estimate_call_cost({
            'prompt_cache_hit_tokens': 900_000,
            'prompt_cache_miss_tokens': 100_000,
            'completion_tokens': 50_000,
        })
        # 900k hit @ $0.0028/M = $0.00252, 100k miss @ $0.14/M = $0.014, 50k out @ $0.28/M = $0.014
        self.assertAlmostEqual(breakdown['input_cache_hit_cost_usd'], 0.00252, places=5)
        self.assertAlmostEqual(breakdown['input_cache_miss_cost_usd'], 0.014, places=5)
        self.assertAlmostEqual(breakdown['output_cost_usd'], 0.014, places=5)
        self.assertAlmostEqual(breakdown['total_cost_usd'], 0.03052, places=5)
        self.assertAlmostEqual(breakdown['cache_hit_rate'], 0.9, places=3)

    def test_assess_parse_cost_aggregates_calls(self):
        summary = assess_parse_cost([
            {
                'purpose': 'classify',
                'usage': {'prompt_tokens': 2000, 'completion_tokens': 50},
            },
            {
                'purpose': 'pass1_turn1',
                'usage': {
                    'prompt_cache_hit_tokens': 8000,
                    'prompt_cache_miss_tokens': 2000,
                    'completion_tokens': 500,
                },
            },
        ])
        self.assertEqual(summary['call_count'], 2)
        self.assertGreater(summary['total_cost_usd'], 0)
        self.assertEqual(summary['usage']['prompt_cache_hit_tokens'], 8000)
        self.assertEqual(summary['usage']['prompt_cache_miss_tokens'], 4000)

    def test_assess_file_parse_from_pass_records(self):
        summary = assess_file_parse_from_pass_records(
            [{
                'courseid': '15160',
                'fileid': '99',
                'filename': 'slides.pdf',
                'pass_index': 1,
                'turns': [{
                    'purpose': 'pass1_turn1',
                    'usage': {'prompt_tokens': 10_000, 'completion_tokens': 800},
                }],
            }],
            classification_record={
                'usage': {'prompt_tokens': 1500, 'completion_tokens': 40},
            },
        )
        self.assertEqual(summary['fileid'], '99')
        self.assertEqual(summary['call_count'], 2)
        self.assertIn('$', format_cost_summary(summary))

    def test_assess_completed_model_calls(self):
        report = assess_completed_model_calls({
            'deepseek_classifications': [{
                'courseid': '1',
                'fileid': 'a',
                'usage': {'prompt_tokens': 1000, 'completion_tokens': 30},
            }],
            'deepseek_file_passes': [{
                'courseid': '1',
                'fileid': 'a',
                'filename': 'syllabus.pdf',
                'pass_index': 1,
                'usage': {'prompt_cache_hit_tokens': 5000, 'prompt_cache_miss_tokens': 1000, 'completion_tokens': 200},
            }],
        })
        self.assertEqual(report['file_count'], 1)
        self.assertGreater(report['total_cost_usd'], 0)


if __name__ == '__main__':
    unittest.main()
