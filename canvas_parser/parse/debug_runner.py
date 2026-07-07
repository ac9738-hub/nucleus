"""Step-through parse debugger — full pipeline for one course file."""
from __future__ import annotations

import asyncio
import json
import os
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from canvas_parser.parse.course_parse_plan import (
    CourseParsePlan,
    build_course_parse_plans,
    collect_parseable_file_items,
    finalize_course_plan,
    syllabus_priority,
)
from canvas_parser.parse.debug_trace import (
    DebugTrace,
    graph_debug_snapshot,
    graph_payload_for_checkpoint,
    set_active_trace,
    trace_activity,
    trace_checkpoint,
)
from canvas_parser.parse.lambda_runtime import (
    apply_canvas_auth,
    iter_batch_items,
    merge_graph_fragments,
    process_single_item,
    reset_parser_state,
    run_deterministic_course_items,
)
from canvas_parser.parse.parse_modes import apply_parse_mode
from canvas_parser.parse.parse_trial import clear_all_parse_trial_env
from canvas_parser.parse.syllabus_discovery import (
    ClassifiedSyllabusCandidate,
    _candidate_rows,
    classify_downloaded_file_as_syllabus,
    reconcile_syllabus_duplicates,
)
from canvas_parser.parse.debug_file_batch import debug_file_concurrency, run_batched_course_file_phases


def apply_debug_parse_env() -> None:
    """Full LLM pipeline including syllabus final pass; concurrent file parses in debug."""
    clear_all_parse_trial_env()
    apply_parse_mode('llm')
    os.environ['PARSER_SKIP_EXTERNAL'] = '1'
    os.environ['PARSER_DEFER_FILE_EMBED'] = '1'
    os.environ['PARSER_SKIP_ASSIGNMENT_SUMMARY'] = '1'
    os.environ['PARSER_SKIP_DOWNLOAD_IF_CACHED'] = '0'
    os.environ.pop('PARSER_SKIP_SYLLABUS_FINAL_PASS', None)
    file_concurrency = max(1, int(os.getenv('PARSER_DEBUG_FILE_CONCURRENCY', '4')))
    os.environ['PARSER_DEBUG_FILE_CONCURRENCY'] = str(file_concurrency)
    os.environ['PARSE_MAX_CONCURRENT'] = str(file_concurrency)
    os.environ['DEEPSEEK_MAX_CONCURRENT'] = str(
        max(file_concurrency, int(os.getenv('DEEPSEEK_MAX_CONCURRENT', str(file_concurrency * 2))))
    )
    os.environ['PARSER_DEFER_CHECKPOINT'] = '1'
    os.environ['PARSER_DEBUG_PHASE_ONLY'] = '1'


def configure_debug_runtime(root: Path) -> Path:
    from canvas_parser.weekly_iteration.auth import apply_env_file

    apply_env_file(root / '.env')
    apply_debug_parse_env()
    os.environ['PARSER_DEBUG_SESSION'] = '1'
    cache_dir = root / '.cache' / 'parse_debug' / 'canvasfiles'
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ['PARSER_CANVASFILES_DIR'] = str(cache_dir)
    os.environ.setdefault('PARSER_OUTSIDE_SOURCES_DIR', str(root / '.cache' / 'parse_debug' / 'outside-sources'))
    os.environ.setdefault('PARSER_PDF_CACHE_DIR', str(root / '.cache' / 'parse_debug' / 'pdf_extract'))
    import parser as parser_mod

    parser_mod.deepseek_client = parser_mod.create_deepseek_client()
    parser_mod.folder = cache_dir
    parser_mod.init_parse_runtime()
    return cache_dir


def _item_summary(batch_type: str, item: dict[str, Any], key: str) -> dict[str, Any]:
    return {
        'key': key,
        'batch_type': batch_type,
        'id': str(item.get('id') or ''),
        'course_id': str(item.get('courseid') or ''),
        'name': str(item.get('name') or item.get('display_name') or ''),
        'url': str(item.get('url') or ''),
    }


def list_course_items(batches: list[dict[str, Any]], course_id: str) -> list[dict[str, Any]]:
    cid = str(course_id)
    rows = []
    for batch_type, item, key in iter_batch_items(batches):
        if str(item.get('courseid') or '') != cid:
            continue
        rows.append(_item_summary(batch_type, item, key))
    rows.sort(key=lambda row: (row['batch_type'], row['name'].casefold()))
    return rows


