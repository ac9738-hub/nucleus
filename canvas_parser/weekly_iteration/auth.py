"""Load Canvas auth credentials from environment / .env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CanvasAuth:
    cookie: str
    csrf: str
    base_url: str

    @property
    def is_valid(self) -> bool:
        return bool(self.cookie and self.base_url)


def _parse_env_line(line: str) -> tuple[str, str] | None:
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        return None
    key, _, raw = line.partition('=')
    key = key.strip()
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        value = value[1:-1]
        value = value.replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')
    return key, value


def load_env_file(env_path: Path) -> dict[str, str]:
    if not env_path.is_file():
        return {}
    values: dict[str, str] = {}
    for line in env_path.read_text(encoding='utf-8').splitlines():
        parsed = _parse_env_line(line)
        if parsed:
            values[parsed[0]] = parsed[1]
    return values


def load_auth_from_env(root_dir: Path | None = None) -> CanvasAuth:
    root = root_dir or Path(__file__).resolve().parents[2]
    env_values = load_env_file(root / '.env')
    return CanvasAuth(
        cookie=os.getenv('CANVAS_AUTH_COOKIE') or env_values.get('CANVAS_AUTH_COOKIE', ''),
        csrf=os.getenv('CANVAS_AUTH_CSRF') or env_values.get('CANVAS_AUTH_CSRF', ''),
        base_url=(os.getenv('CANVAS_BASE_URL') or env_values.get('CANVAS_BASE_URL', '')).rstrip('/'),
    )
