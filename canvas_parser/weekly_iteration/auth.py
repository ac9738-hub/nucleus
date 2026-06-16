"""Load Canvas auth credentials from environment / .env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .students import StudentProfile, get_profile, primary_profile


@dataclass(frozen=True)
class CanvasAuth:
    cookie: str
    csrf: str
    base_url: str
    profile: str = 'primary'

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


def _env_value(name: str, env_values: dict[str, str], fallback_names: tuple[str, ...] = ()) -> str:
    value = os.getenv(name) or env_values.get(name, '')
    if value:
        return value
    for fallback in fallback_names:
        value = os.getenv(fallback) or env_values.get(fallback, '')
        if value:
            return value
    return ''


def load_auth_for_profile(root_dir: Path, profile: StudentProfile) -> CanvasAuth:
    env_values = load_env_file(root_dir / '.env')
    primary = primary_profile(root_dir)
    base_url = _env_value(
        profile.base_url_env,
        env_values,
        fallback_names=(primary.base_url_env,),
    ).rstrip('/')
    return CanvasAuth(
        cookie=_env_value(profile.auth_cookie_env, env_values),
        csrf=_env_value(profile.auth_csrf_env, env_values),
        base_url=base_url,
        profile=profile.name,
    )


def load_auth_from_env(root_dir: Path | None = None, *, profile: str = 'primary') -> CanvasAuth:
    root = root_dir or Path(__file__).resolve().parents[2]
    return load_auth_for_profile(root, get_profile(root, profile))