async def discover_syllabus_sequential(
    plan: CourseParsePlan,
    *,
    placement: str,
) -> None:
    """Syllabus discovery with per-candidate debug checkpoints (sequential)."""
    classified_by_key: dict[str, ClassifiedSyllabusCandidate] = {}
    candidates = _candidate_rows(plan)
    await trace_checkpoint(
        'syllabus_discover_phase',
        {
            'phase': 'syllabus_discover',
            'course_id': plan.course_id,
            'candidate_count': len(candidates),
            'candidates': [_item_summary(bt, it, k) for bt, it, k in candidates],
        },
        pause=True,
    )
    promoted_keys: set[str] = set()
    for batch_type, item, key in candidates:
        name = str(item.get('name') or item.get('id') or key)
        await trace_activity(f'Downloading + classifying syllabus candidate: {name}')
        is_syllabus, confidence, type_id, snippet = await classify_downloaded_file_as_syllabus(
            item,
            course_id=plan.course_id,
            placement=placement,
            production=False,
        )
        await trace_checkpoint(
            'syllabus_discover_candidate',
            {
                'phase': 'syllabus_discover',
                'course_id': plan.course_id,
                'item': _item_summary(batch_type, item, key),
                'is_syllabus': is_syllabus,
                'confidence': confidence,
                'type_id': type_id,
                'snippet_preview': snippet[:1200],
            },
            pause=False,
        )
        if is_syllabus:
            plan.syllabus_items.append((batch_type, item, key))
            promoted_keys.add(key)
            classified_by_key[key] = ClassifiedSyllabusCandidate(
                batch_type=batch_type,
                item=item,
                key=key,
                confidence=confidence,
                type_id=type_id,
                snippet=snippet,
            )
    if promoted_keys:
        plan.file_items = [row for row in plan.file_items if row[2] not in promoted_keys]
    plan.syllabus_items.sort(key=lambda row: syllabus_priority(row[0], row[1]))
    await trace_checkpoint(
        'syllabus_reconcile_start',
        {
            'phase': 'syllabus_discover',
            'course_id': plan.course_id,
            'syllabus_items': [_item_summary(bt, it, k) for bt, it, k in plan.syllabus_items],
        },
        pause=False,
    )
    await trace_activity('Reconciling duplicate syllabi (LLM if multiple PDFs)…')
    await reconcile_syllabus_duplicates(plan, classified_by_key=classified_by_key)
    finalize_course_plan(plan)
    await trace_checkpoint(
        'syllabus_discover_done',
        {
            'phase': 'syllabus_discover',
            'course_id': plan.course_id,
            'syllabus_items': [_item_summary(bt, it, k) for bt, it, k in plan.syllabus_items],
            'file_items_remaining': len(plan.file_items),
        },
        pause=True,
    )


async def _parse_one_item(
    batch_type: str,
    item: dict[str, Any],
    key: str,
    *,
    placement: str,
    seed_state: dict[str, Any] | None,
    phase_label: str,
    full_graph: bool,
) -> dict[str, Any]:
    await trace_activity(f'Parsing {phase_label}: {item.get("name") or key}')
    return await process_single_item(
        batch_type,
        item,
        placement=placement,
        production=False,
        seed_state=seed_state,
    )


async def _parse_items_with_seed(
    rows: list[tuple[str, dict[str, Any], str]],
    *,
    placement: str,
    seed_state: dict[str, Any] | None,
    phase_label: str,
    full_graph: bool = False,
) -> dict[str, Any]:
    state = dict(seed_state or {})
    for batch_type, item, key in rows:
        fragment = await _parse_one_item(
            batch_type,
            item,
            key,
            placement=placement,
            seed_state=state or None,
            phase_label=phase_label,
            full_graph=full_graph,
        )
        state = merge_graph_fragments([state, fragment]) if state else fragment
    return state


