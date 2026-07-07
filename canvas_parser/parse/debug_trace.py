"""Interactive parse debugger — checkpoints with prompts, tools, and graph snapshots."""
from __future__ import annotations

import asyncio
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from canvas_parser.parse.parse_cost import (
    DEFAULT_MODEL,
    assess_parse_cost,
    estimate_call_cost,
    format_cost_summary,
    normalize_usage,
)


def _usage_from_payload(payload: dict[str, Any]) -> dict[str, int]:
    usage = payload.get('usage')
    if usage:
        return normalize_usage(usage)
    cost = payload.get('cost')
    if isinstance(cost, dict) and cost.get('usage'):
        return normalize_usage(cost['usage'])
    return normalize_usage({})


def analyze_step_cost(step_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """
    Price analysis for one checkpoint.

    Incremental steps (each API call) count toward session cumulative.
    Pass-end rollups display pass totals without double-counting turn costs.
    """
    payload = payload or {}
    cost_blob = payload.get('cost')
    model = str(payload.get('model') or DEFAULT_MODEL)

    if isinstance(cost_blob, dict) and cost_blob.get('rollup'):
        summary = assess_parse_cost([
            {
                'purpose': str(cost_blob.get('purpose') or step_id),
                'model': model,
                'usage': cost_blob.get('usage') or _usage_from_payload(payload),
            }
        ])
        return {
            'kind': 'rollup',
            'increment_usd': 0.0,
            'step_usd': float(summary['total_cost_usd']),
            'usage': summary['usage'],
            'cache_hit_rate': summary['cache_hit_rate'],
            'display': f"pass total {format_cost_summary(summary)}",
            'detail': summary,
        }

    if isinstance(cost_blob, dict) and cost_blob.get('total_cost_usd') is not None:
        summary = dict(cost_blob)
        increment = float(summary.get('increment_usd', summary.get('total_cost_usd', 0.0)))
        usage = normalize_usage(summary.get('usage'))
        return {
            'kind': 'summary',
            'increment_usd': increment,
            'step_usd': float(summary.get('total_cost_usd', increment)),
            'usage': usage,
            'cache_hit_rate': float(summary.get('cache_hit_rate') or 0.0),
            'display': format_cost_summary(summary),
            'detail': summary,
        }

    usage = _usage_from_payload(payload)
    if not usage.get('total_tokens'):
        if step_id.endswith('_request') or step_id.endswith('_pass_start'):
            return {
                'kind': 'pending',
                'increment_usd': 0.0,
                'step_usd': 0.0,
                'usage': usage,
                'cache_hit_rate': 0.0,
                'display': 'pending — cost after API call',
                'detail': None,
            }
        return None

    breakdown = estimate_call_cost(usage, model=model)
    return {
        'kind': 'call',
        'increment_usd': float(breakdown['total_cost_usd']),
        'step_usd': float(breakdown['total_cost_usd']),
        'usage': breakdown['usage'],
        'cache_hit_rate': float(breakdown['cache_hit_rate']),
        'display': format_cost_summary({
            'usage': breakdown['usage'],
            'total_cost_usd': breakdown['total_cost_usd'],
            'cache_hit_rate': breakdown['cache_hit_rate'],
        }),
        'detail': breakdown,
    }


_FILE_STEP_RE = re.compile(r'^file_(\d+)_(.+)$')


def normalize_step_id(step_id: str) -> str:
    """Strip file scope prefix from debug checkpoint ids."""
    match = _FILE_STEP_RE.match(step_id)
    return match.group(2) if match else step_id


def file_id_from_step_id(step_id: str) -> str:
    match = _FILE_STEP_RE.match(step_id)
    return match.group(1) if match else ''


def scoped_step_id(step_id: str, payload: dict[str, Any] | None) -> str:
    """Prefix checkpoint ids with file id so concurrent file parses stay distinct."""
    if os.getenv('PARSER_DEBUG_SESSION') != '1':
        return step_id
    payload = payload or {}
    file_id = str(payload.get('file_id') or '').strip()
    if not file_id:
        item = payload.get('item') or {}
        file_id = str(item.get('id') or '').strip()
    if not file_id:
        return step_id
    prefix = f'file_{file_id}_'
    if step_id.startswith(prefix):
        return step_id
    return f'{prefix}{step_id}'


def _file_label(payload: dict[str, Any]) -> str:
    item = payload.get('item') or {}
    return str(
        payload.get('filename')
        or item.get('name')
        or payload.get('file_id')
        or ''
    ).strip()


def _cost_suffix(cost: dict[str, Any] | None) -> str:
    if not cost:
        return ''
    display = str(cost.get('display') or '').strip()
    if not display:
        return ''
    if cost.get('kind') == 'pending':
        return f' · {display}'
    if cost.get('kind') == 'rollup':
        return f' · {display}'
    usd = float(cost.get('step_usd') or 0.0)
    if usd <= 0 and cost.get('kind') != 'pending':
        return ''
    return f' · {display}'


def describe_step(step_id: str, payload: dict[str, Any] | None = None) -> str:
    """Short human-readable line for UI step list and status bar."""
    payload = payload or {}
    phase = str(payload.get('phase') or '')
    file_prefix = ''
    file_name = _file_label(payload)
    if file_name:
        file_prefix = f'{file_name} — '
    elif file_id_from_step_id(step_id):
        file_prefix = f'file {file_id_from_step_id(step_id)} — '

    base = normalize_step_id(step_id)

    if step_id == 'session_start':
        if payload.get('pipeline_mode') == 'full_course':
            n = payload.get('file_items_planned', 0)
            conc = int(payload.get('file_concurrency') or 4)
            text = (
                f'Full course pipeline — {n} file(s), '
                f'{conc} concurrent (inspect each pass per file)'
            )
        else:
            name = (payload.get('target') or {}).get('name') or 'selected file'
            text = f'Single-file pipeline for: {name}'
    elif step_id == 'syllabus_discover_phase':
        n = payload.get('candidate_count', 0)
        text = f'Scanning {n} syllabus PDF candidate(s) — download + classify each'
    elif step_id == 'syllabus_discover_candidate':
        item = payload.get('item') or {}
        verdict = 'syllabus' if payload.get('is_syllabus') else 'not syllabus'
        text = f'{item.get("name") or "file"} → {verdict} ({payload.get("type_id", "?")})'
    elif step_id == 'syllabus_reconcile_start':
        text = 'Multiple syllabi found — picking canonical primary (LLM if needed)'
    elif step_id == 'syllabus_discover_done':
        n = len(payload.get('syllabus_items') or [])
        text = f'Syllabus discovery complete — {n} syllabus source(s) locked'
    elif step_id == 'syllabus_parse_phase':
        text = f'Syllabus parse phase — {payload.get("count", 0)} item(s)'
    elif step_id == 'syllabus_parse_done':
        text = 'Syllabus parse complete'
    elif base.endswith('_item_start'):
        item = payload.get('item') or {}
        text = f'{file_prefix}Starting {phase.replace("_", " ")}: {item.get("name") or item.get("id")}'
    elif base.endswith('_item_done'):
        meta = payload.get('meta') or {}
        ms = meta.get('elapsed_ms')
        passes = meta.get('deepseek_passes', 0)
        tail = f' — {passes} LLM pass(es), {ms}ms' if ms else ''
        text = f'{file_prefix}Finished {phase.replace("_", " ")}{tail}'
    elif step_id == 'deterministic_phase':
        text = f'Seeding graph from {payload.get("count", 0)} assignments/pages/modules (no LLM)'
    elif step_id == 'deterministic_done':
        g = payload.get('graph') or {}
        text = (
            f'Deterministic seed done — {g.get("concept_count", 0)} concepts, '
            f'{g.get("file_node_count", 0)} files'
        )
    elif step_id == 'file_parse_phase':
        conc = payload.get('file_concurrency', 1)
        text = (
            f'Concurrent file parse — {payload.get("count", 0)} file(s), '
            f'{conc} at a time'
        )
    elif step_id == 'pre_file_parse':
        n = payload.get('count', 0)
        conc = payload.get('file_concurrency', 4)
        text = (
            f'Ready for batched file passes — {n} file(s), '
            f'all files run pass 1 together then pass 2 ({conc} concurrent)'
        )
    elif step_id == 'file_pass1_phase':
        text = (
            f'Pass 1 phase — {payload.get("count", 0)} file(s) will parse together'
        )
    elif step_id == 'file_pass1_done':
        text = f'Pass 1 complete for {payload.get("count", 0)} file(s)'
    elif step_id == 'file_pass2_phase':
        text = (
            f'Pass 2 phase — {payload.get("count", 0)} file(s) '
            f'({payload.get("skipped_pass2", 0)} skipped after pass 1)'
        )
    elif step_id == 'file_pass2_done':
        text = f'Pass 2 complete for {payload.get("count", 0)} file(s)'
    elif step_id == 'file_parse_skipped':
        text = f'No files to parse — {payload.get("reason", "skipped")}'
    elif step_id == 'target_file_start':
        item = payload.get('item') or {}
        text = f'Downloading + parsing your file: {item.get("name") or item.get("id")}'
    elif step_id == 'target_file_done':
        text = 'Target file parse complete'
    elif base == 'download_done':
        text = (
            f'{file_prefix}Downloaded {payload.get("filename") or "file"} — '
            f'{payload.get("page_count", 0)} pages, {payload.get("text_chars", 0)} chars'
        )
    elif base == 'classify_request':
        text = f'{file_prefix}LLM classifying file type (heuristic: {payload.get("heuristic_type", "?")})'
    elif base == 'classify_done':
        text = (
            f'{file_prefix}Type: {payload.get("resolved_type")} '
            f'({float(payload.get("confidence") or 0):.0%} confidence)'
        )
    elif base.endswith('_pass_start'):
        tools = payload.get('tools') or []
        pass_name = str(payload.get('phase') or base.replace('_pass_start', ''))
        text = f'{file_prefix}{pass_name} starting — {len(tools)} tools available'
    elif base.endswith('_request'):
        turn = payload.get('turn', '?')
        text = f'{file_prefix}LLM turn {turn} — review prompts/messages, then Proceed to call API'
    elif base.endswith('_response'):
        tools = payload.get('tool_calls') or []
        names = ', '.join(t.get('name') or '?' for t in tools[:4])
        extra = f' +{len(tools) - 4} more' if len(tools) > 4 else ''
        text = (
            f'{file_prefix}Turn result — {len(tools)} tool call(s): {names}{extra}' if tools
            else f'{file_prefix}Turn result — model returned text only'
        )
    elif base.endswith('_pass_end'):
        pass_name = str(payload.get('phase') or base.replace('_pass_end', ''))
        text = (
            f'{file_prefix}{pass_name} finished — {payload.get("tool_count", 0)} tools, '
            f'{payload.get("turn_count", 0)} turn(s)'
        )
    elif step_id == 'syllabus_final_phase':
        text = f'Final syllabus reconciliation on {payload.get("filename") or "syllabus"}'
    elif step_id == 'syllabus_final_start':
        text = f'Final syllabus reconciliation on {payload.get("filename") or "syllabus"}'
    elif step_id == 'syllabus_final_done':
        g = payload.get('graph') or {}
        text = f'Syllabus final pass done — {g.get("event_count", 0)} events in graph'
    elif step_id == 'session_done':
        text = 'Pipeline complete'
    elif base.endswith('_skipped'):
        text = f'Skipped: {payload.get("reason", "unknown")}'
    else:
        text = step_id.replace('_', ' ')

    return text + _cost_suffix(analyze_step_cost(step_id, payload))


def waiting_hint(step_id: str, payload: dict[str, Any] | None = None) -> str:
    """What Proceed will do next."""
    if step_id == 'session_start':
        return 'Click Proceed to start syllabus discovery.'
    if step_id == 'syllabus_discover_phase':
        return 'Click Proceed to run syllabus discovery (runs through without further pauses).'
    if step_id == 'syllabus_discover_done':
        return 'Click Proceed to start syllabus parse phase.'
    if step_id == 'syllabus_parse_phase':
        return 'Click Proceed to LLM-parse all syllabus items.'
    if step_id == 'syllabus_parse_done':
        return 'Click Proceed to continue to deterministic seeding (if any).'
    if step_id == 'deterministic_phase':
        return 'Click Proceed to run deterministic seed (may take several minutes).'
    if step_id == 'deterministic_done':
        return 'Click Proceed to review the file queue and start batched passes.'
    if step_id == 'pre_file_parse':
        return 'Click Proceed to prepare all files, then run pass 1 on every file together.'
    if step_id == 'file_pass1_phase':
        return 'Click Proceed to run pass 1 on all files concurrently.'
    if step_id == 'file_pass1_done':
        return 'Click Proceed to run pass 2 on all eligible files together.'
    if step_id == 'file_pass2_phase':
        return 'Click Proceed to run pass 2 on all eligible files concurrently.'
    if step_id == 'file_pass2_done':
        return 'Click Proceed to run the final syllabus reconciliation pass.'
    if step_id == 'syllabus_final_phase':
        return 'Click Proceed to run the syllabus final LLM pass.'
    if step_id == 'syllabus_final_done':
        return 'Click Proceed to finish the session.'
    return 'Click Proceed to continue to the next phase.'


def _json_safe(value: Any, *, max_str: int = 400_000) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        if len(value) > max_str:
            return value[:max_str] + f'\n… [truncated {len(value) - max_str} chars]'
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v, max_str=max_str) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v, max_str=max_str) for v in value]
    return str(value)


