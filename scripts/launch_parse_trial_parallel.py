#!/usr/bin/env python3
"""Launch all 3 parse trial arms in separate terminal windows (Windows)."""
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
ARMS = (
    'local_download_lambda_parse',
    'lambda_download_parse',
    'local_download_parse',
)


def deploy_lambda(push_canvas: bool) -> None:
    cmd = [sys.executable, str(ROOT / 'scripts' / 'setup_aws_lambda_parse.py'), 'deploy']
    if push_canvas:
        cmd.append('--push-canvas-auth')
    print('Deploying Lambda...', flush=True)
    subprocess.run(cmd, cwd=str(ROOT), check=True)


def launch_arm(placement: str, *, benchmark_dedup: bool) -> subprocess.Popen:
    PROGRESS.mkdir(parents=True, exist_ok=True)
    log = PROGRESS / f'{placement}.json'
    cmd_parts = [
        f'cd "{ROOT}"',
        f'$host.UI.RawUI.WindowTitle = "Parse trial: {placement}"',
        f'python scripts/run_parse_trial_arm.py --placement {placement} --progress-log "{log}"',
    ]
    if benchmark_dedup:
        cmd_parts[-1] += ' --benchmark-dedup'
    ps_command = '; '.join(cmd_parts)
    return subprocess.Popen(
        [
            'powershell',
            '-NoExit',
            '-Command',
            ps_command,
        ],
        cwd=str(ROOT),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-deploy', action='store_true')
    parser.add_argument('--no-new-windows', action='store_true', help='Run in background shells instead')
    args = parser.parse_args()

    if not args.skip_deploy and not load_lambda_state(ROOT):
        deploy_lambda(push_canvas=True)
    elif not load_lambda_state(ROOT):
        print('Lambda not deployed. Run setup_aws_lambda_parse.py deploy', file=sys.stderr)
        return 1

    procs: list[tuple[str, subprocess.Popen]] = []
    for placement in ARMS:
        benchmark = placement == 'lambda_download_parse'
        if args.no_new_windows:
            log = PROGRESS / f'{placement}.json'
            cmd = [
                sys.executable,
                str(ROOT / 'scripts' / 'run_parse_trial_arm.py'),
                '--placement', placement,
                '--progress-log', str(log),
            ]
            if benchmark:
                cmd.append('--benchmark-dedup')
            proc = subprocess.Popen(cmd, cwd=str(ROOT))
        else:
            proc = launch_arm(placement, benchmark_dedup=benchmark)
        procs.append((placement, proc))
        time.sleep(1)

    manifest = {
        'launched': [{'placement': p, 'pid': proc.pid} for p, proc in procs],
        'progress_dir': str(PROGRESS),
        'arms_dir': str(CACHE / 'arms'),
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / 'parallel_launch.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')

    print('Launched 3 parse trial arms:')
    for placement, proc in procs:
        print(f'  {placement} pid={proc.pid} progress={PROGRESS / (placement + ".json")}')
    print(f'Manifest: {CACHE / "parallel_launch.json"}')
    if not args.no_new_windows:
        print('Watch progress in the 3 PowerShell windows.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
