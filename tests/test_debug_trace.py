"""Tests for parse debug trace checkpoints."""
from __future__ import annotations

import asyncio

from canvas_parser.parse.debug_trace import (
    DebugTrace,
    analyze_step_cost,
    file_id_from_step_id,
    normalize_step_id,
    scoped_step_id,
)


def test_analyze_step_cost_from_usage():
    cost = analyze_step_cost('pass1_turn1_response', {
        'usage': {
            'prompt_tokens': 10_000,
            'completion_tokens': 500,
        },
    })
    assert cost is not None
    assert cost['kind'] == 'call'
    assert cost['increment_usd'] > 0
    assert '$' in cost['display']


def test_analyze_step_cost_pass_rollup_not_incremental():
    cost = analyze_step_cost('pass1_pass_end', {
        'cost': {
            'rollup': True,
            'usage': {'prompt_tokens': 5000, 'completion_tokens': 200},
        },
    })
    assert cost is not None
    assert cost['kind'] == 'rollup'
    assert cost['increment_usd'] == 0.0
    assert cost['step_usd'] > 0


def test_session_cost_summary_counts_incremental_only():
    async def run():
        trace = DebugTrace(pause_mode='turn')
        await trace.checkpoint('pass1_turn1_response', {
            'usage': {'prompt_tokens': 1000, 'completion_tokens': 100},
        }, pause=False)
        await trace.checkpoint('pass1_pass_end', {
            'cost': {
                'rollup': True,
                'usage': {'prompt_tokens': 1000, 'completion_tokens': 100},
            },
        }, pause=False)
        summary = trace.session_cost_summary()
        assert summary['billed_steps'] == 1
        assert summary['total_cost_usd'] > 0

    asyncio.run(run())


def test_course_graph_snapshot_structure():
    import parser as parser_mod
    from canvas_parser.parse.debug_trace import course_graph_snapshot, graph_payload_for_checkpoint

    cid = 'debug-test-course'
    parser_mod.syllabusNodes[cid] = parser_mod.syllabusNode(
        courseid=cid,
        classtimes='Tue/Thu 10am',
    )
    parser_mod.fileNodes.setdefault(cid, {})['42'] = parser_mod.fileNode(
        fileid='42',
        courseid=cid,
        name='Lecture 1.pdf',
        filetype='content',
    )
    snap = course_graph_snapshot(cid, file_id='42')
    assert snap['syllabus_node'] is not None
    assert len(snap['file_nodes']) == 1
    assert snap['parsed_file_node']['fileid'] == '42'
    payload = graph_payload_for_checkpoint(cid, full=True, file_id='42')
    assert payload['file_nodes']
    assert payload['parsed_file_node']['name'] == 'Lecture 1.pdf'
    parser_mod.syllabusNodes.pop(cid, None)
    parser_mod.fileNodes.pop(cid, None)


def test_debug_trace_pause_and_proceed():
    async def run():
        trace = DebugTrace(pause_mode='turn')
        trace._proceed.clear()

        async def worker():
            await trace.checkpoint('step_a', {'n': 1})
            await trace.checkpoint('step_b', {'n': 2}, pause=False)

        task = asyncio.create_task(worker())
        await asyncio.sleep(0.05)
        assert trace.status == 'waiting'
        assert len(trace.steps) == 1
        trace.proceed()
        await task
        assert len(trace.steps) == 2
        assert trace.steps[1]['id'] == 'step_b'

    asyncio.run(run())


def test_pause_mode_pass():
    async def run():
        trace = DebugTrace(pause_mode='pass')
        trace._proceed.clear()

        async def worker():
            await trace.checkpoint('pass1_pass_start', {}, pause=True)
            await trace.checkpoint('pass1_turn1_request', {}, pause=False)

        task = asyncio.create_task(worker())
        await asyncio.sleep(0.05)
        assert trace.status == 'waiting'
        assert len(trace.steps) == 1
        trace.proceed()
        await asyncio.sleep(0.05)
        await task
        assert len(trace.steps) == 2

    asyncio.run(run())


def test_scoped_step_id_prefixes_file():
    import os

    old = os.environ.get('PARSER_DEBUG_SESSION')
    os.environ['PARSER_DEBUG_SESSION'] = '1'
    try:
        step = scoped_step_id('pass1_pass_start', {'file_id': '12345', 'filename': 'a.pdf'})
        assert step == 'file_12345_pass1_pass_start'
        assert normalize_step_id(step) == 'pass1_pass_start'
        assert file_id_from_step_id(step) == '12345'
    finally:
        if old is None:
            os.environ.pop('PARSER_DEBUG_SESSION', None)
        else:
            os.environ['PARSER_DEBUG_SESSION'] = old


def test_concurrent_checkpoints_pause_one_at_a_time():
    import os

    old = os.environ.get('PARSER_DEBUG_SESSION')
    os.environ['PARSER_DEBUG_SESSION'] = '1'
    try:
        async def run():
            trace = DebugTrace(pause_mode='pass')
            order: list[str] = []

            async def worker(file_id: str):
                await trace.checkpoint(
                    'pass1_pass_start',
                    {'file_id': file_id, 'filename': f'{file_id}.pdf'},
                    pause=True,
                )
                order.append(f'start-{file_id}')

            trace._proceed.clear()
            t1 = asyncio.create_task(worker('1'))
            t2 = asyncio.create_task(worker('2'))
            await asyncio.sleep(0.08)
            assert trace.status == 'waiting'
            assert len(trace.steps) == 2
            trace.proceed()
            await asyncio.sleep(0.08)
            assert trace.status == 'waiting'
            assert len(trace.steps) == 2
            trace.proceed()
            await asyncio.gather(t1, t2)
            assert order == ['start-1', 'start-2']

        asyncio.run(run())
    finally:
        if old is None:
            os.environ.pop('PARSER_DEBUG_SESSION', None)
        else:
            os.environ['PARSER_DEBUG_SESSION'] = old