def _tool_names(tools: list[dict] | None) -> list[str]:
    names: list[str] = []
    for tool in tools or []:
        fn = (tool or {}).get('function') or {}
        name = fn.get('name')
        if name:
            names.append(str(name))
    return names


def serialize_messages(messages: list[dict] | None) -> list[dict]:
    rows: list[dict] = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        row: dict[str, Any] = {'role': msg.get('role')}
        content = msg.get('content')
        if content is not None:
            row['content'] = content
        if msg.get('tool_calls'):
            row['tool_calls'] = [
                {
                    'name': tc.get('function', {}).get('name'),
                    'arguments': tc.get('function', {}).get('arguments'),
                }
                for tc in msg['tool_calls']
            ]
        if msg.get('tool_call_id'):
            row['tool_call_id'] = msg.get('tool_call_id')
        rows.append(_json_safe(row))
    return rows


_ACTIVE_TRACE: DebugTrace | None = None

PHASE_PAUSE_STEPS = frozenset({
    'session_start',
    'syllabus_discover_phase',
    'syllabus_discover_done',
    'syllabus_parse_phase',
    'syllabus_parse_done',
    'deterministic_phase',
    'deterministic_done',
    'pre_file_parse',
    'file_pass1_phase',
    'file_pass1_done',
    'file_pass2_phase',
    'file_pass2_done',
    'syllabus_final_phase',
    'syllabus_final_done',
    'session_done',
})


