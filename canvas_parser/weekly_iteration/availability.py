"""Decide which ground-truth items are evaluable given Canvas lock/publish state."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote

from .match_utils import names_match


def csrf_token_from_cookie(cookie: str) -> str:
    for part in str(cookie or '').split(';'):
        chunk = part.strip()
        if chunk.startswith('_csrf_token='):
            return unquote(chunk.split('=', 1)[1])
    return ''


def assignment_is_unlocked(assignment: dict[str, Any]) -> bool:
    if assignment.get('workflow_state') == 'deleted':
        return False
    if assignment.get('published') is False:
        return False
    if assignment.get('locked_for_user'):
        return False
    if assignment.get('hidden_for_user'):
        return False
    availability = assignment.get('availability_status') or {}
    if isinstance(availability, dict):
        status = str(availability.get('status') or '').lower()
        if status in {'closed', 'unavailable'}:
            return False
    return True


def file_is_unlocked(file_item: dict[str, Any]) -> bool:
    if file_item.get('locked_for_user'):
        return False
    if file_item.get('hidden_for_user'):
        return False
    if file_item.get('locked'):
        return False
    if file_item.get('hidden'):
        return False
    return True


def module_is_unlocked(module: dict[str, Any]) -> bool:
    state = str(module.get('state') or '').lower()
    if state == 'locked':
        return False
    published = module.get('published')
    if published is False:
        return False
    return True


def module_item_is_unlocked(item: dict[str, Any], module: dict[str, Any] | None) -> bool:
    if module and not module_is_unlocked(module):
        return False
    if item.get('published') is False:
        return False
    return True


def _module_lookup(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(module.get('id') or ''): module for module in (snapshot.get('modules') or [])}


def _file_lookup(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for file_item in snapshot.get('files') or []:
        file_id = str(file_item.get('id') or '')
        if file_id:
            lookup[file_id] = file_item
    return lookup


def _assignment_lookup(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for assignment in snapshot.get('assignments') or []:
        assignment_id = str(assignment.get('id') or '')
        if assignment_id:
            lookup[assignment_id] = assignment
    return lookup


def _match_assignment(snapshot: dict[str, Any], name: str) -> dict[str, Any] | None:
    for assignment in snapshot.get('assignments') or []:
        if names_match(name, str(assignment.get('name') or '')):
            return assignment
    return None


def _match_file(snapshot: dict[str, Any], name: str) -> dict[str, Any] | None:
    normalized = re.sub(r'\.[^.]+$', '', str(name or '').strip())
    for file_item in snapshot.get('files') or []:
        candidates = [
            str(file_item.get('display_name') or ''),
            str(file_item.get('filename') or ''),
        ]
        for candidate in candidates:
            if not candidate:
                continue
            if names_match(name, candidate) or names_match(normalized, candidate):
                return file_item
            stem = re.sub(r'\.[^.]+$', '', candidate).strip()
            if stem and names_match(name, stem):
                return file_item
    return None


def _match_module_item(
    snapshot: dict[str, Any],
    name: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    modules = _module_lookup(snapshot)
    file_lookup = _file_lookup(snapshot)
    assignment_lookup = _assignment_lookup(snapshot)
    for module_id, items in (snapshot.get('module_items') or {}).items():
        module = modules.get(str(module_id))
        for item in items or []:
            item_type = str(item.get('type') or '').lower()
            title = str(item.get('title') or item.get('name') or '').strip()
            if item_type == 'file':
                file_item = file_lookup.get(str(item.get('content_id') or '')) or {}
                title = str(
                    file_item.get('display_name')
                    or file_item.get('filename')
                    or title
                ).strip()
            elif item_type in {'assignment', 'quiz', 'discussion'}:
                entity = assignment_lookup.get(str(item.get('content_id') or '')) or {}
                title = str(entity.get('name') or title).strip()
            if title and names_match(name, title):
                return item, module
    return None, None


def weekly_item_is_evaluable(
    snapshot: dict[str, Any],
    item_name: str,
    bucket_key: str,
) -> bool:
    """True when Canvas exposes an unlocked artifact matching this GT weekly item."""
    name = str(item_name or '').strip()
    if not name:
        return False

    if bucket_key == 'assignments':
        assignment = _match_assignment(snapshot, name)
        return bool(assignment and assignment_is_unlocked(assignment))

    if bucket_key == 'files':
        file_item = _match_file(snapshot, name)
        if file_item:
            return file_is_unlocked(file_item)
        item, module = _match_module_item(snapshot, name)
        if item:
            return module_item_is_unlocked(item, module)
        return False

    if bucket_key == 'events':
        assignment = _match_assignment(snapshot, name)
        if assignment:
            return assignment_is_unlocked(assignment)
        file_item = _match_file(snapshot, name)
        if file_item:
            return file_is_unlocked(file_item)
        item, module = _match_module_item(snapshot, name)
        if item:
            return module_item_is_unlocked(item, module)
        for module in snapshot.get('modules') or []:
            module_name = str(module.get('name') or '')
            if names_match(name, module_name) or name.lower() in module_name.lower():
                return module_is_unlocked(module)
        return False

    return False