async def run_syllabus_final_pass(course_id: str) -> None:
    import parser as parser_mod

    syllabus_file = parser_mod.find_syllabus_file_for_course(course_id)
    if not syllabus_file:
        await trace_checkpoint(
            'syllabus_final_skipped',
            {'phase': 'syllabus_final', 'course_id': course_id, 'reason': 'no_syllabus_file'},
        )
        return
    full_prompt = parser_mod.pages_to_prompt_text(syllabus_file.pages)
    if not full_prompt:
        await trace_checkpoint(
            'syllabus_final_skipped',
            {'phase': 'syllabus_final', 'course_id': course_id, 'reason': 'empty_syllabus_text'},
        )
        return
    await trace_checkpoint(
        'syllabus_final_phase',
        {
            'phase': 'syllabus_final',
            'course_id': course_id,
            'file_id': str(syllabus_file.fileid),
            'filename': syllabus_file.name,
        },
        pause=True,
    )
    await parser_mod.run_deepseek(
        full_prompt,
        syllabus_file.fileid,
        course_id,
        syllabus_file.downloadurl,
        syllabus_file.canvaspreviewurl,
        syllabus_file.name,
        pages=syllabus_file.pages,
        final_pass=True,
    )
    parser_mod.run_finalize_course_events(course_id)
    await trace_checkpoint(
        'syllabus_final_done',
        {
            'phase': 'syllabus_final',
            'course_id': course_id,
            **graph_payload_for_checkpoint(course_id, full=True),
        },
        pause=True,
    )