def get_active_trace() -> DebugTrace | None:
    return _ACTIVE_TRACE


def set_active_trace(trace: DebugTrace | None) -> None:
    global _ACTIVE_TRACE
    _ACTIVE_TRACE = trace


@dataclass
class DebugTrace:
    """Collects checkpoints; blocks on proceed when pause_mode matches."""

    session_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    pause_mode: str = 'phase'  # turn | pass | phase
    steps: list[dict[str, Any]] = field(default_factory=list)
    status: str = 'idle'  # idle | running | waiting | done | error
    activity: str = ''
    activity_log: list[dict[str, Any]] = field(default_factory=list)
    error: str = ''
    _proceed: threading.Event = field(default_factory=threading.Event)
    _checkpoint_gate: asyncio.Lock | None = field(default=None, repr=False)
    _on_update: Callable[[], None] | None = None

    def __post_init__(self) -> None:
        self._proceed.set()

    def _gate(self) -> asyncio.Lock:
        if self._checkpoint_gate is None:
            self._checkpoint_gate = asyncio.Lock()
        return self._checkpoint_gate

    def set_on_update(self, callback: Callable[[], None] | None) -> None:
        self._on_update = callback

    def _notify(self) -> None:
        if self._on_update:
            self._on_update()

    def set_activity(self, message: str, *, level: str = 'info') -> None:
        text = str(message or '')
        self.activity = text
        if text:
            self.activity_log.append({
                'ts': time.time(),
                'message': text,
                'level': level,
            })
            if len(self.activity_log) > 80:
                self.activity_log = self.activity_log[-80:]
        self._notify()

    def proceed(self) -> None:
        self._proceed.set()

    def _should_pause(self, step_id: str) -> bool:
        base = normalize_step_id(step_id)
        if self.pause_mode == 'phase':
            return base in PHASE_PAUSE_STEPS or step_id in PHASE_PAUSE_STEPS
        if self.pause_mode == 'pass':
            return (
                base.endswith('_pass_start')
                or base.endswith('_pass_end')
                or base in PHASE_PAUSE_STEPS
                or step_id in PHASE_PAUSE_STEPS
            )
        # turn — pause on every checkpoint unless phase-only env suppresses
        if os.getenv('PARSER_DEBUG_PHASE_ONLY') == '1':
            return base in PHASE_PAUSE_STEPS or step_id in PHASE_PAUSE_STEPS
        return True

    async def checkpoint(
        self,
        step_id: str,
        payload: dict[str, Any] | None = None,
        *,
        pause: bool | None = None,
    ) -> None:
        step_id = scoped_step_id(step_id, payload)
        safe_payload = _json_safe(payload or {})
        cost = analyze_step_cost(step_id, payload or {})
        record: dict[str, Any] = {
            'id': step_id,
            'ts': time.time(),
            'subline': describe_step(step_id, payload),
            'payload': safe_payload,
        }
        if cost:
            record['cost'] = _json_safe(cost)
        self.steps.append(record)
        self.set_activity(f'Checkpoint: {record["subline"]}', level='step')
        should_pause = self._should_pause(step_id) if pause is None else pause
        if should_pause:
            async with self._gate():
                self.status = 'waiting'
                self._proceed.clear()
                self.set_activity(waiting_hint(step_id, payload or {}), level='pause')
                self._notify()
                while not self._proceed.is_set():
                    await asyncio.sleep(0.05)
                self.status = 'running'
                self._notify()

    def session_cost_summary(self) -> dict[str, Any]:
        api_calls = []
        for step in self.steps:
            cost = step.get('cost')
            if not cost:
                continue
            increment = float(cost.get('increment_usd') or 0.0)
            if increment <= 0:
                continue
            api_calls.append({
                'purpose': step.get('id'),
                'usage': cost.get('usage'),
            })
        summary = assess_parse_cost(api_calls)
        summary['display'] = format_cost_summary(summary)
        summary['billed_steps'] = len(api_calls)
        return summary

    def snapshot(self, *, light: bool = False, step_index: int | None = None) -> dict[str, Any]:
        steps = self.steps
        last = steps[-1] if steps else None
        waiting_for = None
        if self.status == 'waiting' and last:
            waiting_for = {
                'step_id': last['id'],
                'subline': last.get('subline') or describe_step(last['id'], last.get('payload')),
                'hint': waiting_hint(last['id'], last.get('payload')),
            }
        base = {
            'session_id': self.session_id,
            'pause_mode': self.pause_mode,
            'status': self.status,
            'activity': self.activity,
            'activity_log': self.activity_log[-12:],
            'waiting_for': waiting_for,
            'error': self.error,
            'step_count': len(steps),
            'cost_summary': self.session_cost_summary(),
        }
        if light:
            step_rows = []
            for i, s in enumerate(steps):
                row: dict[str, Any] = {
                    'id': s['id'],
                    'ts': s['ts'],
                    'subline': s.get('subline') or describe_step(s['id'], s.get('payload')),
                    'cost': s.get('cost'),
                }
                if step_index is not None and i == step_index:
                    row['payload'] = s.get('payload')
                step_rows.append(row)
            payload_steps = steps
            if step_index is not None and 0 <= step_index < len(steps):
                payload_steps = [steps[step_index]]
            elif steps:
                payload_steps = [steps[-1]]
            else:
                payload_steps = []
            return {
                **base,
                'steps': step_rows,
                'step_detail': payload_steps[0] if payload_steps else None,
            }
        return {
            **base,
            'steps': steps,
        }


