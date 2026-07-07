"""SSH worker helpers for parse trial (local download vs remote parse)."""
from __future__ import annotations

import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class WorkerSpec:
    """Remote nucleus checkout reachable via SSH."""

    host: str
    root: str
    user: str | None = None
    ssh_options: tuple[str, ...] = ()

    @property
    def ssh_target(self) -> str:
        return f'{self.user}@{self.host}' if self.user else self.host

    @property
    def remote_root_posix(self) -> str:
        return self.root.replace('\\', '/')


_WORKER_SPEC_RE = re.compile(
    r'^(?:(?P<user>[^@]+)@)?(?P<host>[^:]+):(?P<path>.+)$'
)


def parse_worker_spec(text: str) -> WorkerSpec:
    """Parse ``user@host:/path/to/nucleus``."""
    raw = str(text or '').strip()
    if not raw:
        raise ValueError('Worker spec is empty; use user@host:/path/to/nucleus')
    match = _WORKER_SPEC_RE.match(raw)
    if not match:
        raise ValueError(
            f'Invalid worker spec {text!r}; expected user@host:/path/to/nucleus'
        )
    path = match.group('path').strip()
    if not path.startswith('/'):
        raise ValueError('Worker path must be absolute POSIX path, e.g. /home/you/nucleus')
    return WorkerSpec(
        host=match.group('host').strip(),
        root=path.rstrip('/'),
        user=(match.group('user') or '').strip() or None,
    )


def ssh_bin() -> str:
    path = shutil.which('ssh')
    if not path:
        raise RuntimeError('ssh not found on PATH — install OpenSSH client')
    return path


def scp_bin() -> str:
    path = shutil.which('scp')
    if not path:
        raise RuntimeError('scp not found on PATH — install OpenSSH client')
    return path


def _ssh_base(spec: WorkerSpec) -> list[str]:
    cmd = [ssh_bin(), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new']
    cmd.extend(spec.ssh_options)
    cmd.append(spec.ssh_target)
    return cmd


def _scp_base(spec: WorkerSpec) -> list[str]:
    cmd = [scp_bin(), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new']
    cmd.extend(spec.ssh_options)
    return cmd


def ssh_run(
    spec: WorkerSpec,
    remote_command: str,
    *,
    timeout: int | None = None,
) -> subprocess.CompletedProcess[str]:
    cmd = _ssh_base(spec) + [remote_command]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def scp_to(spec: WorkerSpec, local_path: Path, remote_path: str) -> None:
    dest = f'{spec.ssh_target}:{remote_path}'
    cmd = _scp_base(spec) + [str(local_path), dest]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f'scp to worker failed ({result.returncode}): {(result.stderr or result.stdout).strip()}'
        )


def scp_from(spec: WorkerSpec, remote_path: str, local_path: Path) -> None:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    source = f'{spec.ssh_target}:{remote_path}'
    cmd = _scp_base(spec) + [source, str(local_path)]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f'scp from worker failed ({result.returncode}): {(result.stderr or result.stdout).strip()}'
        )


def ssh_mkdir(spec: WorkerSpec, remote_dir: str) -> None:
    result = ssh_run(spec, f'mkdir -p {remote_dir}')
    if result.returncode != 0:
        raise RuntimeError(f'remote mkdir failed: {(result.stderr or result.stdout).strip()}')


def sync_canvasfiles_to_worker(
    spec: WorkerSpec,
    local_root: Path,
    file_ids: Iterable[str],
    remote_work_dir: str,
) -> float:
    """Upload ``canvasfiles/<id>`` blobs needed for inference-only parse."""
    started = time.perf_counter()
    remote_files = f'{remote_work_dir}/canvasfiles'
    ssh_mkdir(spec, remote_files)
    local_files = local_root / 'canvasfiles'
    uploaded = 0
    for file_id in sorted({str(fid).strip() for fid in file_ids if str(fid).strip()}):
        source = local_files / file_id
        if not source.is_file():
            continue
        scp_to(spec, source, f'{remote_files}/{file_id}')
        uploaded += 1
    if uploaded == 0:
        raise RuntimeError('No canvasfiles blobs found to sync — run local download prefetch first')
    return round(time.perf_counter() - started, 1)


def install_canvasfiles_on_worker(
    spec: WorkerSpec,
    local_root: Path,
    remote_work_dir: str,
) -> float:
    """Copy synced files into worker repo ``canvasfiles/``."""
    started = time.perf_counter()
    remote_repo_files = f'{spec.remote_root_posix}/canvasfiles'
    remote_staged = f'{remote_work_dir}/canvasfiles'
    cmd = (
        f'mkdir -p {remote_repo_files} && '
        f'cp -f {remote_staged}/* {remote_repo_files}/ 2>/dev/null || true'
    )
    result = ssh_run(spec, cmd)
    if result.returncode != 0:
        raise RuntimeError(f'install canvasfiles on worker failed: {(result.stderr or result.stdout).strip()}')
    return round(time.perf_counter() - started, 1)


def check_worker(spec: WorkerSpec) -> dict[str, str]:
    """Verify SSH + nucleus checkout on worker."""
    ping = ssh_run(spec, 'echo ok', timeout=30)
    if ping.returncode != 0 or 'ok' not in (ping.stdout or ''):
        raise RuntimeError(f'SSH failed: {(ping.stderr or ping.stdout).strip()}')
    probe = ssh_run(
        spec,
        f'cd {spec.remote_root_posix} && python3 -c "import pathlib; print(pathlib.Path(\'parser.py\').is_file())"',
        timeout=60,
    )
    if probe.returncode != 0 or 'True' not in (probe.stdout or ''):
        raise RuntimeError(
            f'Worker repo missing parser.py at {spec.remote_root_posix}: '
            f'{(probe.stderr or probe.stdout).strip()}'
        )
    return {
        'ssh_target': spec.ssh_target,
        'remote_root': spec.remote_root_posix,
        'status': 'ok',
    }
