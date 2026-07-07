"""Rotating file-level parse eval with syllabus-seeded prompts."""
from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from canvas_parser.parse.concurrency_audit import audit_report
from canvas_parser.parse.parse_eval_gt import compare_file_to_gt, load_file_gt
from canvas_parser.parse.parse_eval_concurrency import DEFAULT_EVAL_CONCURRENCY


FIXTURE_ROOT = Path(__file__).resolve().parents[2] / 'fixtures' / 'parse_eval'
DEFAULT_POOL = FIXTURE_ROOT / 'pool.json'
DEFAULT_PROFILE = FIXTURE_ROOT / 'profile.json'
DEFAULT_ROTATION_STATE = Path('.cache/parse_eval/rotation_state.json')


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def load_pool(path: Path | None = None) -> dict[str, Any]:
    pool_path = path or DEFAULT_POOL
    return json.loads(pool_path.read_text(encoding='utf-8'))


def load_profile(path: Path | None = None) -> dict[str, Any]:
    profile_path = path or DEFAULT_PROFILE
    if profile_path.is_file():
        return json.loads(profile_path.read_text(encoding='utf-8'))
    return {
        'thresholds': {
            'conceptRecallMin': 0.80,
            'detailRatioMin': 0.65,
        },
        'concurrency': DEFAULT_EVAL_CONCURRENCY,
    }


def load_rotation_state(path: Path | None = None) -> dict[str, Any]:
    state_path = path or DEFAULT_ROTATION_STATE
    if state_path.is_file():
        return json.loads(state_path.read_text(encoding='utf-8'))
    return {'index': 0, 'history': [], 'lastRunAt': None}


def save_rotation_state(state: dict[str, Any], path: Path | None = None) -> Path:
    state_path = path or DEFAULT_ROTATION_STATE
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, indent=2), encoding='utf-8')
    return state_path


def pool_entries(
    pool: dict[str, Any],
    *,
    require_gt: bool = True,
    stratum: str = 'content',
) -> list[dict[str, Any]]:
    from canvas_parser.parse.parse_pass_overrides import eval_stratum

    rows = [row for row in (pool.get('files') or []) if isinstance(row, dict)]
    if stratum and stratum != 'all':
        rows = [row for row in rows if eval_stratum(row) == stratum]
    if not require_gt:
        return rows
    out: list[dict[str, Any]] = []
    root = Path(str(pool.get('root') or FIXTURE_ROOT))
    for row in rows:
        gt_rel = str(row.get('gtPath') or '')
        if not gt_rel:
            continue
        gt_path = root / gt_rel if not Path(gt_rel).is_absolute() else Path(gt_rel)
        if gt_path.is_file():
            out.append(row)
    return out


def select_rotating_entry(
    pool: dict[str, Any],
    *,
    mode: str = 'round_robin',
    seed: int | None = None,
    state: dict[str, Any] | None = None,
    require_gt: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Pick the next eval file and update rotation state."""
    entries = pool_entries(pool, require_gt=require_gt, stratum='content')
    if not entries:
        raise ValueError('Parse eval pool has no eligible files (build GT first).')
    state = dict(state or load_rotation_state())
    if mode == 'random':
        rng = random.Random(seed)
        index = rng.randrange(len(entries))
    else:
        index = int(state.get('index') or 0) % len(entries)
        state['index'] = index + 1
    entry = entries[index]
    state.setdefault('history', []).append({
        'courseId': entry.get('courseId'),
        'fileId': entry.get('fileId'),
        'filename': entry.get('filename'),
        'selectedAt': _utc_now(),
        'mode': mode,
    })
    state['history'] = state['history'][-200:]
    state['lastRunAt'] = _utc_now()
    return entry, state


def resolve_pool_path(pool: dict[str, Any], rel: str) -> Path:
    root = Path(str(pool.get('root') or FIXTURE_ROOT))
    path = Path(rel)
    if path.is_absolute():
        return path
    return root / rel


def load_syllabus_seed(pool: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    """Load pre-parsed syllabus subgraph for the entry's course."""
    rel = str(entry.get('syllabusSeedPath') or '')
    if not rel:
        course_id = str(entry.get('courseId') or '')
        rel = f'syllabi/{course_id}.json'
    path = resolve_pool_path(pool, rel)
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding='utf-8'))
    return data if isinstance(data, dict) else {}