def tool_names(tools: list[dict] | None) -> list[str]:
    return _tool_names(tools)


def serialize_tool_results(executed: list) -> list[dict]:
    rows: list[dict] = []
    for pair in executed or []:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        tool_call, result = pair
        fn = getattr(tool_call, 'function', None)
        rows.append({
            'name': getattr(fn, 'name', ''),
            'arguments': getattr(fn, 'arguments', ''),
            'result': _json_safe(result),
        })
    return rows


async def trace_activity(message: str) -> None:
    trace = get_active_trace()
    if trace is not None:
        trace.set_activity(message)


async def trace_checkpoint(
    step_id: str,
    payload: dict[str, Any] | None = None,
    *,
    pause: bool | None = None,
) -> None:
    trace = get_active_trace()
    if trace is None:
        return
    if pause is None and os.getenv('PARSER_DEBUG_PHASE_ONLY') == '1':
        pause = False
    await trace.checkpoint(step_id, payload, pause=pause)


def graph_debug_snapshot(course_id: str) -> dict[str, Any]:
    """Lightweight in-memory graph summary for the debugger UI."""
    import parser as parser_mod

    cid = str(course_id or '')
    concepts = [
        {'name': c.name, 'id': c.conceptid, 'details': len(c.details), 'examples': len(c.examples)}
        for c in (parser_mod.conceptNodes.get(cid) or [])
    ]
    events = [
        {'name': e.name, 'start': e.startdate}
        for e in (parser_mod.eventNodes.get(cid) or [])
    ]
    problems = len(parser_mod.problems.get(cid) or [])
    logged_details = len((parser_mod.logged_details.get(cid) or []))
    file_nodes = parser_mod.fileNodes.get(cid, {}) or {}
    syllabus = parser_mod.syllabusNodes.get(cid)
    return {
        'concepts': concepts[:80],
        'concept_count': len(concepts),
        'events': events[:40],
        'event_count': len(events),
        'problems': problems,
        'logged_details': logged_details,
        'file_node_count': len(file_nodes),
        'has_syllabus_node': bool(syllabus),
        'assignment_count': len(getattr(syllabus, 'assignments', None) or []) if syllabus else 0,
    }


