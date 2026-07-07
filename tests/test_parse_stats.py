#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.parse_stats import (  # noqa: E402
    assess_file_efficiency,
    assess_session_efficiency,
    build_file_parse_record,
    format_file_efficiency_debug,
    format_session_efficiency_report,
)


class ParseStatsTests(unittest.TestCase):
    def test_assess_file_efficiency(self):
        cost = {
            'call_count': 2,
            'total_cost_usd': 0.01,
            'cache_hit_rate': 0.9,
            'usage': {
                'prompt_cache_hit_tokens': 9000,
                'prompt_cache_miss_tokens': 1000,
                'completion_tokens': 500,
                'total_tokens': 10500,
            },
        }
        eff = assess_file_efficiency(cost_summary=cost, runtime_ms=60000, tool_count=10, pass_count=2)
        self.assertGreater(eff['tokens_per_second'], 0)
        self.assertGreater(eff['cache_savings_usd'], 0)
        self.assertEqual(eff['cost_per_tool_usd'], 0.001)

    def test_build_file_parse_record_debug(self):
        record = build_file_parse_record(
            courseid='15160',
            fileid='1',
            filename='slides.pdf',
            cost_summary={'call_count': 1, 'total_cost_usd': 0.002, 'usage': {'prompt_tokens': 1000, 'completion_tokens': 50}},
            runtime_ms=5000,
            tool_count=3,
            pass_count=1,
        )
        debug = format_file_efficiency_debug(record)
        self.assertIn('runtime=', debug)
        self.assertIn('tools=3', debug)

    def test_assess_session_efficiency(self):
        records = [
            build_file_parse_record(
                courseid='1',
                fileid='a',
                filename='a.pdf',
                cost_summary={'call_count': 1, 'total_cost_usd': 0.01, 'usage': {'prompt_tokens': 1000, 'completion_tokens': 100}},
                runtime_ms=30000,
                tool_count=5,
            ),
            build_file_parse_record(
                courseid='1',
                fileid='b',
                filename='b.pdf',
                cost_summary={'call_count': 1, 'total_cost_usd': 0.02, 'usage': {'prompt_tokens': 2000, 'completion_tokens': 200}},
                runtime_ms=45000,
                tool_count=8,
            ),
        ]
        summary = assess_session_efficiency(
            records,
            phase_timings={'parse_llm_ms': 70000, 'pdf_io_ms': 10000},
            wall_ms=80000,
        )
        text = format_session_efficiency_report(summary)
        self.assertIn('parser efficiency report', text)
        self.assertEqual(summary['file_count'], 2)
        self.assertGreater(summary['parallel_factor'], 0.0)


if __name__ == '__main__':
    unittest.main()
