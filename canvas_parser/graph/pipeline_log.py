"""Structured, low-noise logging for the event-dating pipeline."""

from collections import Counter

from canvas_parser.graph.events import is_schedulable_date

EVENT_MUTATION_TOOLS = frozenset({
    'add_event_node',
    'add_exam_node',
    'update_event_node',
    'log_event',
    'link_file_to_event',
})

EVENT_LOOKUP_TOOLS = frozenset({
    'get_all_assignment_names',
    'get_assignmentid_by_name',
})


def _field(arguments, *keys):
    for key in keys:
        value = (arguments or {}).get(key)
        if value not in (None, ''):
            return value
    return ''


def format_event_tool_line(courseid, fileid, tool_name, arguments, result=None):
    name = _field(arguments, 'eventname', 'examname')
    start = _field(arguments, 'startdate')
    end = _field(arguments, 'enddate')
    start_label = start if start else 'MISSING'
    parts = [
        f"course={courseid}",
        f"file={fileid}",
        f"tool={tool_name}",
    ]
    if name:
        parts.append(f"name={name!r}")
    if tool_name in {'add_event_node', 'add_exam_node', 'update_event_node'}:
        parts.append(f"start={start_label!r}")
        if end:
            parts.append(f"end={end!r}")
    if isinstance(result, dict):
        if result.get('eventNodeId'):
            parts.append(f"eventid={result.get('eventNodeId')!r}")
        if result.get('status') and result.get('status') != 'SUCCESS':
            parts.append(f"status={result.get('status')!r}")
    return 'parser events llm: ' + ' '.join(parts)


def log_llm_pass(courseid, fileid, pass_index, final_pass, tool_calls, text_content='', turn_index=1):
    tools = [getattr(call.function, 'name', '') for call in (tool_calls or [])]
    event_tools = [name for name in tools if name in EVENT_MUTATION_TOOLS]
    turn_suffix = f" turn={turn_index}" if turn_index > 1 else ""
    summary = (
        f"parser events pass: course={courseid} file={fileid} "
        f"pass={pass_index} final_pass={final_pass}{turn_suffix} "
        f"tool_count={len(tools)} event_tools={event_tools or 'none'}"
    )
    print(summary, flush=True)
    if text_content and not tools:
        preview = ' '.join(str(text_content).split())[:120]
        print(
            f"parser events pass: course={courseid} file={fileid} pass={pass_index}{turn_suffix} "
            f"TEXT_ONLY no tool calls — preview={preview!r}",
            flush=True,
        )


def log_finalize_start(courseid, exam_text_chars, default_year, undated_count):
    print(
        f"parser events finalize: course={courseid} begin "
        f"syllabus_text_chars={exam_text_chars} default_year={default_year or 'none'} "
        f"undated_events={undated_count}",
        flush=True,
    )


def log_finalize_step(courseid, step, **details):
    parts = ' '.join(f"{key}={value}" for key, value in details.items())
    print(f"parser events finalize: course={courseid} step={step} {parts}".rstrip(), flush=True)


def log_syllabus_hint(courseid, hint_name, date_text, normalized, action, detail=''):
    normalized_label = normalized if is_schedulable_date(normalized) else 'UNPARSEABLE'
    extra = f" detail={detail}" if detail else ''
    print(
        f"parser events finalize: course={courseid} syllabus_hint name={hint_name!r} "
        f"raw_date={date_text!r} normalized={normalized_label!r} action={action}{extra}",
        flush=True,
    )


def log_assignment_exam(courseid, assignment_name, canonical, duedate, action, detail=''):
    extra = f" detail={detail}" if detail else ''
    print(
        f"parser events finalize: course={courseid} assignment_exam name={assignment_name!r} "
        f"canonical={canonical!r} due={duedate or 'NONE'} action={action}{extra}",
        flush=True,
    )


def log_finalize_stats(courseid, stats, remaining_logged=0):
    interesting = {key: value for key, value in (stats or {}).items() if value}
    if remaining_logged:
        interesting['logged_events_remaining'] = remaining_logged
    if not interesting:
        print(f"parser events finalize: course={courseid} done no changes", flush=True)
        return
    print(
        f"parser events finalize: course={courseid} done stats={interesting}",
        flush=True,
    )


def summarize_graph_warnings(warnings):
    if not warnings:
        return []

    undated_tests = []
    other = []
    for warning in warnings:
        if warning.startswith('test event missing date '):
            name = warning.split(' name=', 1)[-1] if ' name=' in warning else '?'
            undated_tests.append(name)
        else:
            other.append(warning)

    lines = []
    if undated_tests:
        preview = ', '.join(undated_tests[:8])
        extra = f" (+{len(undated_tests) - 8} more)" if len(undated_tests) > 8 else ''
        lines.append(f"test event missing date (x{len(undated_tests)}): {preview}{extra}")

    counts = Counter(other)
    for warning, count in counts.most_common():
        if count > 1:
            lines.append(f"{warning} (x{count})")
        else:
            lines.append(warning)
    return lines


def print_graph_validation_summary(warnings, *, reason='checkpoint'):
    lines = summarize_graph_warnings(warnings)
    if not lines:
        return
    print(f"parser graph validation ({reason}):", flush=True)
    for line in lines[:15]:
        print(f"  - {line}", flush=True)
    if len(lines) > 15:
        print(f"  - ... and {len(lines) - 15} more warning types", flush=True)


def print_course_event_audit(courseid, events):
    """One line per course summarizing test event date coverage."""
    test_events = [event for event in events or [] if str(event.get('type', '')).casefold() == 'test']
    if not test_events:
        return
    dated = []
    undated = []
    for event in test_events:
        name = event.get('name', '?')
        if is_schedulable_date(event.get('startdate')) or is_schedulable_date(event.get('enddate')):
            dated.append(name)
        else:
            undated.append(name)
    print(
        f"parser events audit: course={courseid} test_events={len(test_events)} "
        f"dated={dated or 'none'} undated={undated or 'none'}",
        flush=True,
    )