def syllabus_prompt_context(seed: dict[str, Any], course_id: str) -> dict[str, Any]:
    """Slim syllabus payload for system prompts during eval."""
    syllabi = seed.get('syllabi') or {}
    syllabus = syllabi.get(str(course_id)) or {}
    concepts = [
        {
            'name': c.get('name'),
            'courseid': c.get('courseid'),
        }
        for c in (seed.get('concepts') or [])
        if str(c.get('courseid') or '') == str(course_id)
    ][:40]
    events = [
        {'name': e.get('name'), 'startdate': e.get('startdate'), 'type': e.get('type')}
        for e in (seed.get('events') or [])
        if str(e.get('courseid') or '') == str(course_id)
    ][:20]
    return {
        'courseId': str(course_id),
        'syllabus': syllabus,
        'syllabusConceptCount': len(concepts),
        'syllabusEventCount': len(events),
        'conceptsSample': concepts[:12],
        'eventsSample': events[:8],
    }


def build_parse_item(entry: dict[str, Any]) -> dict[str, Any]:
    file_id = str(entry.get('fileId') or '')
    return {
        'id': file_id,
        'courseid': str(entry.get('courseId') or ''),
        'name': str(entry.get('filename') or file_id),
        'url': str(entry.get('downloadUrl') or entry.get('url') or ''),
    }


def evaluate_candidate_fragment(
    fragment: dict[str, Any],
    entry: dict[str, Any],
    pool: dict[str, Any],
    *,
    concurrency: int = DEFAULT_EVAL_CONCURRENCY,
    skip_rate: float = 0.0,
) -> dict[str, Any]:
    gt_path = resolve_pool_path(pool, str(entry.get('gtPath') or ''))
    gt = load_file_gt(gt_path)
    comparison = compare_file_to_gt(fragment, gt)
    profile = load_profile()
    thresholds = profile.get('thresholds') or {}
    recall_min = float(thresholds.get('conceptRecallMin') or 0.80)
    detail_min = float(thresholds.get('detailRatioMin') or 0.65)
    comparison['passed'] = (
        comparison.get('conceptRecall', 0) >= recall_min
        and comparison.get('detailRatio', 0) >= detail_min
        and comparison.get('fileTypeMatch', True)
        and comparison.get('pass2Complete', True)
    )
    run_metrics = {
        'concurrency': concurrency,
        'conceptRecall': comparison.get('conceptRecall'),
        'detailRatio': comparison.get('detailRatio'),
        'deepseekPasses': comparison.get('deepseekPasses'),
        'expectedDeepseekPasses': comparison.get('expectedDeepseekPasses'),
        'skipRate': skip_rate,
    }
    comparison['concurrencyAudit'] = audit_report(run_metrics=run_metrics)
    comparison['syllabusAttached'] = bool(entry.get('syllabusSeedPath'))
    return comparison


def rotation_summary(pool: dict[str, Any], state: dict[str, Any] | None = None) -> dict[str, Any]:
    entries = pool_entries(pool, require_gt=False)
    with_gt = pool_entries(pool, require_gt=True, stratum='content')
    content = pool_entries(pool, require_gt=False, stratum='content')
    state = state or load_rotation_state()
    return {
        'poolVersion': pool.get('version'),
        'totalFiles': len(entries),
        'contentFiles': len(content),
        'filesWithGt': len(with_gt),
        'nextIndex': int(state.get('index') or 0) % max(1, len(with_gt)),
        'lastRunAt': state.get('lastRunAt'),
        'concurrency': pool.get('concurrency', DEFAULT_EVAL_CONCURRENCY),
    }
