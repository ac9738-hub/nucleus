#!/usr/bin/env python3
"""Launch both Lambda parse placements with app-representative llm-fast settings."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from canvas_parser.weekly_iteration.auth import apply_env_file  # noqa: E402

apply_env_file(ROOT / '.env')

from canvas_parser.parse.lambda_deploy import load_lambda_state  # noqa: E402

CACHE = ROOT / '.cache' / 'parse_trial'
PROGRESS = CACHE / 'progress'
LAMBDA_ARMS = (
    'local_download_lambda_parse',
    'lambda_download_parse',
)


def deploy_lambda(push_canvas: bool) -> None:
    cmd = [sys.executable, str(ROOT / 'scripts' / 'setup_aws_lambda_parse.py'), 'deploy']
    if push_canvas:
        cmd.append('--push-canvas-auth')
    print('Deploying Lambda...', flush=True)
    subprocess.run(cmd, cwd=str(ROOT), check=True)


def launch_arm(placement: str, *, courses: list[int] | None) -> subprocess.Popen:
    PROGRESS.mkdir(parents=True, exist_ok=True)
    log = PROGRESS / f'production_{placement}.json'
    course_args = ''
    if courses:
        course_args = ' --courses ' + ' '.join(str(course_id) for course_id in courses)
    ps_command = '; '.join([
        f'cd "{ROOT}"',
        f'$host.UI.RawUI.WindowTitle = "Production parse: {placement}"',
        (
            f'python scripts/run_parse_trial_arm.py --production --from-canvas-data '
            f'--placement {placement} --progress-log "{log}"{course_args}'
        ),
    ])
    return subprocess.Popen(
        ['powershell', '-NoExit', '-Command', ps_command],
        cwd=str(ROOT),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-deploy', action='store_true')
    parser.add_argument('--no-new-windows', action='store_true')
    parser.add_argument('--courses', type=int, nargs='*', default=None)
    args = parser.parse_args()

    if not args.skip_deploy:
        deploy_lambda(push_canvas=True)
    elif not load_lambda_state(ROOT):
        print('Lambda not deployed. Run setup_aws_lambda_parse.py deploy', file=sys.stderr)
        return 1

    procs: list[tuple[str, subprocess.Popen]] = []
    for placement in LAMBDA_ARMS:
        if args.no_new_windows:
            log = PROGRESS / f'production_{placement}.json'
            cmd = [
                sys.executable,
                str(ROOT / 'scripts' / 'run_parse_trial_arm.py'),
                '--production',
                '--from-canvas-data',
                '--placement', placement,
                '--progress-log', str(log),
            ]
            if args.courses:
                cmd.extend(['--courses', *[str(course_id) for course_id in args.courses]])
            proc = subprocess.Popen(cmd, cwd=str(ROOT))
        else:
            proc = launch_arm(placement, courses=args.courses)
        procs.append((placement, proc))
        time.sleep(1)

    manifest = {
        'scope': 'production_llm_fast',
        'launched': [{'placement': p, 'pid': proc.pid} for p, proc in procs],
        'progress_dir': str(PROGRESS),
        'arms_dir': str(CACHE / 'arms'),
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / 'production_lambda_launch.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')

    print('Launched 2 production Lambda parse arms (llm-fast, 8-course canvas_data):')
    for placement, proc in procs:
        print(f'  {placement} pid={proc.pid} progress={PROGRESS / ("production_" + placement + ".json")}')
    print(f'Manifest: {CACHE / "production_lambda_launch.json"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