@dataclass
class DebugSession:
    root: Path
    batches: list[dict[str, Any]]
    course_id: str
    target_key: str = ''
    pipeline_mode: str = 'single_file'  # single_file | full_course
    pause_mode: str = 'turn'
    trace: DebugTrace = field(default_factory=DebugTrace)
    _task: asyncio.Task | None = field(default=None, repr=False)
    _on_update: Callable[[], None] | None = field(default=None, repr=False)

    def set_on_update(self, callback: Callable[[], None] | None) -> None:
        self._on_update = callback
        self.trace.set_on_update(callback)

    def snapshot(self, *, light: bool = False, step_index: int | None = None) -> dict[str, Any]:
        plan = self._plan()
        target = self._find_target(plan)
        return {
            **self.trace.snapshot(light=light, step_index=step_index),
            'course_id': self.course_id,
            'pipeline_mode': self.pipeline_mode,
            'target_key': self.target_key,
            'target_item': _item_summary(*target) if target else None,
            'plan_summary': {
                'syllabus_items': len(plan.syllabus_items),
                'deterministic_items': len(plan.deterministic_items),
                'file_items': len(plan.file_items),
            },
        }

    def proceed(self) -> None:
        self.trace.proceed()

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        loop = asyncio.get_running_loop()
        self.trace.pause_mode = self.pause_mode
        self.trace.status = 'running'
        self._task = loop.create_task(self._run_pipeline())

    def stop(self) -> None:
        """Cancel pipeline; prefer stop_via_loop() from other threads."""
        if self._task and not self._task.done():
            self._task.cancel()

    def _course_items(self) -> list[tuple[str, dict[str, Any], str]]:
        return [
            (batch_type, item, key)
            for batch_type, item, key in iter_batch_items(self.batches)
            if str(item.get('courseid') or '') == str(self.course_id)
        ]

    def _file_parse_queue(self, plan: CourseParsePlan) -> list[tuple[str, dict[str, Any], str]]:
        return collect_parseable_file_items(plan, self._course_items())

    def _plan(self) -> CourseParsePlan:
        items = [
            (bt, item, key)
            for bt, item, key in iter_batch_items(self.batches)
            if str(item.get('courseid') or '') == str(self.course_id)
        ]
        plans = build_course_parse_plans(items)
        if not plans:
            return CourseParsePlan(course_id=str(self.course_id))
        return plans[0]

    def _find_target(self, plan: CourseParsePlan) -> tuple[str, dict[str, Any], str] | None:
        all_rows = plan.syllabus_items + plan.deterministic_items + plan.file_items
        for row in all_rows:
            if row[2] == self.target_key:
                return row
        for batch_type, item, key in iter_batch_items(self.batches):
            if key == self.target_key:
                return batch_type, item, key
        return None

    async def _run_prefix(self, plan: CourseParsePlan, *, placement: str, full_graph: bool) -> dict[str, Any]:
        await discover_syllabus_sequential(plan, placement=placement)

        if plan.syllabus_items:
            await trace_checkpoint(
                'syllabus_parse_phase',
                {
                    'phase': 'syllabus_parse',
                    'course_id': self.course_id,
                    'count': len(plan.syllabus_items),
                    'items': [_item_summary(bt, it, k) for bt, it, k in plan.syllabus_items],
                    **graph_payload_for_checkpoint(self.course_id, full=full_graph),
                },
                pause=True,
            )
        state = await _parse_items_with_seed(
            plan.syllabus_items,
            placement=placement,
            seed_state=None,
            phase_label='syllabus_parse',
            full_graph=full_graph,
        ) or {}
        if plan.syllabus_items:
            await trace_checkpoint(
                'syllabus_parse_done',
                {
                    'phase': 'syllabus_parse',
                    'course_id': self.course_id,
                    **graph_payload_for_checkpoint(self.course_id, full=full_graph),
                },
                pause=True,
            )

        if plan.deterministic_items:
            await trace_checkpoint(
                'deterministic_phase',
                {
                    'phase': 'deterministic',
                    'count': len(plan.deterministic_items),
                    'items': [_item_summary(bt, it, k) for bt, it, k in plan.deterministic_items],
                    **graph_payload_for_checkpoint(self.course_id, full=full_graph),
                },
                pause=True,
            )
            await trace_activity(
                f'Processing {len(plan.deterministic_items)} deterministic items '
                '(assignments/pages/modules — no per-item pauses; may take several minutes)…'
            )
            det = await run_deterministic_course_items(
                plan.deterministic_items,
                placement=placement,
                production=False,
                seed_state=state or None,
            )
            state = merge_graph_fragments([state, det]) if state else det
            await trace_checkpoint(
                'deterministic_done',
                {
                    'phase': 'deterministic',
                    **graph_payload_for_checkpoint(self.course_id, full=full_graph),
                },
                pause=True,
            )
        return state or {}

    async def _run_pipeline(self) -> None:
        placement = 'local_download_parse'
        set_active_trace(self.trace)
        try:
            self.trace.set_activity('Loading Canvas auth and parser runtime…')
            auth_payload = self._canvas_auth()
            apply_canvas_auth(auth_payload)
            self.trace.set_activity('Initializing parser runtime (first run may take 10–20s)…')
            configure_debug_runtime(self.root)
            reset_parser_state()

            plan = self._plan()
            full_graph = self.pipeline_mode == 'full_course'
            course_items = self._course_items()

            if self.pipeline_mode == 'full_course':
                initial_file_queue = collect_parseable_file_items(plan, course_items)
                await trace_checkpoint(
                    'session_start',
                    {
                        'course_id': self.course_id,
                        'pipeline_mode': self.pipeline_mode,
                        'pause_mode': self.pause_mode,
                        'syllabus_items_planned': len(plan.syllabus_items),
                        'deterministic_items_planned': len(plan.deterministic_items),
                        'file_items_planned': len(initial_file_queue),
                        'file_concurrency': debug_file_concurrency(),
                        'items': [_item_summary(bt, it, k) for bt, it, k in initial_file_queue[:40]],
                        'file_items_truncated': max(0, len(initial_file_queue) - 40),
                    },
                    pause=True,
                )
                state = await self._run_prefix(plan, placement=placement, full_graph=False)
                file_rows = self._file_parse_queue(plan)
                plan.file_items = file_rows
                await trace_checkpoint(
                    'pre_file_parse',
                    {
                        'phase': 'file_parse',
                        'course_id': self.course_id,
                        'count': len(file_rows),
                        'file_concurrency': debug_file_concurrency(),
                        'items': [_item_summary(bt, it, k) for bt, it, k in file_rows[:60]],
                        'file_items_truncated': max(0, len(file_rows) - 60),
                        **graph_payload_for_checkpoint(self.course_id, full=True),
                    },
                    pause=True,
                )
                if file_rows:
                    state = await run_batched_course_file_phases(
                        file_rows,
                        course_id=self.course_id,
                        seed_state=state or None,
                        full_graph=True,
                    )
                else:
                    await trace_checkpoint(
                        'file_parse_skipped',
                        {
                            'phase': 'file_parse',
                            'course_id': self.course_id,
                            'reason': 'no_parseable_files_after_syllabus',
                            **graph_payload_for_checkpoint(self.course_id, full=True),
                        },
                    )
            else:
                target = self._find_target(plan)
                if not target:
                    raise ValueError(f'Unknown item key: {self.target_key}')
                await trace_checkpoint(
                    'session_start',
                    {
                        'course_id': self.course_id,
                        'target': _item_summary(*target),
                        'pipeline_mode': self.pipeline_mode,
                        'pause_mode': self.pause_mode,
                    },
                )
                state = await self._run_prefix(plan, placement=placement, full_graph=False)
                batch_type, item, key = target
                if key in {row[2] for row in plan.syllabus_items}:
                    pass
                elif key in {row[2] for row in plan.deterministic_items}:
                    pass
                else:
                    await trace_checkpoint(
                        'target_file_start',
                        {'phase': 'target_file', 'item': _item_summary(batch_type, item, key)},
                    )
                    await trace_activity(f'Parsing target file: {item.get("name") or key}')
                    fragment = await process_single_item(
                        batch_type,
                        item,
                        placement=placement,
                        production=False,
                        seed_state=state or None,
                    )
                    state = merge_graph_fragments([state, fragment]) if state else fragment
                    await trace_checkpoint(
                        'target_file_done',
                        {
                            'phase': 'target_file',
                            'item': _item_summary(batch_type, item, key),
                            'meta': fragment.get('_meta') or {},
                            **graph_payload_for_checkpoint(
                                self.course_id,
                                full=True,
                                file_id=str(item.get('id') or ''),
                            ),
                        },
                    )

            await run_syllabus_final_pass(self.course_id)

            self.trace.status = 'done'
            await trace_checkpoint(
                'session_done',
                {
                    'course_id': self.course_id,
                    'pipeline_mode': self.pipeline_mode,
                    'target_key': self.target_key,
                    **graph_payload_for_checkpoint(self.course_id, full=full_graph or self.pipeline_mode == 'full_course'),
                },
                pause=False,
            )
        except asyncio.CancelledError:
            self.trace.status = 'error'
            self.trace.error = 'cancelled'
            self.trace._notify()
            raise
        except Exception as error:
            self.trace.status = 'error'
            self.trace.error = f'{error}\n{traceback.format_exc()}'
            self.trace._notify()
        finally:
            set_active_trace(None)

    def _canvas_auth(self) -> dict[str, str]:
        from scripts.run_parse_trial_compare import canvas_auth_payload
        from canvas_parser.weekly_iteration.auth import load_auth_from_env

        auth = load_auth_from_env(self.root)
        return canvas_auth_payload(auth)


