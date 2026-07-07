#!/usr/bin/env python3
"""Deprecated: EC2 worker replaced by AWS Lambda. Use setup_aws_lambda_parse.py."""
from __future__ import annotations

import sys

print(
    'EC2 parse worker is deprecated.\n'
    'Use AWS Lambda instead:\n'
    '  pip install boto3\n'
    '  python scripts/setup_aws_lambda_parse.py deploy\n'
    '  python scripts/run_parse_trial_compare.py\n',
    file=sys.stderr,
)
raise SystemExit(1)
