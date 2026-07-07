"""Estimate DeepSeek parse cost from API usage (input cache hit/miss + output)."""
from __future__ import annotations

import os
from typing import Any, Mapping

DEFAULT_MODEL = 'deepseek-v4-flash'

# Official DeepSeek V4 Flash rates (USD per 1M tokens) — api-docs.deepseek.com/quick_start/pricing
DEEPSEEK_V4_FLASH_PRICING = {
    'input_cache_hit_per_m': float(os.getenv('PARSER_DEEPSEEK_INPUT_CACHE_HIT_PER_M', '0.0028')),
    'input_cache_miss_per_m': float(os.getenv('PARSER_DEEPSEEK_INPUT_CACHE_MISS_PER_M', '0.14')),
    'output_per_m': float(os.getenv('PARSER_DEEPSEEK_OUTPUT_PER_M', '0.28')),
}

DEEPSEEK_V4_PRO_PRICING = {
    'input_cache_hit_per_m': float(os.getenv('PARSER_DEEPSEEK_PRO_INPUT_CACHE_HIT_PER_M', '0.003625')),
    'input_cache_miss_per_m': float(os.getenv('PARSER_DEEPSEEK_PRO_INPUT_CACHE_MISS_PER_M', '0.435')),
    'output_per_m': float(os.getenv('PARSER_DEEPSEEK_PRO_OUTPUT_PER_M', '0.87')),
}

MODEL_PRICING = {
    'deepseek-v4-flash': DEEPSEEK_V4_FLASH_PRICING,
    'deepseek-v4-pro': DEEPSEEK_V4_PRO_PRICING,
    # Legacy aliases map to Flash non-thinking / thinking billing tiers.
    'deepseek-chat': DEEPSEEK_V4_FLASH_PRICING,
    'deepseek-reasoner': DEEPSEEK_V4_FLASH_PRICING,
}


def get_model_pricing(model: str = DEFAULT_MODEL) -> dict[str, float]:
    key = str(model or DEFAULT_MODEL).strip().lower()
    return dict(MODEL_PRICING.get(key, DEEPSEEK_V4_FLASH_PRICING))


def usage_from_chat_completion(response) -> dict[str, int]:
    """Extract token usage from an OpenAI-compatible chat completion response."""
    usage = getattr(response, 'usage', None)
    if usage is None:
        return {}
    if hasattr(usage, 'model_dump'):
        return normalize_usage(usage.model_dump())
    if isinstance(usage, dict):
        return normalize_usage(usage)
    return normalize_usage({
        'prompt_tokens': getattr(usage, 'prompt_tokens', 0),
        'completion_tokens': getattr(usage, 'completion_tokens', 0),
        'total_tokens': getattr(usage, 'total_tokens', 0),
        'prompt_cache_hit_tokens': getattr(usage, 'prompt_cache_hit_tokens', 0),
        'prompt_cache_miss_tokens': getattr(usage, 'prompt_cache_miss_tokens', 0),
    })


def normalize_usage(usage: Mapping[str, Any] | None) -> dict[str, int]:
    """Normalize DeepSeek usage fields; assume cache-miss when split is missing."""
    data = dict(usage or {})
    hit = int(data.get('prompt_cache_hit_tokens') or 0)
    miss = int(data.get('prompt_cache_miss_tokens') or 0)
    prompt = int(data.get('prompt_tokens') or 0)
    completion = int(data.get('completion_tokens') or 0)
    total = int(data.get('total_tokens') or 0)

    if hit == 0 and miss == 0 and prompt > 0:
        miss = prompt
    elif prompt > 0 and hit + miss < prompt:
        miss += max(0, prompt - hit - miss)
    elif prompt == 0 and (hit or miss):
        prompt = hit + miss

    if total == 0:
        total = prompt + completion

    return {
        'prompt_tokens': prompt,
        'prompt_cache_hit_tokens': hit,
        'prompt_cache_miss_tokens': miss,
        'completion_tokens': completion,
        'total_tokens': total,
    }


