"""Document and measure concurrency-related graph extraction quality risks.

The production parse path fans out file Lambdas after a per-course seed
(syllabus + deterministic items). High concurrency (e.g. 1000) amplifies
structural weaknesses in merge/finalize and per-item isolation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ConcurrencyIssue:
    id: str
    category: str
    severity: str  # critical | high | medium | low
    summary: str
    impact: str
    mitigation: str
    code_refs: tuple[str, ...] = ()


# Known structural issues in the concurrent server-side parse strategy.
KNOWN_CONCURRENCY_ISSUES: tuple[ConcurrencyIssue, ...] = (
    ConcurrencyIssue(
        id='trial_vs_production_orchestration',
        category='orchestration',
        severity='critical',
        summary='Flat trial concurrency omits syllabus-first seeding used in production.',
        impact=(
            'File workers start from empty or stale seeds; concepts miss syllabus context '
            'and assignment cross-links that production Phase 1–2 provide.'
        ),
        mitigation='Eval concurrent paths through course_orchestrator, not flat run_items_concurrent.',
        code_refs=(
            'canvas_parser/parse/course_orchestrator.py',
            'scripts/run_parse_trial_compare.py',
        ),
    ),
    ConcurrencyIssue(
        id='shallow_fragment_merge',
        category='merge',
        severity='high',
        summary='merge_graph_fragments appends concepts/events without deduplication.',
        impact=(
            'Duplicate concept nodes accumulate across concurrent workers; finalize must '
            'collapse them. Race-sensitive ordering can leave near-duplicate titles.'
        ),
        mitigation='Dedupe at merge time or strengthen finalize_merged_graph title clustering.',
        code_refs=('canvas_parser/parse/lambda_runtime.py::merge_graph_fragments',),
    ),
    ConcurrencyIssue(
        id='syllabus_last_write_wins',
        category='merge',
        severity='medium',
        summary='Concurrent syllabus fragments could overwrite syllabi[course_id] (last-write-wins).',
        impact='Canvas body vs PDF syllabus races could lose assignment lists or exam dates.',
        mitigation='merge_graph_fragments now prefers richer syllabus; Phase 1 should remain canonical.',
        code_refs=('canvas_parser/parse/lambda_runtime.py::_merge_syllabus_course',),
    ),
    ConcurrencyIssue(
        id='per_item_isolation',
        category='isolation',
        severity='high',
        summary='Each Lambda worker sees only the course seed snapshot, not sibling file output.',
        impact=(
            'Linked files discovered during one file parse are invisible to concurrent '
            'siblings; cross-file concept edges and detail promotion lag until finalize.'
        ),
        mitigation='Two-pass linked-file discovery or defer cross-file edges to finalize.',
        code_refs=(
            'aws_lambda_parse/handler.py',
            'canvas_parser/parse/lambda_runtime.py::process_single_item',
        ),
    ),
    ConcurrencyIssue(
        id='llm_fast_skips_syllabus_final',
        category='quality',
        severity='high',
        summary='Production llm-fast skips syllabus final pass and heuristic concept seeding.',
        impact='Exam dates and schedule tables buried in syllabus prose may not reach events.',
        mitigation='Run quality llm mode for GT; keep llm-fast for throughput with spot checks.',
        code_refs=('canvas_parser/parse/parse_modes.py::apply_llm_fast_mode',),
    ),
    ConcurrencyIssue(
        id='deepseek_vs_lambda_mismatch',
        category='capacity',
        severity='medium',
        summary='Lambda fan-out can exceed DeepSeek semaphore limits inside each worker.',
        impact=(
            'At concurrency 1000, API throttling and retries inflate latency; partial '
            'pass2 skips reduce detail recall under load.'
        ),
        mitigation='Align PARSE_MAX_CONCURRENT, DEEPSEEK_MAX_CONCURRENT, and Lambda reserved concurrency.',
        code_refs=(
            'parser.py::PARSE_MAX_CONCURRENT',
            'canvas_parser/parse/lambda_deploy.py::DEFAULT_RESERVED_CONCURRENCY',
        ),
    ),
    ConcurrencyIssue(
        id='invoke_worker_pool_cap',
        category='capacity',
        severity='medium',
        summary='Lambda invoke thread pool defaults to 64 workers regardless of item count.',
        impact='1000 concurrent items queue behind invoke pool; S3 poll latency dominates.',
        mitigation='Set PARSER_LAMBDA_INVOKE_WORKERS to match target concurrency.',
        code_refs=('canvas_parser/parse/lambda_deploy.py::DEFAULT_INVOKE_WORKERS',),
    ),
    ConcurrencyIssue(
        id='deferred_per_file_finalize',
        category='quality',
        severity='medium',
        summary='Bulk mode defers per-file finalize; logged_details may not promote to concepts.',
        impact='Detail count drops until batch finalize; concurrent eval mid-run looks sparse.',
        mitigation='Disable PARSER_DEFER_PER_FILE_FINALIZE for file-level GT and eval runs.',
        code_refs=('canvas_parser/parse/parse_modes.py::_apply_shared_bulk_throughput',),
    ),
    ConcurrencyIssue(
        id='seed_stale_at_invoke',
        category='race',
        severity='medium',
        summary='Course seed uploaded once before file fan-out; no mid-run seed refresh.',
        impact=(
            'Deterministic items merged into seed before files start; files parsed later '
            'cannot benefit from concepts extracted by earlier concurrent siblings.'
        ),
        mitigation='Phase file batches or refresh seeds between waves.',
        code_refs=('canvas_parser/parse/course_orchestrator.py',),
    ),
    ConcurrencyIssue(
        id='skip_telemetry_blind_spots',
        category='observability',
        severity='low',
        summary='worker_skips.jsonl tracks download/LLM skips but not merge-quality loss.',
        impact='High skip rates are visible; silent concept/detail loss from merge dedupe is not.',
        mitigation='Compare per-file GT in rotating eval; track concept recall vs quality baseline.',
        code_refs=('canvas_parser/parse/worker_skip_log.py',),
    ),
)


def issues_by_severity() -> dict[str, list[ConcurrencyIssue]]:
    grouped: dict[str, list[ConcurrencyIssue]] = {}
    for issue in KNOWN_CONCURRENCY_ISSUES:
        grouped.setdefault(issue.severity, []).append(issue)
    return grouped


def audit_report(*, run_metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return a structured concurrency audit for eval reports."""
    grouped = issues_by_severity()
    report: dict[str, Any] = {
        'issueCount': len(KNOWN_CONCURRENCY_ISSUES),
        'bySeverity': {sev: len(rows) for sev, rows in grouped.items()},
        'issues': [
            {
                'id': issue.id,
                'category': issue.category,
                'severity': issue.severity,
                'summary': issue.summary,
                'impact': issue.impact,
                'mitigation': issue.mitigation,
                'codeRefs': list(issue.code_refs),
            }
            for issue in KNOWN_CONCURRENCY_ISSUES
        ],
    }
    if run_metrics:
        report['runMetrics'] = run_metrics
        report['riskFlags'] = _risk_flags_from_metrics(run_metrics)
    return report


def _risk_flags_from_metrics(metrics: dict[str, Any]) -> list[str]:
    flags: list[str] = []
    concurrency = int(metrics.get('concurrency') or 0)
    if concurrency >= 500:
        flags.append('extreme_concurrency')
    if float(metrics.get('conceptRecall') or 1.0) < 0.75:
        flags.append('low_concept_recall_under_load')
    if float(metrics.get('detailRatio') or 1.0) < 0.70:
        flags.append('detail_loss_under_load')
    if int(metrics.get('deepseekPasses') or 0) < int(metrics.get('expectedDeepseekPasses') or 0):
        flags.append('incomplete_llm_passes')
    if float(metrics.get('skipRate') or 0.0) > 0.05:
        flags.append('elevated_worker_skips')
    return flags
