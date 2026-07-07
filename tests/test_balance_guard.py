#!/usr/bin/env python3
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from canvas_parser.parse.balance_guard import (  # noqa: E402
    InsufficientBalanceAbort,
    handle_balance_error,
    is_insufficient_balance_error,
    reset_balance_guard,
    should_abort_parse,
)
from canvas_parser.parse.fast_path import is_non_fatal_llm_error  # noqa: E402


class BalanceGuardTests(unittest.TestCase):
    def setUp(self):
        reset_balance_guard()
        self._env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)
        reset_balance_guard()

    def test_is_insufficient_balance_error(self):
        self.assertTrue(is_insufficient_balance_error('Error code: 402 - Insufficient Balance'))
        self.assertFalse(is_insufficient_balance_error('maximum context length exceeded'))

    def test_balance_not_non_fatal(self):
        error = 'Error code: 402 - Insufficient Balance'
        self.assertFalse(is_non_fatal_llm_error(error))

    def test_abort_on_first_strike_in_bulk_mode(self):
        os.environ['PARSER_BULK_MODE'] = '1'
        os.environ['PARSER_BALANCE_ABORT_AFTER'] = '1'
        with self.assertRaises(InsufficientBalanceAbort):
            handle_balance_error('Error code: 402 - Insufficient Balance', where='classify')

    def test_no_abort_when_disabled(self):
        os.environ['PARSER_ABORT_ON_BALANCE'] = '0'
        handle_balance_error('Error code: 402 - Insufficient Balance', where='classify')
        self.assertTrue(should_abort_parse() is False)


if __name__ == '__main__':
    unittest.main()
