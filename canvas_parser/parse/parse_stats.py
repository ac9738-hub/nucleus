"""Parse runtime + cost efficiency statistics for LLM file parsing."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from canvas_parser.parse.parse_cost import (
    assess_completed_model_calls,
    assess_parse_cost,
    format_cost_summary,
    get_model_pricing,
    normalize_usage,
)

DEFAULT_MODEL = 'deepseek-v4-flash'


def _safe_div(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return numerator / denominator


def estimate_cache_savings_usd(usage: Mapping[str, Any] | None, *, model: str = DEFAULT_MODEL) -> dict[str, float]:
    """Estimate USD saved vs treating all prompt tokens as cache misses."""
    normalized = normalize_usage(usage)
    hit = normalized['prompt_cache_hit_tokens']
    if hit <= 0:
        return {'cache_savings_usd': 0.0, 'cache_savings_pct': 0.0, 'hypothetical_miss_cost_usd': 0.0}

    rates = get_model_pricing(model)
    hit_rate = rates['input_cache_hit_per_m'] / 1_000_000
    miss_rate = rates['input_cache_miss_per_m'] / 1_000_000
    actual_hit_cost = hit * hit_rate
    hypothetical_miss_cost = hit * miss_rate
    savings = max(0.0, hypothetical_miss_cost - actual_hit_cost)
    pct = savings / hypothetical_miss_cost if hypothetical_miss_cost else 0.0
    return {
        'cache_savings_usd': round(savings, 8),
        'cache_savings_pct': round(pct, 4),
        'hypothetical_miss_cost_usd': round(hypothetical_miss_cost, 8),
    }


def assess_file_efficiency(
    *,
    cost_summary: Mapping[str, Any],
    runtime_ms: float,
    tool_count: int = 0,
    pass_count: int = 0,
    turn_count: int = 0,
    classify_ms: float = 0.0,
    model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """Per-file cost/time efficiency metrics."""
    usage = normalize_usage(cost_summary.get('usage'))
    total_cost = float(cost_summary.get('total_cost_usd') or 0.0)
    call_count = int(cost_summary.get('call_count') or 0)
    runtime_s = max(0.0, float(runtime_ms or 0.0) / 1000.0)
    cache = estimate_cache_savings_usd(usage, model=model)

    return {
        'runtime_ms': round(float(runtime_ms or 0.0), 1),
        'runtime_s': round(runtime_s, 2),
        'classify_ms': round(float(classify_ms or 0.0), 1),
        'llm_ms': round(max(0.0, float(runtime_ms or 0.0) - float(classify_ms or 0.0)), 1),
        'tool_count': int(tool_count or 0),
        'pass_count': int(pass_count or 0),
        'turn_count': int(turn_count or 0),
        'api_call_count': call_count,
        'total_tokens': usage['total_tokens'],
        'prompt_tokens': usage['prompt_tokens'],
        'completion_tokens': usage['completion_tokens'],
        'cache_hit_rate': float(cost_summary.get('cache_hit_rate') or 0.0),
        'total_cost_usd': round(total_cost, 6),
        'cost_per_minute_usd': round(_safe_div(total_cost, runtime_s / 60.0), 6),
        'cost_per_1k_tokens_usd': round(_safe_div(total_cost, usage['total_tokens'] / 1000.0), 6),
        'cost_per_api_call_usd': round(_safe_div(total_cost, call_count), 6),
        'cost_per_tool_usd': round(_safe_div(total_cost, tool_count), 6) if tool_count else 0.0,
        'tokens_per_second': round(_safe_div(usage['total_tokens'], runtime_s), 1),
        'ms_per_api_call': round(_safe_div(runtime_ms, call_count), 1),
        'ms_per_tool': round(_safe_div(runtime_ms, tool_count), 1) if tool_count else 0.0,
        **cache,
    }


def build_file_parse_record(
    *,
    courseid: str,
    fileid: str,
    filename: str,
    cost_summary: Mapping[str, Any],
    runtime_ms: float,
    tool_count: int = 0,
    pass_count: int = 0,
    turn_count: int = 0,
    classify_ms: float = 0.0,
) -> dict[str, Any]:
    efficiency = assess_file_efficiency(
        cost_summary=cost_summary,
        runtime_ms=runtime_ms,
        tool_count=tool_count,
        pass_count=pass_count,
        turn_count=turn_count,
        classify_ms=classify_ms,
    )
    return {
        'courseid': str(courseid or ''),
        'fileid': str(fileid or ''),
        'filename': str(filename or ''),
        'cost': dict(cost_summary),
        'efficiency': efficiency,
    }


def assess_session_efficiency(
    file_records: list[Mapping[str, Any]] | None,
    *,
    phase_timings: Mapping[str, float] | None = None,
    wall_ms: float = 0.0,
    cost_report: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Aggregate parse session cost/time efficiency."""
    records = list(file_records or [])
    phases = dict(phase_timings or {})
    wall_s = max(0.0, float(wall_ms or 0.0) / 1000.0)
    sum_file_ms = sum(float((row.get('efficiency') or {}).get('runtime_ms') or 0.0) for row in records)
    sum_tools = sum(int((row.get('efficiency') or {}).get('tool_count') or 0) for row in records)
    sum_turns = sum(int((row.get('efficiency') or {}).get('turn_count') or 0) for row in records)

    if cost_report:
        total_cost = float(cost_report.get('total_cost_usd') or 0.0)
        usage = normalize_usage(cost_report.get('usage'))
        cache_hit_rate = float(cost_report.get('cache_hit_rate') or 0.0)
    else:
        merged_calls = []
        for row in records:
            for call in (row.get('cost') or {}).get('calls') or []:
                merged_calls.append(call)
        summary = assess_parse_cost(merged_calls)
        total_cost = float(summary.get('total_cost_usd') or 0.0)
        usage = normalize_usage(summary.get('usage'))
        cache_hit_rate = float(summary.get('cache_hit_rate') or 0.0)
        cost_report = summary

    cache = estimate_cache_savings_usd(usage)
    file_count = len(records) or int((cost_report or {}).get('file_count') or 0)

    phase_total = sum(float(phases.get(key) or 0.0) for key in phases)
    phase_breakdown = {
        key: {
            'ms': round(float(phases.get(key) or 0.0), 1),
            'pct_of_wall': round(_safe_div(float(phases.get(key) or 0.0), float(wall_ms or 0.0)) * 100.0, 1),
            'pct_of_phases': round(_safe_div(float(phases.get(key) or 0.0), phase_total) * 100.0, 1)
            if phase_total else 0.0,
        }
        for key in sorted(phases)
    }

    return {
        'file_count': file_count,
        'wall_ms': round(float(wall_ms or 0.0), 1),
        'wall_minutes': round(wall_s / 60.0, 2),
        'sum_file_runtime_ms': round(sum_file_ms, 1),
        'parallel_factor': round(_safe_div(sum_file_ms, float(wall_ms or 0.0)), 2),
        'files_per_hour': round(_safe_div(file_count, wall_s / 3600.0), 2),
        'total_cost_usd': round(total_cost, 4),
        'cost_per_file_usd': round(_safe_div(total_cost, file_count), 6),
        'cost_per_hour_usd': round(_safe_div(total_cost, wall_s / 3600.0), 4),
        'cost_per_1k_tokens_usd': round(_safe_div(total_cost, usage['total_tokens'] / 1000.0), 6),
        'cost_per_tool_usd': round(_safe_div(total_cost, sum_tools), 6) if sum_tools else 0.0,
        'tokens_per_hour': round(_safe_div(usage['total_tokens'], wall_s / 3600.0), 0),
        'total_tokens': usage['total_tokens'],
        'cache_hit_rate': cache_hit_rate,
        'cache_savings_usd': cache['cache_savings_usd'],
        'cache_savings_pct': cache['cache_savings_pct'],
        'tool_count': sum_tools,
        'turn_count': sum_turns,
        'phase_timings_ms': {key: round(float(value or 0.0), 1) for key, value in phases.items()},
        'phase_breakdown': phase_breakdown,
        'cost_report': dict(cost_report or {}),
    }


