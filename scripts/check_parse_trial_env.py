#!/usr/bin/env python3
"""Verify env for Lambda parse trial (no secrets printed)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.lambda_deploy import load_lambda_state  # noqa: E402
from canvas_parser.parse.balance_guard import load_deepseek_api_key  # noqa: E402
from canvas_parser.weekly_iteration.auth import load_auth_from_env, load_env_file  # noqa: E402
import os


def main() -> int:
    env = load_env_file(ROOT / '.env')
    ok = True

    def check(name: str, *, required: bool = True) -> bool:
        value = (os.getenv(name) or env.get(name) or '').strip()
        present = bool(value)
        status = 'ok' if present else ('MISSING' if required else 'optional')
        print(f'  {name}: {status}')
        return present or not required

    print('Parse trial environment:')
    ok &= check('DEEP_SEEK_API_KEY')
    ok &= check('CANVAS_AUTH_COOKIE')
    ok &= check('CANVAS_BASE_URL')
    check('CANVAS_AUTH_CSRF', required=False)
    ok &= check('AWS_ACCESS_KEY_ID')
    ok &= check('AWS_SECRET_ACCESS_KEY')
    check('AWS_DEFAULT_REGION', required=False)

    auth = load_auth_from_env(ROOT)
    print(f'  Canvas auth valid: {auth.is_valid}')

    try:
        import boto3  # noqa: F401
        print('  boto3: ok')
    except ImportError:
        print('  boto3: MISSING (pip install boto3)')
        ok = False

    if load_deepseek_api_key(ROOT):
        print('  DeepSeek key loads: ok')
    else:
        ok = False

    worker = load_lambda_state(ROOT)
    if worker:
        print(f'  Lambda deployed: {worker.function_name} ({worker.region})')
    else:
        print('  Lambda deployed: no (run setup_aws_lambda_parse.py deploy)')

    if not ok:
        print('\nFix MISSING items in .env, then:')
        print('  python scripts/setup_aws_lambda_parse.py deploy')
        return 1
    if not worker:
        print('\nReady to deploy:')
        print('  python scripts/setup_aws_lambda_parse.py deploy')
        return 0
    print('\nReady to run trial:')
    print('  python scripts/run_parse_trial_compare.py')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