def load_debug_batches(root: Path, course_ids: list[int] | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (batches, course_catalog). Prefer canvas_data.json; fall back to GT snapshots."""
    canvas_path = root / 'canvas_data.json'
    courses: list[dict[str, Any]] = []
    batches: list[dict[str, Any]] = []

    if canvas_path.is_file():
        from scripts.build_harvard_snapshots_from_canvas_data import build_snapshot
        from scripts.run_full_reparse_canvas_data import load_batches

        batches, selected_ids = load_batches(root, princeton_only=False, course_ids=course_ids)
        data = json.loads(canvas_path.read_text(encoding='utf-8'))
        by_id = {str(c.get('id')): c for c in data.get('courses') or []}
        for cid in selected_ids:
            course = by_id.get(str(cid)) or {'id': cid, 'name': f'Course {cid}'}
            courses.append({'id': str(cid), 'name': course.get('name') or f'Course {cid}'})
        return batches, courses

    snapshots_path = root / 'fixtures' / 'weekly_iteration' / 'snapshots_gt.json'
    if not snapshots_path.is_file():
        return [], []

    from canvas_parser.weekly_iteration.auth import load_auth_from_env
    from canvas_parser.weekly_iteration.llm_parse import build_parser_batches

    snapshots = json.loads(snapshots_path.read_text(encoding='utf-8'))
    auth = load_auth_from_env(root)
    base_url = auth.base_url or 'https://princeton.instructure.com'
    allowed = {str(cid) for cid in course_ids} if course_ids else None
    for snap in snapshots:
        cid = str((snap.get('course') or {}).get('id') or '')
        if not cid or (allowed and cid not in allowed):
            continue
        course = snap.get('course') or {}
        courses.append({'id': cid, 'name': course.get('name') or f'Course {cid}'})
        batches.extend(build_parser_batches(snap, base_url))
    return batches, courses
