"""AWS EC2 helpers for the Nucleus parse trial worker."""
from __future__ import annotations

import json
import socket
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class WorkerState:
    instance_id: str
    public_ip: str
    region: str
    worker_spec: str
    ssh_user: str = 'ubuntu'
    remote_root: str = '/home/ubuntu/nucleus'

    def to_dict(self) -> dict[str, Any]:
        return {
            'instance_id': self.instance_id,
            'public_ip': self.public_ip,
            'region': self.region,
            'worker_spec': self.worker_spec,
            'ssh_user': self.ssh_user,
            'remote_root': self.remote_root,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorkerState:
        return cls(
            instance_id=str(data['instance_id']),
            public_ip=str(data['public_ip']),
            region=str(data.get('region') or 'us-east-1'),
            worker_spec=str(data['worker_spec']),
            ssh_user=str(data.get('ssh_user') or 'ubuntu'),
            remote_root=str(data.get('remote_root') or '/home/ubuntu/nucleus'),
        )


def state_path(root: Path) -> Path:
    return root / '.cache' / 'parse_trial' / 'aws_worker.json'


def load_worker_state(root: Path) -> WorkerState | None:
    path = state_path(root)
    if not path.is_file():
        return None
    return WorkerState.from_dict(json.loads(path.read_text(encoding='utf-8')))


def save_worker_state(root: Path, state: WorkerState) -> Path:
    path = state_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state.to_dict(), indent=2), encoding='utf-8')
    return path


def caller_public_ip() -> str:
    for url in ('https://checkip.amazonaws.com', 'https://api.ipify.org'):
        try:
            with urllib.request.urlopen(url, timeout=8) as response:
                ip = response.read().decode('utf-8').strip()
                if ip:
                    return ip
        except OSError:
            continue
    raise RuntimeError('Could not detect your public IP for SSH security group rule')


def wait_for_port(host: str, port: int, *, timeout_sec: int = 300) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=3):
                return
        except OSError:
            time.sleep(3)
    raise TimeoutError(f'Timed out waiting for {host}:{port}')


def ubuntu_2204_ami(ec2, region: str) -> str:
    response = ec2.describe_images(
        Owners=['099720109477'],
        Filters=[
            {'Name': 'name', 'Values': ['ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*']},
            {'Name': 'state', 'Values': ['available']},
            {'Name': 'architecture', 'Values': ['x86_64']},
        ],
    )
    images = sorted(response.get('Images') or [], key=lambda row: row.get('CreationDate', ''), reverse=True)
    if not images:
        raise RuntimeError(f'No Ubuntu 22.04 AMI found in {region}')
    return images[0]['ImageId']
