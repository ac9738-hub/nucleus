#!/usr/bin/env python3
"""Deploy / update / destroy AWS Lambda parse workers (concurrent per-item).

Prerequisites (you provide):
  - AWS credentials: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
  - DEEP_SEEK_API_KEY in repo .env (set on Lambda; only required secret on function)

Usage:
  pip install boto3
  python scripts/setup_aws_lambda_parse.py deploy
  python scripts/setup_aws_lambda_parse.py status
  python scripts/setup_aws_lambda_parse.py destroy

Then run trials:
  python scripts/run_parse_trial_compare.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.parse.lambda_deploy import (  # noqa: E402
    DEFAULT_FUNCTION_NAME,
    deploy_lambda,
    ensure_function_concurrency,
    get_function_concurrency,
    load_lambda_state,
    save_lambda_state,
    state_path,
)
from canvas_parser.weekly_iteration.auth import apply_env_file, load_env_file  # noqa: E402
import os

apply_env_file(ROOT / '.env')


def read_deepseek_key(root: Path) -> str:
    env = load_env_file(root / '.env')
    key = (os.getenv('DEEP_SEEK_API_KEY') or env.get('DEEP_SEEK_API_KEY') or '').strip()
    if not key:
        raise SystemExit('DEEP_SEEK_API_KEY missing in .env')
    return key


def read_canvas_env(root: Path) -> tuple[str, str]:
    env = load_env_file(root / '.env')
    cookie = (os.getenv('CANVAS_AUTH_COOKIE') or env.get('CANVAS_AUTH_COOKIE') or '').strip()
    base_url = (os.getenv('CANVAS_BASE_URL') or env.get('CANVAS_BASE_URL') or '').strip()
    return cookie, base_url


def require_boto3():
    try:
        import boto3  # noqa: F401
    except ImportError as error:
        raise SystemExit('pip install boto3') from error


def cmd_deploy(args: argparse.Namespace) -> int:
    require_boto3()
    region = args.region or os.getenv('AWS_DEFAULT_REGION') or os.getenv('AWS_REGION') or 'us-east-1'
    deepseek = read_deepseek_key(ROOT)
    cookie, base_url = read_canvas_env(ROOT)
    print(f'Deploying Lambda {args.function_name} in {region}...')
    state = deploy_lambda(
        ROOT,
        region=region,
        function_name=args.function_name,
        bucket=args.bucket,
        deepseek_key=deepseek,
        canvas_cookie=cookie if args.push_canvas_auth else '',
        canvas_base_url=base_url if args.push_canvas_auth else '',
    )
    print('Lambda deployed:')
    print(json.dumps(state.to_dict(), indent=2))
    print(f'\nState: {state_path(ROOT)}')
    print('\nRun: python scripts/run_parse_trial_compare.py')
    if not args.push_canvas_auth:
        print('Note: lambda_download_parse needs Canvas auth on Lambda — re-deploy with --push-canvas-auth')
    return 0


def cmd_status(_args: argparse.Namespace) -> int:
    require_boto3()
    import boto3

    state = load_lambda_state(ROOT)
    if not state:
        print('No Lambda worker. Run: python scripts/setup_aws_lambda_parse.py deploy')
        return 1
    lam = boto3.client('lambda', region_name=state.region)
    payload = {
        **state.to_dict(),
        'concurrency': get_function_concurrency(lam, state.function_name),
    }
    print(json.dumps(payload, indent=2))
    return 0


def cmd_concurrency(args: argparse.Namespace) -> int:
    require_boto3()
    import boto3

    state = load_lambda_state(ROOT)
    if not state:
        print('No Lambda worker. Run: python scripts/setup_aws_lambda_parse.py deploy')
        return 1
    lam = boto3.client('lambda', region_name=state.region)
    reserved = args.reserved
    if reserved is None:
        raw = os.getenv('PARSER_LAMBDA_RESERVED_CONCURRENCY', '100')
        reserved = int(raw)
    result = ensure_function_concurrency(lam, state.function_name, reserved=reserved)
    current = get_function_concurrency(lam, state.function_name)
    print(json.dumps({**result, **current}, indent=2))
    return 0 if result.get('applied') else 1


def cmd_destroy(args: argparse.Namespace) -> int:
    require_boto3()
    import boto3

    state = load_lambda_state(ROOT)
    if not state:
        print('No Lambda state file.')
        return 0
    if not args.force:
        answer = input(f"Delete Lambda {state.function_name} and empty bucket {state.bucket}? [y/N] ").strip().casefold()
        if answer not in {'y', 'yes'}:
            print('Aborted.')
            return 1
    lam = boto3.client('lambda', region_name=state.region)
    try:
        lam.delete_function(FunctionName=state.function_name)
        print(f'Deleted function {state.function_name}')
    except Exception as error:
        print(f'Function delete: {error}')
    state_path(ROOT).unlink(missing_ok=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)

    deploy = sub.add_parser('deploy', help='Build zip and deploy Lambda')
    deploy.add_argument('--region', default='')
    deploy.add_argument('--function-name', default=DEFAULT_FUNCTION_NAME)
    deploy.add_argument('--bucket', default='')
    deploy.add_argument(
        '--push-canvas-auth',
        action='store_true',
        help='Copy CANVAS_AUTH_* from local .env onto Lambda (for lambda_download_parse)',
    )
    deploy.set_defaults(func=cmd_deploy)

    sub.add_parser('status').set_defaults(func=cmd_status)

    concurrency = sub.add_parser('concurrency', help='Apply reserved concurrency on deployed Lambda')
    concurrency.add_argument('--reserved', type=int, default=None, help='Reserved concurrent executions (default: env or 100)')
    concurrency.set_defaults(func=cmd_concurrency)

    destroy = sub.add_parser('destroy', help='Delete Lambda function')
    destroy.add_argument('--force', action='store_true')
    destroy.set_defaults(func=cmd_destroy)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == '__main__':
    raise SystemExit(main())
