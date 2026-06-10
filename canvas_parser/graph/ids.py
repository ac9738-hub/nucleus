import hashlib
import re


def _normalize_name(value):
    return re.sub(r'\s+', ' ', str(value or '').strip().casefold())


def make_stable_id(prefix, courseid, name):
    normalized = _normalize_name(name)
    raw = f"{prefix}:{courseid}:{normalized}"
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]


def legacy_node_id(name, suffix='id'):
    return f"{name}{suffix}"