def _merge_usage(left: Mapping[str, Any], right: Mapping[str, Any]) -> dict[str, int]:
    merged = normalize_usage(left)
    other = normalize_usage(right)
    return {
        'prompt_tokens': merged['prompt_tokens'] + other['prompt_tokens'],
        'prompt_cache_hit_tokens': merged['prompt_cache_hit_tokens'] + other['prompt_cache_hit_tokens'],
        'prompt_cache_miss_tokens': merged['prompt_cache_miss_tokens'] + other['prompt_cache_miss_tokens'],
        'completion_tokens': merged['completion_tokens'] + other['completion_tokens'],
        'total_tokens': merged['total_tokens'] + other['total_tokens'],
    }


def estimate_call_cost(
    usage: Mapping[str, Any] | None,
    *,
    model: str = DEFAULT_MODEL,
    pricing: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Return USD cost breakdown for one API call."""
    normalized = normalize_usage(usage)
    rates = dict(pricing or get_model_pricing(model))
    hit = normalized['prompt_cache_hit_tokens']
    miss = normalized['prompt_cache_miss_tokens']
    output_tokens = normalized['completion_tokens']
    input_total = hit + miss

    input_hit_cost = hit * rates['input_cache_hit_per_m'] / 1_000_000
    input_miss_cost = miss * rates['input_cache_miss_per_m'] / 1_000_000
    output_cost = output_tokens * rates['output_per_m'] / 1_000_000
    total_cost = input_hit_cost + input_miss_cost + output_cost

    return {
        'model': model,
        'usage': normalized,
        'pricing_per_m': rates,
        'input_cache_hit_cost_usd': round(input_hit_cost, 8),
        'input_cache_miss_cost_usd': round(input_miss_cost, 8),
        'output_cost_usd': round(output_cost, 8),
        'total_cost_usd': round(total_cost, 8),
        'cache_hit_rate': round(hit / input_total, 4) if input_total else 0.0,
        'estimated': not bool(usage),
    }


def assess_parse_cost(
    api_calls: list[Mapping[str, Any]] | None,
    *,
    default_model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """
    Assess total cost for one file parse (classification + pass turns).

    Each entry in ``api_calls`` may include:
      - ``usage``: token dict
      - ``model``: model id (defaults to deepseek-v4-flash)
      - ``purpose``: optional label (classify, pass1, pass2, final_pass, …)
    """
    calls = list(api_calls or [])
    if not calls:
        return {
            'call_count': 0,
            'usage': normalize_usage({}),
            'total_cost_usd': 0.0,
            'input_cache_hit_cost_usd': 0.0,
            'input_cache_miss_cost_usd': 0.0,
            'output_cost_usd': 0.0,
            'cache_hit_rate': 0.0,
            'calls': [],
        }

    merged_usage = normalize_usage({})
    total_hit_cost = 0.0
    total_miss_cost = 0.0
    total_output_cost = 0.0
    detailed_calls = []

    for index, call in enumerate(calls):
        model = str(call.get('model') or default_model)
        breakdown = estimate_call_cost(call.get('usage'), model=model)
        merged_usage = _merge_usage(merged_usage, breakdown['usage'])
        total_hit_cost += breakdown['input_cache_hit_cost_usd']
        total_miss_cost += breakdown['input_cache_miss_cost_usd']
        total_output_cost += breakdown['output_cost_usd']
        detailed_calls.append({
            'index': index,
            'purpose': str(call.get('purpose') or call.get('label') or ''),
            'model': model,
            'usage': breakdown['usage'],
            'total_cost_usd': breakdown['total_cost_usd'],
            'cache_hit_rate': breakdown['cache_hit_rate'],
        })

    input_total = merged_usage['prompt_cache_hit_tokens'] + merged_usage['prompt_cache_miss_tokens']
    total_cost = total_hit_cost + total_miss_cost + total_output_cost

    return {
        'call_count': len(detailed_calls),
        'usage': merged_usage,
        'total_cost_usd': round(total_cost, 6),
        'input_cache_hit_cost_usd': round(total_hit_cost, 6),
        'input_cache_miss_cost_usd': round(total_miss_cost, 6),
        'output_cost_usd': round(total_output_cost, 6),
        'cache_hit_rate': round(
            merged_usage['prompt_cache_hit_tokens'] / input_total, 4,
        ) if input_total else 0.0,
        'calls': detailed_calls,
    }


def assess_file_parse_from_pass_records(
    pass_records: list[Mapping[str, Any]] | None,
    *,
    classification_record: Mapping[str, Any] | None = None,
    default_model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """Roll up cost for one file from parser ``deepseek_file_passes`` (+ optional classify call)."""
    api_calls = []
    if classification_record:
        api_calls.append({
            'purpose': 'classify',
            'model': classification_record.get('model', default_model),
            'usage': classification_record.get('usage'),
        })
    for record in pass_records or []:
        purpose = f"pass{record.get('pass_index', '')}"
        if record.get('final_pass'):
            purpose = 'final_pass'
        for turn in record.get('turns') or []:
            api_calls.append({
                'purpose': turn.get('purpose') or purpose,
                'model': turn.get('model', default_model),
                'usage': turn.get('usage'),
            })
        if record.get('usage') and not record.get('turns'):
            api_calls.append({
                'purpose': purpose,
                'model': record.get('model', default_model),
                'usage': record.get('usage'),
            })

    summary = assess_parse_cost(api_calls, default_model=default_model)
    if pass_records:
        first = pass_records[0]
        summary['courseid'] = str(first.get('courseid') or '')
        summary['fileid'] = str(first.get('fileid') or '')
        summary['filename'] = str(first.get('filename') or '')
        summary['pass_count'] = len(pass_records)
    return summary


def assess_completed_model_calls(
    completed_model_calls: Mapping[str, Any] | None,
    *,
    default_model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    """Summarize parse costs from ``canvas_graph.json`` ``completed_model_calls`` state."""
    state = dict(completed_model_calls or {})
    passes = list(state.get('deepseek_file_passes') or [])
    classifications = {
        (str(item.get('courseid') or ''), str(item.get('fileid') or '')): item
        for item in (state.get('deepseek_classifications') or [])
    }

    by_file: dict[tuple[str, str], list[dict]] = {}
    for record in passes:
        key = (str(record.get('courseid') or ''), str(record.get('fileid') or ''))
        by_file.setdefault(key, []).append(record)

    file_summaries = []
    grand_usage = normalize_usage({})
    grand_cost = 0.0
    grand_hit = 0.0
    grand_miss = 0.0
    grand_output = 0.0

    for key, records in sorted(by_file.items()):
        summary = assess_file_parse_from_pass_records(
            records,
            classification_record=classifications.get(key),
            default_model=default_model,
        )
        file_summaries.append(summary)
        grand_usage = _merge_usage(grand_usage, summary['usage'])
        grand_cost += summary['total_cost_usd']
        grand_hit += summary['input_cache_hit_cost_usd']
        grand_miss += summary['input_cache_miss_cost_usd']
        grand_output += summary['output_cost_usd']

    input_total = grand_usage['prompt_cache_hit_tokens'] + grand_usage['prompt_cache_miss_tokens']
    return {
        'file_count': len(file_summaries),
        'files': file_summaries,
        'usage': grand_usage,
        'total_cost_usd': round(grand_cost, 4),
        'input_cache_hit_cost_usd': round(grand_hit, 4),
        'input_cache_miss_cost_usd': round(grand_miss, 4),
        'output_cost_usd': round(grand_output, 4),
        'cache_hit_rate': round(
            grand_usage['prompt_cache_hit_tokens'] / input_total, 4,
        ) if input_total else 0.0,
    }


def format_cost_summary(summary: Mapping[str, Any]) -> str:
    """One-line human-readable cost summary."""
    usage = normalize_usage(summary.get('usage'))
    cost = float(summary.get('total_cost_usd') or 0.0)
    hit_rate = float(summary.get('cache_hit_rate') or 0.0)
    return (
        f"${cost:.4f} "
        f"(in hit={usage['prompt_cache_hit_tokens']:,} miss={usage['prompt_cache_miss_tokens']:,} "
        f"out={usage['completion_tokens']:,} cache={hit_rate * 100:.1f}%)"
    )
