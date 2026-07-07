"""Per-pass planning and post-hoc audit for file parse pipelines.

General rules only — no course-specific literals. Used to cut redundant LLM
calls (classify when heuristic is confident; pass2 when profile disables it).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from canvas_parser.parse.file_types import (
    FILE_TYPE_PROFILES,
    HEURISTIC_CONFIDENCE_THRESHOLD,
    get_file_type_profile,
    heuristic_classify,
    normalize_file_type_id,
    should_run_llm_classification,
)
from canvas_parser.parse.fast_path import pass1_needs_pass2, should_skip_llm_for_image

# Legacy: types that still had profile.pass2=True before single-pass migration.
PASS2_RUNTIME_LIKELIHOOD: dict[str, float] = {}
DEFAULT_PASS2_RUNTIME_LIKELIHOOD = 0.0


PASS_IDS = (
    'extract_pages',
    'heuristic_classify',
    'llm_classify',
    'llm_pass1',
    'llm_pass2',
    'finalize',
)


@dataclass
class PassStep:
    pass_id: str
    needed: bool
    reason: str
    llm_call: bool = False
    est_cost_tier: str = 'free'  # free | low | high


@dataclass
class PassPlan:
    course_id: str
    file_id: str
    filename: str
    resolved_type: str
    heuristic_confidence: float
    steps: list[PassStep] = field(default_factory=list)

    def needed_pass_ids(self) -> list[str]:
        return [step.pass_id for step in self.steps if step.needed]

    def skipped_pass_ids(self) -> list[str]:
        return [step.pass_id for step in self.steps if not step.needed]

    def est_llm_calls(self) -> int:
        return sum(1 for step in self.steps if step.needed and step.llm_call)

    def est_realistic_llm_calls(self) -> float:
        """Upper-bound plan calls weighted by typical runtime pass2 skip rate."""
        profile = get_file_type_profile(self.resolved_type)
        total = 0.0
        for step in self.steps:
            if not step.needed or not step.llm_call:
                continue
            if step.pass_id == 'llm_pass2':
                if not profile.pass2:
                    continue
                likelihood = PASS2_RUNTIME_LIKELIHOOD.get(
                    self.resolved_type,
                    DEFAULT_PASS2_RUNTIME_LIKELIHOOD,
                )
                total += likelihood
            else:
                total += 1.0
        return total

    def to_dict(self) -> dict[str, Any]:
        return {
            'courseId': self.course_id,
            'fileId': self.file_id,
            'filename': self.filename,
            'resolvedType': self.resolved_type,
            'heuristicConfidence': round(self.heuristic_confidence, 4),
            'neededPasses': self.needed_pass_ids(),
            'skippedPasses': self.skipped_pass_ids(),
            'estLlmCalls': self.est_llm_calls(),
            'estRealisticLlmCalls': round(self.est_realistic_llm_calls(), 3),
            'steps': [
                {
                    'pass': step.pass_id,
                    'needed': step.needed,
                    'reason': step.reason,
                    'llmCall': step.llm_call,
                    'estCostTier': step.est_cost_tier,
                }
                for step in self.steps
            ],
        }


def _resolve_type_hint(
    *,
    filename: str,
    file_type_hint: str = '',
    snippet: str = '',
) -> tuple[str, float]:
    heur_type, heur_conf = heuristic_classify(filename=filename, snippet=snippet)
    hint = normalize_file_type_id(file_type_hint)
    if hint and hint in FILE_TYPE_PROFILES and heur_conf < HEURISTIC_CONFIDENCE_THRESHOLD:
        # Stale pool generic_content must not mask a typed filename/snippet heuristic.
        if hint == 'generic_content' and heur_type != 'generic_content' and heur_conf >= 0.65:
            return heur_type, heur_conf
        return hint, HEURISTIC_CONFIDENCE_THRESHOLD
    return heur_type, heur_conf


def plan_passes_for_file(
    *,
    course_id: str,
    file_id: str,
    filename: str = '',
    file_type_hint: str = '',
    snippet: str = '',
    page_count: int = 0,
) -> PassPlan:
    """Plan which passes are worth running before parse (cost projection)."""
    resolved_type, heur_conf = _resolve_type_hint(
        filename=filename,
        file_type_hint=file_type_hint,
        snippet=snippet,
    )
    profile = get_file_type_profile(resolved_type)
    skip_llm = should_skip_llm_for_image(filename)
    steps: list[PassStep] = []

    steps.append(PassStep(
        'extract_pages',
        needed=True,
        reason='Required local PDF/HTML extraction; no LLM.',
        llm_call=False,
        est_cost_tier='free',
    ))
    steps.append(PassStep(
        'heuristic_classify',
        needed=True,
        reason='Free filename/snippet routing; drives pass1 tool profile.',
        llm_call=False,
        est_cost_tier='free',
    ))

    needs_llm_classify = should_run_llm_classification(heur_conf, resolved_type=resolved_type)
    steps.append(PassStep(
        'llm_classify',
        needed=needs_llm_classify,
        reason=(
            f'Heuristic confidence {heur_conf:.2f} < {HEURISTIC_CONFIDENCE_THRESHOLD}; disambiguate type.'
            if needs_llm_classify
            else f'Heuristic confidence {heur_conf:.2f} sufficient; skip flash classify call.'
        ),
        llm_call=needs_llm_classify,
        est_cost_tier='low' if needs_llm_classify else 'free',
    ))

    needs_pass1 = bool(
        profile.extract_concepts
        or profile.extract_problems
        or profile.extract_events
    )
    # All LLM file parses run pass1 for add_file_node; this flag tracks extraction value.
    pass1_extracts = needs_pass1
    pass1_needed = not skip_llm
    steps.append(PassStep(
        'llm_pass1',
        needed=pass1_needed,
        reason=(
            'Image file — skip LLM; heuristic classify + file node only.'
            if skip_llm
            else (
                f'Type {profile.type_id}: pass1 extracts concepts={profile.extract_concepts}, '
                f'problems={profile.extract_problems}, events={profile.extract_events}.'
                if pass1_extracts
                else f'Type {profile.type_id}: pass1 link/file_node only (no concept extraction profile).'
            )
        ),
        llm_call=pass1_needed,
        est_cost_tier='free' if skip_llm else ('high' if pass1_extracts else 'low'),
    ))

    needs_pass2_slot = profile.pass2
    steps.append(PassStep(
        'llm_pass2',
        needed=needs_pass2_slot,
        reason=(
            f'Type {profile.type_id} enables pass2 when pass1 uses generic log_detail/log_example; '
            'runtime skips when profile disables pass2, pass1 is log_problem-only, '
            'pass1 uses only type-specific log_* tools, or log rows were rejected.'
            if needs_pass2_slot
            else f'Type {profile.type_id} disables pass2 (single-pass type-specific or link-only profile).'
        ),
        llm_call=needs_pass2_slot,
        est_cost_tier='high' if needs_pass2_slot else 'free',
    ))

    steps.append(PassStep(
        'finalize',
        needed=True,
        reason=(
            'Deterministic promote: logged_details, typeExtractions (slides/textbook/reading), '
            'and events — never defer per-file in llm-cost/GT/eval.'
        ),
        llm_call=False,
        est_cost_tier='free',
    ))

    return PassPlan(
        course_id=str(course_id),
        file_id=str(file_id),
        filename=filename,
        resolved_type=profile.type_id,
        heuristic_confidence=heur_conf,
        steps=steps,
    )


def _calls_for_file(fragment: dict[str, Any], course_id: str, file_id: str) -> dict[str, Any]:
    calls = fragment.get('completed_model_calls') or {}
    fid = str(file_id)
    cid = str(course_id)

    def _match(row: dict) -> bool:
        return str(row.get('courseid') or '') == cid and str(row.get('fileid') or '') == fid

    classifications = [r for r in (calls.get('deepseek_classifications') or []) if _match(r)]
    file_passes = [r for r in (calls.get('deepseek_file_passes') or []) if _match(r)]
    stats = [r for r in (calls.get('parse_file_stats') or []) if _match(r)]
    return {
        'classifications': classifications,
        'file_passes': file_passes,
        'stats': stats,
    }


def _usage_tokens(rows: list[dict]) -> int:
    total = 0
    for row in rows:
        usage = row.get('usage') or {}
        total += int(usage.get('total_tokens') or usage.get('prompt_tokens') or 0)
        total += int(usage.get('completion_tokens') or 0)
    return total


def audit_fragment_passes(
    fragment: dict[str, Any],
    *,
    course_id: str,
    file_id: str,
    filename: str = '',
    file_type_hint: str = '',
    plan: PassPlan | None = None,
) -> dict[str, Any]:
    """Evaluate what each pass did on a completed parse and whether it was useful."""
    plan = plan or plan_passes_for_file(
        course_id=course_id,
        file_id=file_id,
        filename=filename,
        file_type_hint=file_type_hint,
    )
    calls = _calls_for_file(fragment, course_id, file_id)
    meta = fragment.get('_meta') or {}
    deepseek_passes = int(meta.get('deepseek_passes') or len(calls['file_passes']))

    node = ((fragment.get('files') or {}).get(str(course_id)) or {}).get(str(file_id)) or {}
    actual_type = normalize_file_type_id(
        str(node.get('academicFileType') or node.get('parserFileType') or plan.resolved_type)
    )
    profile = get_file_type_profile(actual_type)

    concepts = [
        c for c in (fragment.get('concepts') or [])
        if isinstance(c, dict) and str(c.get('courseid') or '') == str(course_id)
    ]
    detail_count = sum(len(c.get('details') or []) for c in concepts)
    classify_ran = bool(calls['classifications'])
    pass1_ran = deepseek_passes >= 1
    pass2_ran = deepseek_passes >= 2

    pass1_tools: list[str] = []
    for row in calls['file_passes']:
        for turn in row.get('turns') or []:
            for tool in turn.get('tools') or []:
                name = str(tool.get('name') or tool) if isinstance(tool, dict) else str(tool)
                if name:
                    pass1_tools.append(name)

    pass2_would_help = profile.pass2 and pass1_needs_pass2(
        pass1_tools,
        profile_pass2=profile.pass2,
        profile=profile,
    )

    steps_audit: list[dict[str, Any]] = []

    steps_audit.append({
        'pass': 'extract_pages',
        'ran': bool(node.get('pages') or node.get('textChunks')),
        'useful': bool(node.get('pages') or node.get('textChunks')),
        'verdict': 'required',
        'note': 'Local I/O; pages present means extract succeeded.',
    })

    steps_audit.append({
        'pass': 'heuristic_classify',
        'ran': True,
        'useful': bool(actual_type),
        'verdict': 'keep',
        'note': f'Routed to {actual_type} (free).',
    })

    classify_useful = classify_ran and (
        plan.heuristic_confidence < HEURISTIC_CONFIDENCE_THRESHOLD
        or actual_type != plan.resolved_type
    )
    classify_wasted = classify_ran and not classify_useful
    steps_audit.append({
        'pass': 'llm_classify',
        'ran': classify_ran,
        'useful': classify_useful if classify_ran else not plan.steps[2].needed,
        'verdict': 'cut' if classify_wasted else ('keep' if classify_ran else 'skipped_ok'),
        'note': (
            'Flash classify ran but heuristic was already confident — save 1 call/file.'
            if classify_wasted
            else (
                'Classify disambiguated low-confidence heuristic.'
                if classify_ran and classify_useful
                else 'Skipped; heuristic confidence sufficient.'
            )
        ),
        'tokens': _usage_tokens(calls['classifications']),
    })

    event_count = sum(
        1 for event in (fragment.get('events') or [])
        if isinstance(event, dict)
        and str(event.get('courseid') or '') == str(course_id)
        and str(event.get('fileid') or event.get('sourceFileId') or '') == str(file_id)
    )
    problem_count = sum(
        1 for problem in (fragment.get('problems') or [])
        if isinstance(problem, dict)
        and str(problem.get('courseid') or '') == str(course_id)
        and str(problem.get('fileid') or problem.get('sourceFileId') or '') == str(file_id)
    )
    pass1_useful = pass1_ran and (
        len(concepts) > 0
        or detail_count > 0
        or event_count > 0
        or problem_count > 0
        or profile.extract_events
        or (not profile.extract_concepts and not profile.extract_problems and pass1_ran)
    )
    steps_audit.append({
        'pass': 'llm_pass1',
        'ran': pass1_ran,
        'useful': pass1_useful,
        'verdict': 'keep' if pass1_useful else ('missing' if not pass1_ran else 'cut'),
        'note': f'Pass1 tools sample: {pass1_tools[:6]}' if pass1_tools else 'No pass1 tool trace.',
        'tokens': _usage_tokens(calls['file_passes'][:1]),
    })

    pass2_useful = pass2_ran and (detail_count > 0 or (problem_count > 0 and not profile.extract_concepts))
    pass2_wasteful = pass2_ran and detail_count == 0 and problem_count == 0 and profile.extract_concepts
    pass2_skipped_ok = (
        not pass2_ran
        and (
            not profile.pass2
            or not pass2_would_help
        )
    )
    steps_audit.append({
        'pass': 'llm_pass2',
        'ran': pass2_ran,
        'useful': pass2_useful if pass2_ran else pass2_skipped_ok,
        'verdict': (
            'cut' if pass2_wasteful
            else ('keep' if pass2_useful
                  else ('skipped_ok' if pass2_skipped_ok else 'cut_candidate'))
        ),
        'note': (
            'Pass2 ran but produced no details — consider tightening pass1_needs_pass2 gate.'
            if pass2_wasteful
            else (
                f'Pass2 promoted details ({detail_count} total).'
                if pass2_useful
                else (
                    'Correctly skipped: profile disables pass2, type-specific pass1 only, or no log_* tools.'
                    if pass2_skipped_ok
                    else 'Pass2 profile enabled but did not run — check defer/finalize.'
                )
            )
        ),
        'tokens': _usage_tokens(calls['file_passes'][1:]),
    })

    finalize_ok = detail_count > 0 or not profile.extract_concepts
    steps_audit.append({
        'pass': 'finalize',
        'ran': True,
        'useful': finalize_ok,
        'verdict': 'keep' if finalize_ok else 'fix_defer_finalize',
        'note': (
            'logged_details promoted to concept details.'
            if finalize_ok
            else 'Defer-per-file-finalize likely left details unpromoted.'
        ),
    })

    cut_candidates = [
        row['pass'] for row in steps_audit
        if row['verdict'] in ('cut', 'cut_candidate', 'fix_defer_finalize')
    ]
    total_tokens = _usage_tokens(calls['classifications'] + calls['file_passes'])

    return {
        'plan': plan.to_dict(),
        'actualType': actual_type,
        'deepseekPasses': deepseek_passes,
        'conceptCount': len(concepts),
        'detailCount': detail_count,
        'totalLlmTokens': total_tokens,
        'steps': steps_audit,
        'cutCandidates': cut_candidates,
        'recommendations': _recommendations(steps_audit, plan),
    }


def _recommendations(steps_audit: list[dict], plan: PassPlan) -> list[str]:
    recs: list[str] = []
    by_pass = {row['pass']: row for row in steps_audit}
    if by_pass.get('llm_classify', {}).get('verdict') == 'cut':
        recs.append('Trust heuristic classify when confidence >= threshold; saves one flash call per file.')
    if by_pass.get('llm_pass2', {}).get('verdict') == 'skipped_ok':
        recs.append('Pass2 correctly skipped for this type/pass1 tool pattern.')
    if by_pass.get('llm_pass2', {}).get('verdict') == 'cut':
        recs.append('Pass2 ran without adding details — tighten pass1_needs_pass2 or disable pass2 for this routing.')
    if by_pass.get('finalize', {}).get('verdict') == 'fix_defer_finalize':
        recs.append('Set PARSER_DEFER_PER_FILE_FINALIZE=0 for file-level eval and GT builds.')
    if plan.est_llm_calls() > 2:
        recs.append('Review file type hint; mis-routing inflates pass count.')
    return recs


def summarize_pool_pass_plans(entries: list[dict], *, use_snippets: bool = True) -> dict[str, Any]:
    """Project pass costs across a file pool without running LLM."""
    from canvas_parser.parse.parse_pass_overrides import plan_passes_for_pool_entry

    plans = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        plans.append(plan_passes_for_pool_entry(
            e,
            syllabus_seed_present=True,
            for_gt_build=not use_snippets,
        ))
    if not plans:
        return {'fileCount': 0}

    skip_classify = sum(1 for p in plans if 'llm_classify' in p.skipped_pass_ids())
    skip_pass2 = sum(1 for p in plans if 'llm_pass2' in p.skipped_pass_ids())
    est_calls = sum(p.est_llm_calls() for p in plans)
    est_realistic = sum(p.est_realistic_llm_calls() for p in plans)
    full_llm_calls = len(plans) * 3  # classify + pass1 + pass2 naive baseline

    by_type: dict[str, int] = {}
    by_type_est: dict[str, dict[str, float]] = {}
    for p in plans:
        by_type[p.resolved_type] = by_type.get(p.resolved_type, 0) + 1
        bucket = by_type_est.setdefault(p.resolved_type, {'files': 0, 'estCalls': 0.0, 'realisticCalls': 0.0})
        bucket['files'] += 1
        bucket['estCalls'] += p.est_llm_calls()
        bucket['realisticCalls'] += p.est_realistic_llm_calls()

    skip_syllabus_llm = sum(
        1 for p in plans
        if 'llm_pass1' in p.skipped_pass_ids() and p.resolved_type == 'syllabus'
    )
    skip_pass1_heuristic_profile = sum(
        1 for p in plans
        if any(
            s.pass_id == 'llm_pass1' and not s.needed
            and 'no concept/problem extraction profile' in s.reason
            for s in p.steps
        )
    )
    skip_pass1_empty_signal = sum(
        1 for p in plans
        if any(
            s.pass_id == 'llm_pass1' and not s.needed
            and 'empty structural signal' in s.reason
            for s in p.steps
        )
    )
    content_plans = [p for p in plans if p.resolved_type != 'syllabus']
    content_est = sum(p.est_llm_calls() for p in content_plans)
    content_realistic = sum(p.est_realistic_llm_calls() for p in content_plans)

    per_pass_needed: dict[str, int] = {pid: 0 for pid in PASS_IDS}
    per_pass_skipped: dict[str, int] = {pid: 0 for pid in PASS_IDS}
    for plan in plans:
        for step in plan.steps:
            if step.needed:
                per_pass_needed[step.pass_id] = per_pass_needed.get(step.pass_id, 0) + 1
            else:
                per_pass_skipped[step.pass_id] = per_pass_skipped.get(step.pass_id, 0) + 1

    return {
        'fileCount': len(plans),
        'contentFileCount': len(content_plans),
        'rotatingEvalFileCount': len(content_plans),
        'rotatingEvalEstLlmCalls': content_est,
        'rotatingEvalRealisticLlmCalls': round(content_realistic, 2),
        'rotatingEvalAvgLlmCalls': round(content_est / len(content_plans), 3) if content_plans else 0,
        'rotatingEvalAvgRealisticLlmCalls': round(content_realistic / len(content_plans), 3) if content_plans else 0,
        'skipLlmClassify': skip_classify,
        'skipPass2Profile': skip_pass2,
        'skipSyllabusLlmWhenSeeded': skip_syllabus_llm,
        'skipPass1HeuristicProfile': skip_pass1_heuristic_profile,
        'skipPass1EmptySignal': skip_pass1_empty_signal,
        'estLlmCallsTotal': est_calls,
        'estRealisticLlmCallsTotal': round(est_realistic, 2),
        'naiveLlmCallsTotal': full_llm_calls,
        'estSavingsVsNaive': round(1 - (est_calls / full_llm_calls), 4) if full_llm_calls else 0,
        'realisticSavingsVsNaive': round(1 - (est_realistic / full_llm_calls), 4) if full_llm_calls else 0,
        'avgEstLlmCallsPerFile': round(est_calls / len(plans), 3),
        'avgRealisticLlmCallsPerFile': round(est_realistic / len(plans), 3),
        'perPassStepCounts': {
            pid: {
                'needed': per_pass_needed.get(pid, 0),
                'skipped': per_pass_skipped.get(pid, 0),
            }
            for pid in PASS_IDS
        },
        'byResolvedType': dict(sorted(by_type.items(), key=lambda kv: -kv[1])),
        'byTypeEstCalls': {
            type_id: {
                'files': int(row['files']),
                'avgEstCalls': round(row['estCalls'] / row['files'], 3),
                'avgRealisticCalls': round(row['realisticCalls'] / row['files'], 3),
            }
            for type_id, row in sorted(by_type_est.items(), key=lambda kv: -kv[1]['files'])
        },
    }


def aggregate_pass_audits(audits: list[dict[str, Any]]) -> dict[str, Any]:
    """Roll up per-file pass audits into pass-level verdict counts."""
    if not audits:
        return {'fileCount': 0}

    by_pass: dict[str, dict[str, int]] = {}
    cut_totals: dict[str, int] = {}
    total_tokens = 0
    recommendations: list[str] = []

    for audit in audits:
        total_tokens += int(audit.get('totalLlmTokens') or 0)
        for rec in audit.get('recommendations') or []:
            if rec not in recommendations:
                recommendations.append(rec)
        for cut in audit.get('cutCandidates') or []:
            cut_totals[cut] = cut_totals.get(cut, 0) + 1
        for step in audit.get('steps') or []:
            pid = str(step.get('pass') or '')
            if not pid:
                continue
            bucket = by_pass.setdefault(pid, {
                'ran': 0,
                'useful': 0,
                'cut': 0,
                'skipped_ok': 0,
                'tokens': 0,
            })
            if step.get('ran'):
                bucket['ran'] += 1
            if step.get('useful'):
                bucket['useful'] += 1
            verdict = str(step.get('verdict') or '')
            if verdict == 'cut':
                bucket['cut'] += 1
            elif verdict == 'skipped_ok':
                bucket['skipped_ok'] += 1
            bucket['tokens'] += int(step.get('tokens') or 0)

    return {
        'fileCount': len(audits),
        'totalLlmTokens': total_tokens,
        'byPass': by_pass,
        'cutCandidateTotals': cut_totals,
        'recommendations': recommendations[:12],
    }