def _trim_embedded_field(data: dict[str, Any]) -> None:
    embedded = data.get('embedded')
    if not isinstance(embedded, dict):
        return
    if len(str(embedded)) > 20_000:
        data['embedded'] = {'_truncated': True, 'keys': list(embedded.keys())}


def _file_node_debug_dict(node: Any) -> dict[str, Any]:
    if not node:
        return {}
    data = node.to_dict() if hasattr(node, 'to_dict') else dict(node)
    pages = list(data.get('pages') or [])
    data['page_count'] = len(pages)
    preview_rows: list[dict[str, Any]] = []
    for index, page in enumerate(pages[:3]):
        text = page.get('text') if isinstance(page, dict) else str(page)
        preview_rows.append({'page': index + 1, 'text': str(text or '')[:1200]})
    data['pages_preview'] = preview_rows
    data.pop('pages', None)
    chunks = list(data.get('textChunks') or [])
    data['text_chunk_count'] = len(chunks)
    data.pop('textChunks', None)
    _trim_embedded_field(data)
    return data


def course_graph_snapshot(course_id: str, *, file_id: str | None = None) -> dict[str, Any]:
    """Full in-memory course graph for debugger (trimmed PDF pages / embeddings)."""
    import parser as parser_mod

    cid = str(course_id or '')
    syllabus = parser_mod.syllabusNodes.get(cid)
    file_map = parser_mod.fileNodes.get(cid, {}) or {}
    file_nodes = sorted(
        [_file_node_debug_dict(node) for node in file_map.values()],
        key=lambda row: str(row.get('name') or '').casefold(),
    )
    concept_nodes = []
    for concept in parser_mod.conceptNodes.get(cid) or []:
        row = concept.to_dict()
        _trim_embedded_field(row)
        concept_nodes.append(row)
    event_nodes = [event.to_dict() for event in (parser_mod.eventNodes.get(cid) or [])]
    assignment_nodes = [
        assignment.to_dict()
        for assignment in (getattr(syllabus, 'assignments', None) or [])
    ] if syllabus else []
    problem_nodes = [
        problem.to_dict() if hasattr(problem, 'to_dict') else problem
        for problem in (parser_mod.problems.get(cid) or [])
    ]
    logged_details = list(parser_mod.logged_details.get(cid) or [])

    snapshot = {
        'course_id': cid,
        'summary': graph_debug_snapshot(cid),
        'syllabus_node': syllabus.to_dict() if syllabus else None,
        'file_nodes': file_nodes,
        'concept_nodes': concept_nodes,
        'event_nodes': event_nodes,
        'assignment_nodes': assignment_nodes,
        'problem_nodes': problem_nodes,
        'logged_details': logged_details[:120],
    }
    if file_id:
        fid = str(file_id)
        snapshot['parsed_file_node'] = next(
            (row for row in file_nodes if str(row.get('fileid')) == fid),
            None,
        )
    return snapshot


def graph_payload_for_checkpoint(
    course_id: str,
    *,
    full: bool = False,
    file_id: str | None = None,
) -> dict[str, Any]:
    """Build graph fields attached to debug checkpoints."""
    payload = {'graph': graph_debug_snapshot(course_id)}
    if not full:
        return payload
    graph_full = course_graph_snapshot(course_id, file_id=file_id)
    payload['graph_full'] = graph_full
    payload['syllabus_node'] = graph_full.get('syllabus_node')
    payload['file_nodes'] = graph_full.get('file_nodes')
    payload['concept_nodes'] = graph_full.get('concept_nodes')
    payload['event_nodes'] = graph_full.get('event_nodes')
    payload['assignment_nodes'] = graph_full.get('assignment_nodes')
    payload['problem_nodes'] = graph_full.get('problem_nodes')
    if graph_full.get('parsed_file_node'):
        payload['parsed_file_node'] = graph_full['parsed_file_node']
    return payload