def format_file_efficiency_debug(record: Mapping[str, Any]) -> str:
    eff = record.get('efficiency') if isinstance(record.get('efficiency'), dict) else {}
    name = record.get('filename') or record.get('fileid') or 'unknown'
    return (
        f"runtime={eff.get('runtime_s', 0):.1f}s "
        f"{format_cost_summary(record.get('cost') or {})} "
        f"eff=${eff.get('cost_per_minute_usd', 0):.4f}/min "
        f"{eff.get('tokens_per_second', 0):.0f}tok/s "
        f"cache_save={float(eff.get('cache_savings_pct') or 0) * 100:.1f}% "
        f"tools={eff.get('tool_count', 0)} passes={eff.get('pass_count', 0)}"
    )


def format_session_efficiency_report(summary: Mapping[str, Any]) -> str:
    lines = [
        'parser efficiency report:',
        (
            f"  Wall: {summary.get('wall_minutes', 0):.1f} min | "
            f"Files: {summary.get('file_count', 0)} | "
            f"${summary.get('total_cost_usd', 0):.4f} total "
            f"(${summary.get('cost_per_file_usd', 0):.4f}/file)"
        ),
        (
            f"  Throughput: {summary.get('files_per_hour', 0):.1f} files/hr | "
            f"{int(summary.get('total_tokens') or 0):,} tokens | "
            f"{int(summary.get('tokens_per_hour') or 0):,} tok/hr"
        ),
        (
            f"  Cost efficiency: ${summary.get('cost_per_1k_tokens_usd', 0):.4f}/1K tok | "
            f"cache saved ${summary.get('cache_savings_usd', 0):.4f} "
            f"({float(summary.get('cache_savings_pct') or 0) * 100:.1f}%) | "
            f"${summary.get('cost_per_tool_usd', 0):.4f}/tool"
        ),
    ]

    breakdown = summary.get('phase_breakdown') if isinstance(summary.get('phase_breakdown'), dict) else {}
    if breakdown:
        parts = []
        for key in ('parse_llm_ms', 'pdf_io_ms', 'embed_ms', 'write_state_ms', 'external_ms'):
            row = breakdown.get(key)
            if not row:
                continue
            label = key.replace('_ms', '')
            parts.append(f"{label} {row.get('pct_of_wall', 0):.0f}%")
        if parts:
            lines.append(f"  Time breakdown: {' | '.join(parts)}")

    parallel = float(summary.get('parallel_factor') or 0.0)
    if parallel > 0:
        lines.append(
            f"  Parallel factor: {parallel:.2f}x "
            f"(sum file LLM time / wall time)"
        )
    return '\n'.join(lines)


def print_session_efficiency_report(summary: Mapping[str, Any]) -> None:
    print(format_session_efficiency_report(summary), flush=True)


def assess_from_completed_model_calls(
    completed_model_calls: Mapping[str, Any] | None,
    *,
    parse_file_stats: list[Mapping[str, Any]] | None = None,
    phase_timings: Mapping[str, float] | None = None,
    wall_ms: float = 0.0,
) -> dict[str, Any]:
    cost_report = assess_completed_model_calls(completed_model_calls)
    session = assess_session_efficiency(
        parse_file_stats,
        phase_timings=phase_timings,
        wall_ms=wall_ms,
        cost_report=cost_report,
    )
    session['files'] = list(parse_file_stats or [])
    return session


def write_parse_stats_report(
    summary: Mapping[str, Any],
    path: Path | str | None = None,
) -> Path:
    target = Path(path) if path else Path('.cache/parse_stats/report.json')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
    return target
